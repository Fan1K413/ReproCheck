"""科研任务自动化助手（第七阶段升级）。

自然语言 → 意图解析 → 定位项目与证据 → 创建工作流 → 执行合适的检查 → 返回结果。

- 意图解析以确定性规则为主（无 LLM Key 也可工作），预留 LLM schema 兜底扩展点；
- 高风险动作（重跑实验、应用补丁）生成的节点必须人工确认；
- 解析不到唯一项目时返回 needs_project_selection，不擅自跨项目执行；
- 所有自动创建与执行写审计轨迹。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import ExtractedFact, Material, Project
from app.services import normalize_field_key
from app.services.orchestration_service import OrchestrationService
from app.services.trail_service import record_trail

# 字段别名：中文/常见英文写法 -> 规范字段 key
FIELD_ALIASES: dict[str, str] = {
    "学习率": "learning_rate", "learning rate": "learning_rate", "lr": "learning_rate",
    "批大小": "batch_size", "batch size": "batch_size", "batch": "batch_size",
    "训练轮数": "epochs", "epoch": "epochs", "轮数": "epochs",
    "优化器": "optimizer", "optimizer": "optimizer",
    "序列长度": "max_seq_len", "seq len": "max_seq_len", "sequence length": "max_seq_len",
    "骨干": "backbone", "backbone": "backbone",
    "输入分辨率": "input_size", "input size": "input_size",
    "数据集大小": "dataset_size", "样本量": "sample_size", "sample size": "sample_size",
}

# 意图规则：(意图, 命中关键词, 处理器, 关联模板)
INTENT_RULES: list[tuple[str, tuple[str, ...], str, str]] = [
    ("compare_parameter", ("对比", "一致", "相同", "是否一致", "是否相同", "学习率", "learning rate",
                           "batch", "优化器", "epoch", "配置是否", "参数是否"),
     "compare_parameter", "ml_paper_reproduction"),
    ("evidence_check", ("证据", "支撑", "依据", "缺少证据", "缺证据"),
     "fact_evidence_check", "dataset_quality"),
    ("dataset_quality", ("数据集", "数据质量", "数据泄漏", "泄露", "分布", "字段", "编码"),
     "dataset_quality_check", "dataset_quality"),
    ("model_evaluation", ("评测", "指标", "精度", "准确率", "f1", "map", "iou", "acc"),
     "model_evaluation", "model_evaluation"),
    ("ablation", ("消融", "变体", "baseline", "基线", "去掉", "移除组件"),
     "ablation_check", "ablation_study"),
    ("hyperparam", ("超参", "超参数", "hyperparameter", "调参", "网格", "对比组"),
     "hyperparam_compare", "hyperparam_comparison"),
    ("stats_verify", ("统计", "显著性", "方差", "置信区间", "重算", "假设检验"),
     "stats_verify", "stats_verification"),
]

HIGH_RISK_WORDS = ("重跑", "重新执行", "跑实验", "训练", "应用补丁", "修改代码", "部署")


def _extract_field_key(query: str) -> str | None:
    low = query.lower()
    for alias, key in FIELD_ALIASES.items():
        if alias in low:
            return key
    return None


def parse_intent(query: str) -> dict[str, Any]:
    """确定性意图解析；返回 intent / handler / template_key / field_key / confidence。"""
    low = query.lower()
    matched: list[tuple[int, str, str, str]] = []
    for intent, keywords, handler, template in INTENT_RULES:
        hits = sum(1 for kw in keywords if kw in low)
        if hits:
            matched.append((hits, intent, handler, template))
    if not matched:
        return {"intent": "unknown", "handler": "", "template_key": "",
                "field_key": None, "confidence": 0.0,
                "raw_query": query}
    matched.sort(key=lambda x: -x[0])
    hits, intent, handler, template = matched[0]
    return {
        "intent": intent, "handler": handler, "template_key": template,
        "field_key": _extract_field_key(query),
        "confidence": min(1.0, 0.5 + 0.1 * hits), "raw_query": query,
    }


class AssistantService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def plan(self, user, project_id: str | None, query: str,
                   user_id: str | None = None) -> dict[str, Any]:
        query = (query or "").strip()
        if not query:
            raise AppError("VALIDATION_ERROR", "请输入要检查的科研任务描述。")

        intent = parse_intent(query)
        if intent["intent"] == "unknown":
            raise AppError("VALIDATION_ERROR", "未能识别该请求意图；请使用参数比对/证据检查/数据质量/评测/消融/超参/统计核验等表述。")

        resolved_project = await self._resolve_project(user, project_id)
        if resolved_project is None:
            return {"needs_project_selection": True, "intent": intent,
                    "message": "未指定唯一项目，请先选择项目。"}

        project_id = resolved_project.id
        evidence_hint = await self._collect_evidence_hint(project_id, intent)

        high_risk = any(w in query for w in HIGH_RISK_WORDS)
        node = self._build_node(intent, high_risk)

        orchestration = OrchestrationService(self.db)
        idem_key = f"assistant:{project_id}:{intent['intent']}:{intent['field_key'] or '-'}"
        wf = await orchestration.create_manual(
            project_id=project_id, title=f"助手任务：{query[:60]}",
            description=f"自然语言请求解析为 {intent['intent']} 检查。",
            nodes=[node], user_id=user_id, nl_query=query, idem_key=idem_key,
        )
        await record_trail(
            self.db, action="assistant.create_task", actor_user_id=user_id,
            project_id=project_id, target_type="workflow", target_id=wf.id,
            after={"intent": intent, "high_risk": high_risk}, summary="助手创建科研任务",
        )
        wf = await orchestration.start(wf.id, user_id=user_id)
        view = await orchestration.workflow_view(wf.id)
        return {
            "needs_project_selection": False,
            "project_id": project_id,
            "intent": intent,
            "high_risk": high_risk,
            "evidence_hint": evidence_hint,
            "workflow": view,
        }

    async def _resolve_project(self, user, project_id: str | None):
        from app.api.deps import resolve_project_access
        if project_id:
            return await resolve_project_access(self.db, project_id, user)
        # 未指定：仅当用户可访问唯一项目时自动定位
        rows = (await self.db.execute(select(Project).order_by(Project.created_at))).scalars().all()
        accessible = []
        for p in rows:
            try:
                await resolve_project_access(self.db, p.id, user)
                accessible.append(p)
            except AppError:
                continue
        if len(accessible) == 1:
            return accessible[0]
        return None

    async def _collect_evidence_hint(self, project_id: str, intent: dict[str, Any]) -> dict[str, Any]:
        facts = list((await self.db.execute(
            select(ExtractedFact).where(ExtractedFact.project_id == project_id)
        )).scalars().all())
        materials = list((await self.db.execute(
            select(Material).where(Material.project_id == project_id)
        )).scalars().all())
        field_key = intent.get("field_key")
        matched: list[dict[str, Any]] = []
        for f in facts:
            key, _ = normalize_field_key(f.field_key)
            if field_key and key != field_key:
                continue
            matched.append({"fact_id": f.fact_id or str(f.id), "field_key": f.field_key,
                            "material_id": f.material_id, "source_name": f.source_name})
        return {
            "fact_count": len(facts), "material_count": len(materials),
            "matched_facts": matched[:20],
        }

    @staticmethod
    def _build_node(intent: dict[str, Any], high_risk: bool) -> dict[str, Any]:
        node: dict[str, Any] = {
            "node_key": "A1",
            "title": f"{intent['intent']} 检查",
            "handler": intent["handler"],
            "node_type": "check",
            "depends_on": [],
            "priority": 8,
            "needs_human_confirm": high_risk,
            "risk_level": "high" if high_risk else "low",
            "evidence_targets": [intent["field_key"]] if intent.get("field_key") else [],
            "preconditions": {},
            "action": f"按自然语言请求执行 {intent['intent']} 检查。",
            "expected_result": "返回真实比对/核验结论与证据引用；数据不足时如实标注。",
        }
        return node
