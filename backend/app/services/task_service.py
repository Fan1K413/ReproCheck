"""解析任务编排服务（Init → Step → Poll → Pause/Resume/Cancel 可恢复设计）。

结合当前部署能力：任务同步执行但完整落库，服务重启后从 DB 读取真实状态，
不假装拥有分布式任务调度能力；暂停/取消/超时在每个阶段边界由数据库状态真实生效。
"""
from __future__ import annotations

import json
import time
import uuid
from asyncio import to_thread
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, EvidenceValidationError
from app.core.logging import logger
from app.modelhub.gateway import model_gateway
from app.models import Material, SourceChunk
from app.models.stage2 import MaterialParseRun, ParseTask
from app.parsers.limits import ParserError
from app.parsers.registry import parse_file
from app.schemas.parsing import ParseResult
from app.services.extraction_service import ExtractionResult, ExtractionService
from app.services.material_service import MaterialService

STAGE_LABELS = {
    "uploaded": "已上传", "queued": "排队中", "parsing": "解析材料中",
    "extracting": "AI 抽取事实中", "paused": "已暂停",
    "completed": "已完成", "partially_completed": "部分完成",
    "failed": "失败", "unsupported": "不支持",
}

# 失败分类枚举：只允许这六类，便于统计与前端展示
FAILURE_CATEGORIES = ("parse", "extraction", "timeout", "stale", "cancelled", "unknown")

# 可暂停/可被服务重启恢复的活跃状态
ACTIVE_STATUSES = ("queued", "running", "parsing", "extracting")
DEFAULT_TIMEOUT_SECONDS = 600
DEFAULT_STALE_MINUTES = 15


def _now() -> datetime:
    """统一使用 UTC 时间，避免 SQLite 无时区返回导致的比较错误。"""
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class TaskService:
    def __init__(self, db: AsyncSession, extraction: ExtractionService | None = None) -> None:
        self.db = db
        self.materials = MaterialService(db)
        self.extraction = extraction or ExtractionService(db)

    async def _get_task(self, task_id: str) -> ParseTask:
        task = (await self.db.execute(
            select(ParseTask).where(ParseTask.id == task_id)
        )).scalar_one_or_none()
        if task is None:
            raise AppError("NOT_FOUND", "任务不存在。")
        return task

    async def _touch(self, task: ParseTask) -> None:
        """阶段边界写心跳，供服务重启后判定任务是否卡死。"""
        task.heartbeat_at = _now()
        self.db.add(task)
        await self.db.commit()

    async def _check_timeout(self, task: ParseTask) -> None:
        """基于 started_at 与 timeout_seconds 自动判定超时。"""
        base = _as_utc(task.started_at) or _as_utc(task.created_at)
        if base is None:
            return
        ttl = int(task.timeout_seconds or DEFAULT_TIMEOUT_SECONDS)
        if _now() - base > timedelta(seconds=ttl):
            await self.mark_timeout(task.id)
            raise AppError("TASK_TIMEOUT", "任务执行超时，已终止。", status_code=504)

    async def _check_controls(self, task: ParseTask) -> None:
        """阶段边界：刷新数据库状态，暂停立即生效，随后写心跳并检查超时。"""
        await self.db.refresh(task)
        if task.status == "paused":
            raise AppError("TASK_PAUSED", "任务已暂停，停止推进。", status_code=409)
        await self._check_timeout(task)
        await self._touch(task)

    @staticmethod
    def _category_for(code: str, stage: str) -> str:
        """把错误码归入固定失败分类，禁止写入枚举外的值。"""
        if code == "CANCELLED":
            return "cancelled"
        if code in ("TASK_TIMEOUT", "LLM_TIMEOUT"):
            return "timeout"
        category = "extraction" if stage == "extracting" else "parse"
        return category if category in FAILURE_CATEGORIES else "unknown"

    async def start(self, material_id: str, *, idem_key: str | None = None) -> ParseTask:
        material = await self.materials.get(material_id)
        key = idem_key or f"{material_id}:{material.sha256 or ''}"

        # 幂等：同 material + 同哈希的 queued/running 任务直接复用
        existing = (await self.db.execute(
            select(ParseTask).where(
                ParseTask.idem_key == key,
                ParseTask.status.in_(["queued", "running", "parsing", "extracting"]),
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

        # LLM Key 不再硬阻塞任务创建：确定性解析（PDF/Python AST/配置/CSV）
        # 始终可以执行；AI 事实抽取在 run() 的 extracting 阶段按 Key 是否存在
        # 独立决定，无 Key 时标记为 partially_completed 并保留证据原文。
        # 治理门 require_ai_consent 同样延迟到 run() 的抽取前检查。

        task = ParseTask(
            id=f"task-{uuid.uuid4().hex[:16]}",
            project_id=material.project_id, material_id=material_id,
            idem_key=key, status="queued", stage="queued",
            stage_message="任务已创建", model=settings.llm_model,
            prompt_version="", timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
            failure_category="", resume_count=0, heartbeat_at=_now(),
        )
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)
        return task

    async def run(self, task_id: str) -> ParseTask:
        """执行任务（同步）。前端通过 GET /parse-tasks/{id} 查询真实状态。"""
        task = await self._get_task(task_id)
        # 暂停在开始前也必须生效，不允许把 paused 覆盖成 parsing
        if task.status == "paused":
            raise AppError("TASK_PAUSED", "任务已暂停，停止推进。", status_code=409)
        await self._check_timeout(task)

        t0 = time.perf_counter()
        task.status = "parsing"
        task.stage = "parsing"
        task.stage_message = STAGE_LABELS["parsing"]
        task.started_at = _now()
        task.heartbeat_at = _now()
        self.db.add(task)
        await self.db.commit()

        material = await self.materials.get(task.material_id)
        parse_run = MaterialParseRun(
            id=f"mpr-{uuid.uuid4().hex[:16]}",
            material_id=material.id, project_id=material.project_id,
            parser_status="parsing", started_at=_now(),
        )
        self.db.add(parse_run)
        await self.db.commit()

        current_stage = "parse"
        try:
            await self._check_controls(task)
            if task.cancel_requested:
                task.status = "failed"
                task.stage = "failed"
                task.error_code = "CANCELLED"
                task.failure_category = "cancelled"
                task.stage_message = "用户取消"
                await self.db.commit()
                return task

            path = await self.materials.path_of(material)
            # 确定性解析（不使用模型）
            parse_result: ParseResult = await to_thread(
                parse_file, path, material_id=material.id, project_id=material.project_id,
                source_name=material.original_filename or material.source_name,
            )
            await self._check_controls(task)
            if task.cancel_requested:
                task.status = "failed"
                task.stage = "failed"
                task.error_code = "CANCELLED"
                task.failure_category = "cancelled"
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
            parse_run.completed_at = _now()

            if not parse_result.chunks:
                # 解析无内容：明确失败/部分完成，不进入抽取
                task.status = "failed"
                task.stage = "failed"
                task.error_code = parse_result.error_code or "NO_CHUNKS"
                task.error_message = parse_result.error_message or "解析未产生可用文本块。"
                task.stage_message = "解析失败"
                task.failure_category = "parse"
                await self.db.commit()
                return task

            # AI 抽取（无 LLM Key 时优雅降级，保留确定性解析结果）
            current_stage = "extracting"
            model_task = "pdf_extraction" if parse_result.material_type == "pdf" else "fact_extraction"
            llm_available = await model_gateway.is_configured(self.db, model_task, material.project_id)
            llm_skip_reason = None  # 记录跳过原因（用于治理门阻断）
            if llm_available:
                # 治理门：开启 require_ai_consent 时，调用外部模型前必须有有效授权
                from app.models import Project
                from app.services.governance_service import ensure_ai_consent
                proj = (await self.db.execute(
                    select(Project).where(Project.id == material.project_id)
                )).scalar_one_or_none()
                try:
                    await ensure_ai_consent(self.db, material.project_id,
                                           proj.org_id if proj else None)
                except AppError as exc:
                    llm_available = False
                    llm_skip_reason = exc.code

            if llm_available:
                task.status = "extracting"
                task.stage = "extracting"
                task.stage_message = STAGE_LABELS["extracting"]
                self.db.add(task)
                await self.db.commit()
                await self._check_controls(task)

                if task.cancel_requested:
                    task.status = "failed"
                    task.stage = "failed"
                    task.error_code = "CANCELLED"
                    task.failure_category = "cancelled"
                    await self.db.commit()
                    return task

                try:
                    ex: ExtractionResult = await self.extraction.extract(
                        material=material, parse_result=parse_result,
                        project_id=material.project_id, task_id=task.id,
                    )
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
                except AppError as exc:
                    # LLM_KEY_NOT_CONFIGURED / CONSENT_REQUIRED / AIRun 失败
                    # → 不把整个任务判为失败，降级为部分完成
                    logger.info("llm_extraction_skipped task=%s code=%s", task.id, exc.code)
                    task.status = "partially_completed"
                    task.stage = "partially_completed"
                    task.stage_message = f"解析完成，AI 抽取跳过：{exc.message}"
                    task.failure_category = ""
                    task.error_code = exc.code
                    task.error_message = exc.message[:500]
                    task.facts_count = 0
                    task.result_json = json.dumps({
                        "llm_skipped": True, "reason": exc.code,
                        "parse_only_chunks": len(parse_result.chunks),
                    }, ensure_ascii=False)
                    self.db.add(task)
                    await self.db.commit()
                    return task
            else:
                # 无 LLM Key 或治理门拒绝：跳过抽取，直接标记部分完成
                reason = llm_skip_reason or "LLM_NOT_CONFIGURED"
                task.status = "partially_completed"
                task.stage = "partially_completed"
                task.stage_message = "解析完成，AI 抽取跳过（未配置 API Key 或未授权）"
                task.failure_category = ""
                task.error_code = reason
                task.facts_count = 0
                task.result_json = json.dumps({
                    "llm_skipped": True, "reason": reason,
                    "parse_only_chunks": len(parse_result.chunks),
                }, ensure_ascii=False)
                self.db.add(task)
                await self.db.commit()

            # 无论是否执行了 LLM 抽取，确定性程序事实始终补充（不依赖模型）
            try:
                async with self.db.begin_nested():
                    await self.extraction.add_program_facts(
                        material=material, parse_result=parse_result, project_id=material.project_id,
                    )
            except Exception as exc:  # noqa: BLE001
                logger.warning("program_facts_failed material=%s err=%s", material.id, str(exc)[:200])

            if task.status != "partially_completed":
                task.status = "completed"
                task.stage = "completed"
                task.stage_message = "解析与抽取完成"
                task.failure_category = ""
                await self._touch(task)
        except AppError as exc:
            if exc.code in ("TASK_PAUSED", "TASK_TIMEOUT"):
                # 暂停/超时是控制流，不按普通失败覆盖任务状态
                parse_run.parser_status = "paused" if exc.code == "TASK_PAUSED" else "failed"
                parse_run.error_code = None if exc.code == "TASK_PAUSED" else "TASK_TIMEOUT"
                parse_run.completed_at = _now()
                if exc.code == "TASK_TIMEOUT":
                    task.failure_category = "timeout"
                self.db.add_all([task, parse_run])
                await self.db.commit()
                raise
            code = exc.code
            task.status = "failed"
            task.stage = "failed"
            task.error_code = code
            task.error_message = exc.message[:500]
            task.stage_message = "失败"
            task.failure_category = self._category_for(code, current_stage)
            material.parse_status = "failed"
            material.parse_error_code = code
            material.parse_error_message = task.error_message
            parse_run.parser_status = "failed"
            parse_run.error_code = code
            parse_run.error_message = task.error_message
            self.db.add_all([task, material, parse_run])
            await self.db.commit()
        except ParserError as exc:
            code = getattr(exc, "code", "PARSER_ERROR")
            task.status = "failed"
            task.stage = "failed"
            task.error_code = code
            task.error_message = str(exc)[:500]
            task.stage_message = "失败"
            task.failure_category = "parse"
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
            task.failure_category = "unknown"
            self.db.add(task)
            await self.db.commit()
        finally:
            task.duration_ms = int((time.perf_counter() - t0) * 1000)
            if task.status != "paused":
                task.completed_at = _now()
            parse_run.duration_ms = task.duration_ms
            parse_run.completed_at = parse_run.completed_at or _now()
            self.db.add_all([task, parse_run])
            await self.db.commit()

        return task

    async def pause(self, task_id: str) -> ParseTask:
        """仅活跃任务可暂停；暂停在 run() 的下一个阶段边界真实生效。"""
        task = await self._get_task(task_id)
        if task.status not in ACTIVE_STATUSES:
            raise AppError(
                "INVALID_STATE", "仅排队或执行中的任务可暂停。", status_code=409
            )
        task.status = "paused"
        task.paused_at = _now()
        task.stage_message = "已暂停，等待恢复"
        self.db.add(task)
        await self.db.commit()
        return task

    async def resume(self, task_id: str) -> ParseTask:
        """仅 paused 可恢复；不自动重跑，由调用方决定是否再次触发 run()。"""
        task = await self._get_task(task_id)
        if task.status != "paused":
            raise AppError("INVALID_STATE", "仅暂停任务可恢复。", status_code=409)
        task.status = "queued"
        task.stage = "queued"
        task.stage_message = "已恢复，等待重新执行"
        task.resume_count = (task.resume_count or 0) + 1
        task.paused_at = None
        task.heartbeat_at = _now()
        self.db.add(task)
        await self.db.commit()
        return task

    async def mark_timeout(self, task_id: str) -> ParseTask:
        """统一超时落库入口，分类固定为 timeout。"""
        task = await self._get_task(task_id)
        task.status = "failed"
        task.stage = "failed"
        task.stage_message = "任务超时"
        task.error_code = "TASK_TIMEOUT"
        task.error_message = "任务超过允许的执行时长，已终止。"
        task.failure_category = "timeout"
        task.completed_at = _now()
        self.db.add(task)
        await self.db.commit()
        return task

    async def recover_stale_tasks(
        self, stale_minutes: int = DEFAULT_STALE_MINUTES, *, project_id: str | None = None
    ) -> int:
        """服务重启后恢复心跳过期的活跃任务，返回恢复数量。

        兼容旧数据：heartbeat_at 为空时退化为 created_at 判定，
        避免刚创建但还没有心跳的新任务被误伤。
        """
        threshold = _now() - timedelta(minutes=stale_minutes)
        stmt = select(ParseTask).where(ParseTask.status.in_(ACTIVE_STATUSES))
        if project_id:
            stmt = stmt.where(ParseTask.project_id == project_id)
        rows = (await self.db.execute(stmt)).scalars().all()

        recovered = 0
        for task in rows:
            heartbeat = _as_utc(task.heartbeat_at)
            created = _as_utc(task.created_at)
            reference = heartbeat or created or threshold
            if reference >= threshold:
                continue
            task.status = "failed"
            task.stage = "failed"
            task.stage_message = "服务重启恢复：任务心跳过期"
            task.error_code = "STALE_RECOVERED"
            task.error_message = "任务心跳过期，已由服务重启恢复流程终止。"
            task.failure_category = "stale"
            task.completed_at = _now()
            self.db.add(task)
            recovered += 1
        if recovered:
            await self.db.commit()
        return recovered

    async def retry(self, task_id: str) -> ParseTask:
        task = await self._get_task(task_id)
        if task.status not in ("failed", "unsupported"):
            raise AppError("VALIDATION_ERROR", "仅失败任务可重试。", status_code=409)
        task.status = "queued"
        task.stage = "queued"
        task.stage_message = "重新排队"
        task.error_code = None
        task.error_message = None
        task.failure_category = ""
        task.paused_at = None
        task.heartbeat_at = _now()
        task.cancel_requested = False
        self.db.add(task)
        await self.db.commit()
        return await self.run(task.id)

    async def cancel(self, task_id: str) -> dict:
        task = await self._get_task(task_id)
        if task.status in ("completed", "failed"):
            return {"cancelled": False, "reason": "任务已结束"}
        # 同步执行时无法真正中断正在运行的任务，只能标记；下一阶段边界生效
        task.cancel_requested = True
        task.status = "failed"
        task.error_code = "CANCELLED"
        task.failure_category = "cancelled"
        task.stage = "failed"
        task.stage_message = "用户取消"
        task.completed_at = _now()
        self.db.add(task)
        await self.db.commit()
        return {"cancelled": True, "note": "已标记取消；同步执行中的任务在下一阶段边界停止"}
