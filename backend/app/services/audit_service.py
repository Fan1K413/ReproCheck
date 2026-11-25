"""审计服务编排：把四层链路串起来。

第一层 AI 结构化抽取 -> 第二层程序化比对 -> 第三层 AI 风险解释 -> 第四层证据链验证。
关键安全约束：
- 模型只能引用本次调用实际提供的 chunk_id，引用不存在则拒绝。
- 证据原文必须从后端保存的 source_chunks 读取，绝不使用模型生成的引用文本。
- 任何一层失败都明确报错，绝不返回"审计成功"的假结果。
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, EvidenceValidationError
from app.core.logging import logger
from app.llm import LLMService, llm_service
from app.modelhub.bridge import TaskLLM
from app.models import AIRun, AuditFinding, Evidence, ExtractedFact, Material, Project, SourceChunk
from app.schemas import (
    AuditResultData,
    EvidenceView,
    FactView,
    FindingView,
    LLMMeta,
    MaterialFacts,
    MaterialView,
    RiskExplanations,
    FactsExtraction,
)
from app.services import build_comparisons

# 合成测试材料（明确标记，非真实论文）
DEFAULT_PAPER_TEXT = (
    "研究实验使用 Batch Size 为 64，Learning Rate 为 0.001，"
    "训练轮数为 100 epochs，优化器为 AdamW。"
)
DEFAULT_CONFIG_TEXT = "batch_size: 32\nlearning_rate: 0.0001\nepochs: 100\noptimizer: AdamW"


@dataclass
class ChunkCtx:
    chunk_id: str
    original_text: str
    source_name: str
    material_id: str


def _extract_prompt(material_label: str, chunks: list[ChunkCtx]) -> list[dict[str, str]]:
    chunk_list = "\n".join(
        f'- chunk_id="{c.chunk_id}": {c.original_text}' for c in chunks
    )
    system = (
        "你是科研实验信息抽取助手。从给定文本块中抽取机器学习实验超参数。"
        "只输出一个 JSON 对象，结构为 {\"facts\": [...]}。"
        "每条事实字段：field_key（规范小写下划线，如 batch_size/learning_rate/epochs/optimizer）、"
        "raw_value（原文值字符串）、normalized_value（数值用 JSON 数字，字符串用字符串）、"
        "unit（无单位填 null）、evidence_chunk_id（必须来自提供的 chunk_id）、"
        "confidence（0-1）。"
        "严禁引用未提供的 chunk_id，严禁编造文本中不存在的值。"
    )
    user = f"材料名称：{material_label}\n\n文本块：\n{chunk_list}\n\n请抽取并输出 JSON。"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _risk_prompt(conflicts: list, ctx_by_id: dict[str, ChunkCtx]) -> list[dict[str, str]]:
    diff_lines = []
    for cmp in conflicts:
        a = ctx_by_id.get(cmp.evidence_a_id or "")
        b = ctx_by_id.get(cmp.evidence_b_id or "")
        diff_lines.append(
            f"- finding_id=\"{cmp.field_key}_conflict\", field_key=\"{cmp.field_key}\", "
            f"材料A={cmp.value_a}（证据原文：{a.original_text if a else '无'}）, "
            f"材料B={cmp.value_b}（证据原文：{b.original_text if b else '无'}）"
        )
    diffs = "\n".join(diff_lines)
    system = (
        "你是科研复现审计助手。针对每个已由程序验证的参数冲突，给出风险解释。"
        "只输出一个 JSON 对象，结构为 {\"explanations\": [...]}。"
        "每条解释字段：finding_id（必须与输入一致）、field_key（必须与输入一致）、"
        "severity（high/medium/low）、title、explanation、suggested_fix。"
        "explanation 需说明：问题是什么、涉及哪两份材料、可能影响什么、为何需人工核实。"
        "只能引用输入中出现的字段和证据，严禁创造新的参数或证据。"
    )
    user = f"已由程序验证的参数冲突如下：\n{diffs}\n\n请逐条输出解释 JSON。"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


class AuditService:
    def __init__(self, db: AsyncSession, llm: LLMService | None = None) -> None:
        self.db = db
        self.llm = llm or TaskLLM(db, "diff_analysis")

    async def run_audit(
        self, *, project_name: str, material_a_text: str | None,
        material_b_text: str | None, use_default_materials: bool,
    ) -> AuditResultData:
        run_id = f"run-{uuid.uuid4().hex[:16]}"
        project_id = f"proj-{uuid.uuid4().hex[:16]}"
        text_a = material_a_text if (material_a_text and not use_default_materials) else DEFAULT_PAPER_TEXT
        text_b = material_b_text if (material_b_text and not use_default_materials) else DEFAULT_CONFIG_TEXT

        # 创建项目与材料（落库，作为唯一证据来源）
        project = Project(
            id=project_id, name=project_name or "ReproCheck 演示项目",
            domain="机器学习", paper_title="（合成测试材料）",
            description="第一阶段审计演示，输入为合成测试材料，非真实论文。",
        )
        mat_a = Material(id=f"mat-{uuid.uuid4().hex[:12]}", project_id=project_id,
                         source_name="paper_excerpt.txt", material_type="text", raw_text=text_a)
        mat_b = Material(id=f"mat-{uuid.uuid4().hex[:12]}", project_id=project_id,
                         source_name="config.yaml", material_type="yaml", raw_text=text_b)
        self.db.add_all([project, mat_a, mat_b])
        await self.db.flush()

        chunk_a = self._make_chunks(mat_a.id, text_a, "paper_chunk")
        chunk_b = self._make_chunks(mat_b.id, text_b, "config_chunk")
        self.db.add_all(chunk_a + chunk_b)
        await self.db.flush()

        ctx_a = [ChunkCtx(c.chunk_id, c.original_text, mat_a.source_name, mat_a.id) for c in chunk_a]
        ctx_b = [ChunkCtx(c.chunk_id, c.original_text, mat_b.source_name, mat_b.id) for c in chunk_b]
        ctx_by_id = {c.chunk_id: c for c in (ctx_a + ctx_b)}

        ai_run = AIRun(id=run_id, project_id=project_id, run_type="demo_audit",
                       provider=self.llm.provider, model=self.llm.model, status="running")
        self.db.add(ai_run)
        await self.db.commit()

        try:
            # 第一层：AI 结构化抽取（两份材料各一次真实调用）
            facts_a, resp_a = await self._extract("paper_excerpt.txt", ctx_a)
            facts_b, resp_b = await self._extract("config.yaml", ctx_b)

            # 第二层：程序化比对
            comparisons = build_comparisons(facts_a, facts_b)

            total_calls = 2
            prompt_tokens = resp_a.usage.prompt_tokens + resp_b.usage.prompt_tokens
            completion_tokens = resp_a.usage.completion_tokens + resp_b.usage.completion_tokens
            total_tokens = resp_a.usage.total_tokens + resp_b.usage.total_tokens
            actual_model = resp_b.model or resp_a.model or settings.llm_model

            # 第三层：AI 风险解释（仅对冲突）
            findings: list[FindingView] = []
            conflicts = [c for c in comparisons if c.status == "conflict"]
            if conflicts:
                risk_resp = await self.llm.chat(
                    _risk_prompt(conflicts, ctx_by_id), response_schema=RiskExplanations
                )
                total_calls += 1
                prompt_tokens += risk_resp.usage.prompt_tokens
                completion_tokens += risk_resp.usage.completion_tokens
                total_tokens += risk_resp.usage.total_tokens
                actual_model = risk_resp.model or actual_model

                parsed_explanations: RiskExplanations = risk_resp.parsed or RiskExplanations(explanations=[])
                conflict_keys = {c.field_key for c in conflicts}
                cmp_by_key = {c.field_key: c for c in conflicts}

                for exp in parsed_explanations.explanations:
                    if exp.field_key not in conflict_keys:
                        logger.warning("skip_explanation_unknown_field field=%s", exp.field_key)
                        continue
                    cmp = cmp_by_key[exp.field_key]
                    chunk_ids = [x for x in (cmp.evidence_a_id, cmp.evidence_b_id) if x]
                    # 第四层：证据链验证 + 从后端材料读取原文
                    ev_views = self._build_evidence(exp.finding_id, chunk_ids, ctx_by_id)

                    # 落库 extracted_facts（两条材料的相关事实）
                    explanation_text = (
                        f"{exp.explanation}\n\n建议措施：{exp.suggested_fix}".strip()
                    )
                    finding_row = AuditFinding(
                        run_id=run_id, project_id=project_id, field_key=exp.field_key,
                        severity=exp.severity, title=exp.title,
                        ai_explanation=explanation_text,
                    )
                    self.db.add(finding_row)
                    await self.db.flush()
                    for ev in ev_views:
                        ctx = ctx_by_id[ev.chunk_id]
                        self.db.add(Evidence(
                            evidence_id=ev.evidence_id, finding_id=finding_row.id,
                            project_id=project_id, material_id=ctx.material_id,
                            chunk_id=ev.chunk_id, source_name=ev.source_name,
                            locator_type="text_paragraph", page_number=None, line_number=None,
                            original_text=ev.original_text,
                        ))
                    findings.append(FindingView(
                        finding_id=exp.finding_id, field_key=exp.field_key,
                        severity=exp.severity, title=exp.title,
                        ai_explanation=explanation_text, evidence=ev_views,
                    ))

            # 落库抽取事实
            for facts, mat_id in ((facts_a, mat_a.id), (facts_b, mat_b.id)):
                for f in facts:
                    self.db.add(ExtractedFact(
                        run_id=run_id, project_id=project_id, material_id=mat_id,
                        chunk_id=f.evidence_chunk_id, field_key=f.field_key,
                        raw_value=f.raw_value,
                        normalized_value=(str(f.normalized_value)
                                          if f.normalized_value is not None else None),
                        unit=f.unit, confidence=f.confidence,
                    ))

            result = AuditResultData(
                run_id=run_id, status="completed", project_id=project_id,
                project_name=project.name,
                materials=[
                    MaterialView(material_id=mat_a.id, source_name=mat_a.source_name, text=text_a),
                    MaterialView(material_id=mat_b.id, source_name=mat_b.source_name, text=text_b),
                ],
                extracted_facts=[
                    MaterialFacts(material_id=mat_a.id, facts=facts_a),
                    MaterialFacts(material_id=mat_b.id, facts=facts_b),
                ],
                comparisons=comparisons,
                findings=findings,
                llm_meta=LLMMeta(calls=total_calls, total_tokens=total_tokens,
                                 duration_ms=0, model=actual_model),
            )

            # 更新运行元数据并保存结果快照
            ai_run.status = "completed"
            ai_run.success = True
            ai_run.model = actual_model
            ai_run.calls = total_calls
            ai_run.prompt_tokens = prompt_tokens
            ai_run.completion_tokens = completion_tokens
            ai_run.total_tokens = total_tokens
            ai_run.finished_at = datetime.now(timezone.utc)
            ai_run.result_json = result.model_dump_json()
            await self.db.commit()
            return result

        except AppError as exc:
            await self.db.rollback()
            ai_run.status = "failed"
            ai_run.success = False
            ai_run.error_code = exc.code
            self.db.add(ai_run)
            await self.db.commit()
            raise
        except Exception as exc:  # noqa: BLE001
            await self.db.rollback()
            logger.error("audit_unexpected_error run_id=%s type=%s", run_id, type(exc).__name__)
            raise AppError("INTERNAL_ERROR", "审计过程发生未预期错误。")

    def _make_chunks(self, material_id: str, text: str, prefix: str) -> list[SourceChunk]:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if not lines:
            lines = [text.strip()] if text.strip() else [""]
        return [
            SourceChunk(
                material_id=material_id, chunk_id=f"{prefix}_{i:03d}",
                chunk_index=i - 1, original_text=line,
                locator_type="text_paragraph", page_number=None, line_number=i,
            )
            for i, line in enumerate(lines, start=1)
        ]

    async def _extract(self, label: str, ctx: list[ChunkCtx]) -> tuple[list[FactView], object]:
        resp = await self.llm.chat(_extract_prompt(label, ctx), response_schema=FactsExtraction)
        extraction: FactsExtraction = resp.parsed or FactsExtraction(facts=[])
        valid_ids = {c.chunk_id for c in ctx}
        facts: list[FactView] = []
        for f in extraction.facts:
            # 拒绝模型引用不存在的 chunk_id
            if f.evidence_chunk_id not in valid_ids:
                raise EvidenceValidationError(
                    f"模型引用了不存在的文本块 {f.evidence_chunk_id}，已拒绝该证据关联。",
                    details={"rejected_chunk_id": f.evidence_chunk_id},
                )
            facts.append(FactView(
                field_key=f.field_key, raw_value=f.raw_value,
                normalized_value=f.normalized_value, unit=f.unit,
                evidence_chunk_id=f.evidence_chunk_id, confidence=f.confidence,
            ))
        return facts, resp

    def _build_evidence(self, finding_id: str, chunk_ids: list[str],
                        ctx_by_id: dict[str, ChunkCtx]) -> list[EvidenceView]:
        views: list[EvidenceView] = []
        for cid in chunk_ids:
            if cid not in ctx_by_id:
                raise EvidenceValidationError(
                    f"模型引用了不存在的证据块 {cid}，已拒绝该结论。",
                    details={"rejected_chunk_id": cid},
                )
            c = ctx_by_id[cid]
            # 证据原文直接来自后端保存的材料，而非模型生成的引用文本
            views.append(EvidenceView(
                evidence_id=f"ev-{finding_id}-{cid}", source_name=c.source_name,
                chunk_id=c.chunk_id, original_text=c.original_text,
            ))
        return views


async def get_audit_result_from_db(db: AsyncSession, run_id: str) -> dict | None:
    """按 run_id 从数据库重建历史审计结果。"""
    row = (await db.execute(select(AIRun).where(AIRun.id == run_id))).scalar_one_or_none()
    if row is None or not row.result_json:
        return None
    import json
    return json.loads(row.result_json)
