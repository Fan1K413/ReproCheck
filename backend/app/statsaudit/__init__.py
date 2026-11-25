"""科研统计学与实验结果可信度审计引擎（独立升级模块）。

设计原则：
- 独立包，不修改现有论文结果对照 / 复现执行 / 实验差异分析任何代码；
- 纯本地确定性计算，不调用外部模型、不上传数据、不执行用户代码；
- 每条发现携带可复算证据，六类可信度分类，禁止因果断言与学术不端定性。

对外入口：
    from app.statsaudit import run_stats_audit, get_catalog
"""
from __future__ import annotations

from app.statsaudit.engine import get_catalog, run_stats_audit
from app.statsaudit.schema import (
    RULE_CATALOG,
    VERDICT_ZH,
    Evidence,
    Finding,
    StatsReport,
    Verdict,
)

__all__ = [
    "run_stats_audit",
    "get_catalog",
    "StatsReport",
    "Finding",
    "Evidence",
    "Verdict",
    "VERDICT_ZH",
    "RULE_CATALOG",
]
