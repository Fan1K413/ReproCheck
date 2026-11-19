"""解析任务编排服务（Init → Step → Poll → Cancel 可恢复设计）。

结合当前部署能力：任务同步执行但完整落库，服务重启后从 DB 读取真实状态，
不假装拥有分布式任务调度能力；cancel_requested 在各阶段边界检测。
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, EvidenceValidationError
from app.core.logging import logger
from app.models import Material, SourceChunk
from app.models.stage2 import MaterialParseRun, ParseTask
from app.parsers.limits import ParserError
from app.parsers.registry import parse_file
from app.schemas.parsing import ParseResult
from app.services.extraction_service import ExtractionResult, ExtractionService
from app.services.material_service import MaterialService

STAGE_LABELS = {
    "uploaded": "已上传", "queued": "排队中", "parsing": "解析材料中",
    "extracting": "AI 抽取事实中", "completed": "已完成",
    "partially_completed": "部分完成", "failed": "失败", "unsupported": "不支持",
}


class TaskService:
    def __init__(self, db: AsyncSession, extraction: ExtractionService | None = None) -> None:
        self.db = db
        self.materials = MaterialService(db)
        self.extraction = extraction or ExtractionService(db)

    async def start(self, material_id: str, *, idem_key: str | None = None) -> ParseTask:
        material = await self.materials.get(material_id)
        key = idem_key or f"{material_id}:{material.sha256 or ''}"

        # 幂等：同 material + 同哈希的 queued/running 任务直接复用
        existing = (await self.db.execute(
            select(ParseTask).where(
                ParseTask.idem_key == key,
                ParseTask.status.in_(["queued", "parsing", "extracting"]),
            ).order_by(ParseTask.created_at.desc())
        )).scalars().first()
        if existing is not None:
            return existing

        # 同哈希已成功解析过：复用缓存结果（不重复调用模型）
        cached = (await self.db.execute(
            select(ParseTask).where(
                ParseTask.idem_key == key, ParseTask.status == "completed"
            ).order_by(ParseTask.completed_at.desc())
        )).scalars().first()
        if cached is not None:
            cached.idem_key = key  # 保持 key 一致，标记来自缓存
            self.db.add(cached)
            await self.db.commit()
            return cached

        if not settings.is_llm_configured:
            # 明确失败，不伪造结果；解析仍可单独进行但抽取无法完成
            raise AppError("LLM_KEY_NOT_CONFIGURED", "尚未配置 API Key，无法执行 AI 事实抽取。")

        # 治理门：开启 require_ai_consent 时，调用外部模型前必须有有效授权
        from app.models import Project
        from app.services.governance_service import ensure_ai_consent
        proj = (await self.db.execute(select(Project).where(Project.id == material.project_id))).scalar_one_or_none()
        await ensure_ai_consent(self.db, material.project_id, proj.org_id if proj else None)

        task = ParseTask(
            id=f"task-{uuid.uuid4().hex[:16]}",
            project_id=material.project_id, material_id=material_id,
            idem_key=key, status="queued", stage="queued",
            stage_message="任务已创建", model=settings.llm_model,
            prompt_version="",
        )
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)
        return task

    async def run(self, task_id: str) -> ParseTask:
        """执行任务（同步）。前端通过 GET /parse-tasks/{id} 查询真实状态。"""
        task = (await self.db.execute(
            select(ParseTask).where(ParseTask.id == task_id)
        )).scalar_one_or_none()
        if task is None:
            raise AppError("NOT_FOUND", "任务不存在。")

        t0 = time.perf_counter()
        task.status = "parsing"
        task.stage = "parsing"
        task.stage_message = STAGE_LABELS["parsing"]
        task.started_at = datetime.now(timezone.utc)
        self.db.add(task)
        await self.db.commit()

        material = await self.materials.get(task.material_id)
        parse_run = MaterialParseRun(
            id=f"mpr-{uuid.uuid4().hex[:16]}",
            material_id=material.id, project_id=material.project_id,
            parser_status="parsing", started_at=datetime.now(timezone.utc),
        )
        self.db.add(parse_run)
        await self.db.commit()

        try:
            if task.cancel_requested:
                task.status = "failed"
                task.stage = "failed"
                task.error_code = "CANCELLED"
                task.stage_message = "用户取消"
                await self.db.commit()
                return task

            path = await self.materials.path_of(material)
            # 确定性解析（不使用模型）
            parse_result: ParseResult = parse_file(
                path, material_id=material.id, project_id=material.project_id
            )
            if task.cancel_requested:
                task.status = "failed"
                task.error_code = "CANCELLED"
                await self.db.commit()
                return task

            # 落库 chunks（证据唯一来源）
            await self.db.execute(
                delete(SourceChunk).where(SourceChunk.material_id == material.id)
            )
            for sc in parse_result.chunks:
                self.db.add(SourceChunk(
                    material_id=material.id, chunk_id=sc.chunk_id,
                    chunk_index=sc.chunk_index, original_text=sc.content,
                    locator_type=parse_result.material_type,
                    page_number=(sc.source_locator or {}).get("viewer_page_number"),
                    line_number=(sc.source_locator or {}).get("start_line"),
                    project_id=material.project_id,
                    material_type=sc.material_type, content_hash=sc.content_hash,
                    parser_version=sc.parser_version,
                    source_locator_json=json.dumps(sc.source_locator, ensure_ascii=False),
                    token_estimate=sc.token_estimate,
                ))

            # 更新材料解析状态与元信息
            material.parse_status = parse_result.status
            material.parser_version = parse_result.parser_version
            material.page_count = parse_result.metadata.get("page_count")
            material.needs_ocr = parse_result.needs_ocr
            material.parse_metadata_json = json.dumps(parse_result.metadata, ensure_ascii=False, default=str)
            material.warnings_json = json.dumps(
                [w.model_dump() for w in parse_result.warnings], ensure_ascii=False
            )
            material.parse_error_code = parse_result.error_code
            material.parse_error_message = parse_result.error_message
            self.db.add(material)

            parse_run.parser_status = parse_result.status
            parse_run.parser_version = parse_result.parser_version
            parse_run.chunk_count = len(parse_result.chunks)
            parse_run.warning_count = len(parse_result.warnings)
            parse_run.error_code = parse_result.error_code
            parse_run.error_message = parse_result.error_message
            parse_run.completed_at = datetime.now(timezone.utc)

            if not parse_result.chunks:
                # 解析无内容：明确失败/部分完成，不进入抽取
                task.status = "failed"
                task.stage = "failed"
                task.error_code = parse_result.error_code or "NO_CHUNKS"
                task.error_message = parse_result.error_message or "解析未产生可用文本块。"
                task.stage_message = "解析失败"
                await self.db.commit()
                return task

            # ---- AI 抽取 ----
            task.status = "extracting"
            task.stage = "extracting"
            task.stage_message = STAGE_LABELS["extracting"]
            self.db.add(task)
            await self.db.commit()

            if task.cancel_requested:
                task.status = "failed"
                task.error_code = "CANCELLED"
                await self.db.commit()
                return task

            ex: ExtractionResult = await self.extraction.extract(
                material=material, parse_result=parse_result,
                project_id=material.project_id, task_id=task.id,
            )
            # 确定性事实由程序补充（不额外调用模型）
            await self.extraction.add_program_facts(
                material=material, parse_result=parse_result,
                project_id=material.project_id,
            )

            task.status = "completed"
            task.stage = "completed"
            task.stage_message = "解析与抽取完成"
            task.model = ex.model or settings.llm_model
            task.prompt_version = ex.prompt_version
            task.model_calls = ex.calls
            task.prompt_tokens = ex.prompt_tokens
            task.completion_tokens = ex.completion_tokens
            task.total_tokens = ex.total_tokens
            task.facts_count = ex.facts_created
            task.result_json = json.dumps({
                "evidence_created": ex.evidence_created,
                "evidence_rejected": ex.evidence_rejected,
                "by_assertion": ex.by_assertion,
            }, ensure_ascii=False)
        except (ParserError, AppError) as exc:
            code = getattr(exc, "code", "PARSER_ERROR")
            task.status = "failed"
            task.stage = "failed"
            task.error_code = code
            task.error_message = getattr(exc, "message", str(exc))[:500]
            task.stage_message = "失败"
            material.parse_status = "failed"
            material.parse_error_code = code
            material.parse_error_message = task.error_message
            parse_run.parser_status = "failed"
            parse_run.error_code = code
            parse_run.error_message = task.error_message
            self.db.add_all([task, material, parse_run])
            await self.db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.error("task_unexpected_error task=%s type=%s err=%s",
                         task_id, type(exc).__name__, str(exc)[:300])
            task.status = "failed"
            task.stage = "failed"
            task.error_code = "INTERNAL_ERROR"
            task.error_message = f"任务发生未预期错误：{type(exc).__name__}: {str(exc)[:200]}"
            self.db.add(task)
            await self.db.commit()
        finally:
            task.duration_ms = int((time.perf_counter() - t0) * 1000)
            task.completed_at = datetime.now(timezone.utc)
            parse_run.duration_ms = task.duration_ms
            parse_run.completed_at = datetime.now(timezone.utc)
            self.db.add_all([task, parse_run])
            await self.db.commit()

        return task

    async def retry(self, task_id: str) -> ParseTask:
        task = (await self.db.execute(
            select(ParseTask).where(ParseTask.id == task_id)
        )).scalar_one_or_none()
        if task is None:
            raise AppError("NOT_FOUND", "任务不存在。")
        if task.status not in ("failed", "unsupported"):
            raise AppError("VALIDATION_ERROR", "仅失败任务可重试。")
        task.status = "queued"
        task.stage = "queued"
        task.stage_message = "重新排队"
        task.error_code = None
        task.error_message = None
        task.cancel_requested = False
        self.db.add(task)
        await self.db.commit()
        return await self.run(task.id)

    async def cancel(self, task_id: str) -> dict:
        task = (await self.db.execute(
            select(ParseTask).where(ParseTask.id == task_id)
        )).scalar_one_or_none()
        if task is None:
            raise AppError("NOT_FOUND", "任务不存在。")
        if task.status in ("completed", "failed"):
            return {"cancelled": False, "reason": "任务已结束"}
        # 同步执行时无法真正中断正在运行的任务，只能标记；下一阶段边界生效
        task.cancel_requested = True
        task.status = "failed"
        task.error_code = "CANCELLED"
        task.stage = "failed"
        task.stage_message = "用户取消"
        self.db.add(task)
        await self.db.commit()
        return {"cancelled": True, "note": "已标记取消；同步执行中的任务在下一阶段边界停止"}
