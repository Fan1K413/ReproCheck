"""正式科研复现审计报告生成器（HTML + 可选 PDF）。

区分：AI 分析 / 程序检测 / 实际执行 / 人工判断 / 无法验证。
每个关键结论带 sources 证据引用；PDF 不可用时明确标注，不伪造导出。
"""
from __future__ import annotations

import html
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models import ExtractedFact, Project
from app.models.stage4 import (
    ExecutionEnvironment,
    FailureDiagnostic,
    MetricComparison,
    RemediationProposal,
    RemediationReview,
    ReproductionPlan,
    ReproductionReport,
    ReproductionRun,
    ReproductionTask,
)
from app.reproduction.results import QualityEvaluator

CHAPTERS = [
    "项目基本信息", "论文与科研材料清单", "复现目标和实验范围", "反向复现任务规划",
    "复现环境与依赖信息", "代码安全检查结果", "任务执行记录", "实验运行结果",
    "论文结果与复现结果对照", "复现差异与失败原因", "证据链与来源定位",
    "问题修复建议", "人工复核记录", "最终复现结论与限制说明",
]


class ReportGenerator:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def generate(self, project_id: str, plan_id: str | None = None,
                       run_ids: list[str] | None = None) -> ReproductionReport:
        project = (await self.db.execute(
            select(Project).where(Project.id == project_id)
        )).scalar_one_or_none()
        if project is None:
            from app.core.errors import AppError
            raise AppError("NOT_FOUND", "项目不存在。")

        plans = (await self.db.execute(
            select(ReproductionPlan).where(ReproductionPlan.project_id == project_id)
        )).scalars().all()
        tasks = (await self.db.execute(
            select(ReproductionTask).where(ReproductionTask.project_id == project_id)
        )).scalars().all()
        runs = (await self.db.execute(
            select(ReproductionRun).where(ReproductionRun.project_id == project_id)
        )).scalars().all()
        envs = (await self.db.execute(
            select(ExecutionEnvironment).where(ExecutionEnvironment.project_id == project_id)
        )).scalars().all()
        comps = (await self.db.execute(
            select(MetricComparison).where(MetricComparison.project_id == project_id)
        )).scalars().all()
        facts = (await self.db.execute(
            select(ExtractedFact).where(ExtractedFact.project_id == project_id).limit(100)
        )).scalars().all()
        diags = (await self.db.execute(
            select(FailureDiagnostic).where(FailureDiagnostic.project_id == project_id)
        )).scalars().all()
        proposals = (await self.db.execute(
            select(RemediationProposal).where(RemediationProposal.project_id == project_id)
        )).scalars().all()
        reviews = (await self.db.execute(
            select(RemediationReview).where(
                RemediationReview.proposal_id.in_([p.id for p in proposals])
            ) if proposals else select(RemediationReview).where(RemediationReview.id == "__none__")
        )).scalars().all()

        quality = QualityEvaluator().evaluate(
            list(facts), len(facts),
            [{"status": r.status, "execution_enabled": r.execution_enabled} for r in runs],
            [{"verdict": c.verdict} for c in comps],
            [m for e in envs for m in json.loads(e.missing_json or "[]")],
        )

        sec: list[dict] = []
        def add(idx: int, content: str, sources: list[str], origin: str = "程序自动检测") -> None:
            sec.append({
                "index": idx + 1, "chapter": CHAPTERS[idx],
                "content": content, "sources": sources, "origin": origin,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

        add(0, f"项目名称：{project.name}；研究领域：{project.domain or '未记录'}；"
            f"论文标题：{project.paper_title or '未记录'}。报告生成时间：{datetime.now(timezone.utc).isoformat()}。",
            [f"projects:{project.id}"], "数据库记录")
        add(1, f"已抽取科研事实 {len(facts)} 条；关联材料 {len(set(f.material_id for f in facts))} 份。",
            [f"extracted_facts:{f.fact_id or f.id}" for f in facts[:8]])
        add(2, "复现目标：依据已解析材料建立可执行的复现规划；范围仅限平台已记录的材料与事实，"
            "未记录内容一律标注 materials_not_found，不推断研究未实施。",
            [f"projects:{project.id}"], "范围声明")
        add(3, f"复现规划 {len(plans)} 份，任务 {len(tasks)} 项。"
            + "；".join(f"{t.task_key} {t.title}（{t.feasibility}）" for t in tasks[:10]),
            [f"reproduction_tasks:{t.id}" for t in tasks[:8]],
            "AI 分析 + 程序可行性校验" if any(p.ai_available for p in plans) else "程序校验")
        add(4, f"环境记录 {len(envs)} 份；缺失项："
            + ("；".join(m for e in envs for m in json.loads(e.missing_json or "[]")) or "无"),
            [f"execution_environments:{e.id}" for e in envs[:8]])
        add(5, "代码安全预检结果见各运行记录 security_check 字段；所有执行默认禁用，"
            "安全阻断由程序规则决定。静态扫描不能保证绝对安全。",
            [f"reproduction_runs:{r.id}" for r in runs[:8]], "程序安全规则")
        add(6, f"运行记录 {len(runs)} 条："
            + "；".join(f"{r.id} 状态={r.status} 执行启用={r.execution_enabled}" for r in runs[:10]),
            [f"reproduction_runs:{r.id}" for r in runs[:8]], "实际运行记录")
        add(7, "实验运行结果来自 reproduction_metrics 表（若为空表示未产生可提取指标）。",
            [], "实际执行结果")
        add(8, "指标对照："
            + ("；".join(f"{c.metric_name} 论文={c.paper_value} 复现={c.reproduced_value} "
                        f"判定={c.verdict}" for c in comps[:10]) or "暂无对照记录"),
            [f"metric_comparisons:{c.id}" for c in comps[:8]], "程序对照规则")
        add(9, "差异与失败原因："
            + ("；".join(d.problem[:80] for d in diags[:6]) or "暂无诊断记录"),
            [f"failure_diagnostics:{d.id}" for d in diags[:6]],
            "AI 诊断" if any(d.ai_available for d in diags) else "无 AI 诊断")
        add(10, "证据链：每条科研事实关联 extracted_facts.chunk_id 与 evidence_items；"
            "原文来自后端材料，不采用模型生成引用文本。",
            [f"extracted_facts:{f.fact_id or f.id}" for f in facts[:10]], "证据库")
        add(11, "修复建议："
            + ("；".join(f"{p.change_type}: {(p.proposed_value or '')[:60]}" for p in proposals[:8])
               or "暂无修复建议") + "。默认不修改用户原始文件。",
            [f"remediation_proposals:{p.id}" for p in proposals[:8]], "AI 建议 + 人工审核")
        add(12, "人工复核记录："
            + ("；".join(f"{r.decision} by {r.reviewer}" for r in reviews[:8]) or "暂无人工复核"),
            [f"remediation_reviews:{r.id}" for r in reviews[:8]], "用户人工判断")
        add(13, f"复现验证覆盖度评分：{quality['overall']}（0-1）。{quality['scope_note']} "
            f"公式：{quality['formula']}。当前环境无安全隔离执行后端，代码执行未启用；"
            "本报告不构成学术质量或论文真实性判定。",
            [], "综合声明")

        html_text = self._render(project.name, sec, quality)
        pdf_path = await self._try_pdf(project.name, html_text)
        report = ReproductionReport(
            id=f"rreport-{uuid.uuid4().hex[:14]}", project_id=project_id,
            title=f"ReproCheck 复现审计报告 - {project.name}",
            status="generated", version=1,
            sections_json=json.dumps(sec, ensure_ascii=False),
            html=html_text, pdf_path=pdf_path,
            scope_note=quality["scope_note"],
        )
        self.db.add(report)
        await self.db.commit()
        return report

    @staticmethod
    def _render(title: str, sections: list[dict], quality: dict) -> str:
        parts = [
            "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='utf-8'>",
            "<title>ReproCheck 复现审计报告</title>",
            "<style>body{font-family:'Segoe UI','Microsoft YaHei',sans-serif;max-width:900px;margin:40px auto;color:#12294a;line-height:1.7}"
            "h1{border-bottom:3px solid #0b1f3a;padding-bottom:12px}h2{margin-top:36px;color:#0b1f3a;font-size:18px}"
            ".origin{color:#2e6bff;font-size:12px}.sources{color:#64748b;font-size:12px;margin:8px 0}"
            ".scope{background:#eef4ff;border-left:4px solid #2e6bff;padding:12px;margin-top:32px}"
            "table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:6px;font-size:13px}</style>",
            "</head><body>",
            f"<h1>ReproCheck 科研复现审计报告</h1><p>{html.escape(title)}</p>",
        ]
        for s in sections:
            parts.append(f"<h2>第{s['index']}章　{html.escape(s['chapter'])}</h2>")
            parts.append(f"<p>{html.escape(s['content'])}</p>")
            parts.append(f"<p class='origin'>来源类型：{html.escape(s['origin'])}</p>")
            if s["sources"]:
                parts.append("<p class='sources'>证据引用：" +
                             html.escape("；".join(s["sources"][:10])) + "</p>")
        parts.append(f"<div class='scope'><b>范围声明</b><br>{html.escape(quality['scope_note'])}<br>"
                     f"复现验证覆盖度：{quality['overall']}</div>")
        parts.append("</body></html>")
        return "".join(parts)

    @staticmethod
    async def _try_pdf(title: str, html_text: str) -> str | None:
        """尝试用可用库导出 PDF；不可用则返回 None（不伪造）。"""
        try:
            from weasyprint import HTML  # type: ignore
            out = Path("./storage/reports")
            out.mkdir(parents=True, exist_ok=True)
            path = out / f"report-{uuid.uuid4().hex[:12]}.pdf"
            HTML(string=html_text).write_pdf(str(path))
            logger.info("pdf_export_success path=%s", str(path))
            return str(path)
        except Exception as exc:  # noqa: BLE001
            logger.info("pdf_export_unavailable type=%s", type(exc).__name__)
            return None
