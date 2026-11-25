"""数据质量与数据完整性审计引擎（第十阶段独立升级模块）。

设计原则：
- 独立包，不修改现有解析/抽取/核验核心代码；
- 纯本地确定性计算，不调用外部模型，不上传数据；
- 只读访问原始文件，审计过程绝不修改源数据；
- 大文件流式/分块处理，带资源上限；
- 每条发现必须携带可追溯证据（文件、字段、样本、代码位置）。

对外入口：
    from app.dataaudit import run_data_audit
"""
from __future__ import annotations

from app.dataaudit.engine import run_data_audit, run_audit_on_paths
from app.dataaudit.schema import (
    RULE_CATALOG,
    AuditReport,
    Evidence,
    Finding,
    RuleDef,
    Severity,
)

__all__ = [
    "run_data_audit",
    "run_audit_on_paths",
    "AuditReport",
    "Finding",
    "Evidence",
    "RuleDef",
    "Severity",
    "RULE_CATALOG",
]
