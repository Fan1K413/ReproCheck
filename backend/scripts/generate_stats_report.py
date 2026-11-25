"""统计审计报告生成器：用测试数据集跑引擎，产出可复算的 JSON + Markdown 报告。

用法：
    cd backend
    PYTHONPATH=. ./.venv/Scripts/python.exe scripts/generate_stats_report.py

输出：
    audit-reports/stats_audit_report.json
    audit-reports/stats_audit_report.md

注意：本脚本只做编排与格式化，所有统计值来自 app.statsaudit 引擎，可独立复算。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from app.statsaudit import get_catalog, run_stats_audit  # noqa: E402

MATERIALS = BACKEND / "test_materials" / "statsaudit"
OUT_DIR = ROOT / "audit-reports"


def _load(name: str) -> dict:
    path = MATERIALS / name
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def build_payload() -> dict:
    """合并三份测试材料为一个 payload；子模块各自取用所需字段。"""
    payload: dict = {}
    for name in ("experiment_statistics.json", "ml_metrics.json", "experiment_design.json"):
        data = _load(name)
        # 测试材料可能带一层说明键，取 payload 子键或整体合并。
        if isinstance(data, dict) and "payload" in data:
            data = data["payload"]
        if isinstance(data, dict):
            payload.update(data)
    return payload


def report_markdown(report: dict, catalog: dict) -> str:
    lines: list[str] = []
    lines.append("# ReproCheck 统计学与实验结果可信度审计报告\n")
    lines.append(f"- 报告编号：`{report['report_id']}`")
    lines.append(f"- 生成时间：{report['created_at']}")
    lines.append(f"- 引擎版本：{report['version']}")
    lines.append(f"- 发现总数：{len(report['findings'])}；阻断级：{report['blocking_count']}\n")

    lines.append("## 一、可信度分类统计\n")
    lines.append("| 分类 | 中文 | 数量 |")
    lines.append("|---|---|---|")
    label = {v["value"]: v["label_zh"] for v in catalog["verdicts"]}
    for key in ("calculation_error", "method_inapplicable", "insufficient_evidence",
                "potential_bias", "needs_human_review", "verified"):
        lines.append(f"| {key} | {label.get(key, '')} | {report['counts'].get(key, 0)} |")

    lines.append("\n## 二、逐条发现\n")
    for f in report["findings"]:
        lines.append(f"### [{f['rule_id']}] {f['rule_name']} — {f.get('verdict_label_zh', f['verdict'])}")
        lines.append(f"- **结论**：{f['message']}")
        if f.get("justification"):
            lines.append(f"- **依据**：{f['justification']}")
        if f.get("suggestion"):
            lines.append(f"- **建议**：{f['suggestion']}")
        if f.get("evidence"):
            lines.append("- **可复算证据**：")
            for e in f["evidence"]:
                if e.get("formula"):
                    lines.append(f"  - 公式：{e['formula']}")
                if e.get("claimed") or e.get("recomputed"):
                    lines.append(f"  - 报告值：{e.get('claimed')}　重算值：{e.get('recomputed')}")
        lines.append("")

    lines.append("## 三、边界与未验证项\n")
    for item in report["limitations"]:
        lines.append(f"- {item}")
    lines.append("\n> 本报告只评估统计证据的合理性，不构成对任何论文学术诚信的判断；")
    lines.append("> 相关性表述不等于因果关系，所有发现均建议结合原始数据人工复核。\n")
    return "\n".join(lines)


def main():
    payload = build_payload()
    report = run_stats_audit(payload).to_dict()
    catalog = get_catalog()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "stats_audit_report.json"
    md_path = OUT_DIR / "stats_audit_report.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(report_markdown(report, catalog), encoding="utf-8")
    print(f"[OK] JSON 报告: {json_path}")
    print(f"[OK] MD  报告: {md_path}")
    print(f"[OK] 发现 {len(report['findings'])} 条, 分类统计: {report['counts']}")


if __name__ == "__main__":
    main()
