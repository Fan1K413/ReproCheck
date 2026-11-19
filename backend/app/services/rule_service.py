"""C 组 · 审计规则生命周期服务。

设计原则（见 docs/AUDIT_RULE_LIFECYCLE.md）：
- 规则是「管理 / 评估层」，与既有程序化比对引擎（app/services/__init__.py、
  audit_service.py）解耦：本模块不改写生产比对行为，只负责规则的增删改查、
  版本演进、离线测试与回滚。
- AI / 用户反馈绝不能自动把判断写进生产规则；任何逻辑变更都必须由具备
  rule.manage 权限的人显式发起，且新版本必须附带 >=1 条测试样本，先离线验证。
- 版本只增不改：rollback 通过「复制目标逻辑为一个全新版本号」实现，历史完整保留。
- 所有重要变更（创建 / 启停 / 新版本 / 回滚）写审计轨迹，保留 before/after。

评估器为真实确定性逻辑（字段比对含容差、单位不一致、证据缺失），复用既有
比对引擎的字段别名 / 数值字段 / 容差常量，绝不硬编码 pass。
"""
from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import user_has_permission
from app.core.errors import AppError
from app.core.security import new_id
from app.models.stage6 import (
    AuditRule,
    AuditRuleVersion,
    OrgMember,
    RuleEvaluation,
    RuleTestSample,
    User,
)
from app.services import NUMERIC_FIELDS, REL_TOL, normalize_field_key
from app.services.trail_service import record_trail

# 支持的检查逻辑类型（评估器真实实现）
CHECK_TYPES = {"field_compare", "unit_mismatch", "missing_evidence"}
_RISK_LEVELS = {"low", "medium", "high", "critical"}


# ============================ 权限 / 工具 ============================

async def resolve_rule_org(db: AsyncSession, user: User) -> str | None:
    """规则管理是 org 级权限。返回用户具备 rule.manage 的任一组织 id。

    平台管理员直接放行；否则遍历其组织成员身份，任一组织授予 rule.manage 即可。
    没有任何组织授予该权限 -> 403。规则表本身是平台全局的（无 org_id 列），
    但「谁能管理」由 org 级 rule.manage 把关。
    """
    if user.is_platform_admin:
        m = (await db.execute(select(OrgMember).where(OrgMember.user_id == user.id))).scalars().first()
        return m.org_id if m else None
    memberships = (await db.execute(select(OrgMember).where(OrgMember.user_id == user.id))).scalars().all()
    for m in memberships:
        if await user_has_permission(db, user, "rule.manage", org_id=m.org_id):
            return m.org_id
    raise AppError("FORBIDDEN", "缺少权限：rule.manage（需要组织管理员）。")


def _loads(text: str | None, default: Any = None) -> Any:
    if not text:
        return default if default is not None else {}
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _to_num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(",", "")
    if not s:
        return None
    if s.endswith("%"):
        inner = _to_num(s[:-1])
        return inner / 100.0 if inner is not None else None
    try:
        return float(s)
    except ValueError:
        return None


def _coerce(entry: Any) -> tuple[Any, str, str]:
    """把一侧字段条目归一为 (value, unit, evidence_ref)。支持标量或富字典。"""
    if isinstance(entry, dict):
        value = entry.get("value", entry.get("normalized_value", entry.get("raw_value")))
        unit = str(entry.get("unit") or "")
        ev = str(entry.get("evidence_ref") or entry.get("evidence_chunk_id") or "")
        return value, unit, ev
    return entry, "", ""


def _sides(sample_input: dict) -> tuple[dict, dict]:
    a = sample_input.get("a") or sample_input.get("paper") or {}
    b = sample_input.get("b") or sample_input.get("repro") or {}
    if not isinstance(a, dict) or not isinstance(b, dict):
        raise AppError("VALIDATION_ERROR", "样本 input 的 a/b（或 paper/repro）须为对象。")
    return a, b


def _index(side: dict) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for raw_key, entry in side.items():
        key, _ = normalize_field_key(str(raw_key))
        out[key] = entry
    return out


def _compare(key: str, va: Any, vb: Any, ua: str, ub: str, tol: float) -> bool | None:
    """配置参数按相对容差（镜像 values_equal）；指标字段按绝对容差（镜像 MetricComparator）。"""
    if ua and ub and ua.strip().lower() != ub.strip().lower():
        return False
    na, nb = _to_num(va), _to_num(vb)
    if key in NUMERIC_FIELDS:
        if na is None or nb is None:
            return None
        return abs(na - nb) <= tol * max(abs(na), abs(nb), 1.0)
    if na is not None and nb is not None:
        return abs(na - nb) <= tol
    sa = "" if va is None else str(va).strip().lower()
    sb = "" if vb is None else str(vb).strip().lower()
    return sa == sb


# ============================ 确定性评估器 ============================

def run_check(check_logic: dict, sample_input: dict) -> dict:
    """对单条样本输入执行规则逻辑，返回真实预测（绝不硬编码）。"""
    ctype = (check_logic or {}).get("type")
    if ctype not in CHECK_TYPES:
        raise AppError("VALIDATION_ERROR", f"未知检查逻辑类型：{ctype}，须为 {sorted(CHECK_TYPES)}。")
    a_raw, b_raw = _sides(sample_input)
    a, b = _index(a_raw), _index(b_raw)
    fields = check_logic.get("fields")
    if not fields:
        fields = sorted(set(a) | set(b))
    fields = [normalize_field_key(str(f))[0] for f in fields]
    # 去重保序
    seen: set[str] = set()
    fields = [f for f in fields if not (f in seen or seen.add(f))]

    if ctype == "field_compare":
        tol = float(check_logic.get("tolerance", REL_TOL))
        conflicts: list[str] = []
        missing: list[str] = []
        details: dict[str, Any] = {}
        for key in fields:
            ea, eb = a.get(key), b.get(key)
            if ea is None or eb is None:
                missing.append(key)
                details[key] = {"status": "missing"}
                continue
            va, ua, _ = _coerce(ea)
            vb, ub, _ = _coerce(eb)
            eq = _compare(key, va, vb, ua, ub, tol)
            if eq is False:
                conflicts.append(key)
            details[key] = {"a": va, "b": vb, "unit_a": ua, "unit_b": ub, "equal": eq}
        status = "conflict" if conflicts else ("missing" if missing else "consistent")
        return {"status": status, "conflict_fields": sorted(conflicts),
                "missing_fields": sorted(missing), "details": details}

    if ctype == "unit_mismatch":
        mism: list[str] = []
        details = {}
        for key in fields:
            ea, eb = a.get(key), b.get(key)
            if ea is None or eb is None:
                details[key] = {"status": "missing"}
                continue
            _, ua, _ = _coerce(ea)
            _, ub, _ = _coerce(eb)
            bad = bool(ua and ub and ua.strip().lower() != ub.strip().lower())
            if bad:
                mism.append(key)
            details[key] = {"unit_a": ua, "unit_b": ub, "mismatch": bad}
        status = "conflict" if mism else "consistent"
        return {"status": status, "unit_mismatch_fields": sorted(mism), "details": details}

    # missing_evidence
    lacking: list[str] = []
    details = {}
    for key in fields:
        ea, eb = a.get(key), b.get(key)
        bad = False
        for entry in (ea, eb):
            if entry is None:
                continue
            _, _, ev = _coerce(entry)
            if not ev.strip():
                bad = True
        if bad:
            lacking.append(key)
        details[key] = {"missing_evidence": bad}
    status = "conflict" if lacking else "consistent"
    return {"status": status, "missing_evidence_fields": sorted(lacking), "details": details}


def _equal(expected: Any, actual: Any, tol: float = 1e-9) -> bool:
    """递归比较：expected 中出现的键才参与判定；列表按集合（顺序无关）；数值按容差。"""
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return False
        return all(k in actual and _equal(expected[k], actual[k], tol) for k in expected)
    if isinstance(expected, list):
        if not isinstance(actual, list) or len(expected) != len(actual):
            return False
        se = sorted(expected, key=lambda x: repr(x))
        sa = sorted(actual, key=lambda x: repr(x))
        return all(_equal(e, a, tol) for e, a in zip(se, sa))
    if isinstance(expected, bool) or isinstance(actual, bool):
        return expected == actual
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        return abs(float(expected) - float(actual)) <= tol * max(abs(float(expected)), abs(float(actual)), 1.0)
    return expected == actual


def sample_passes(expected: dict, prediction: dict) -> bool:
    return _equal(expected or {}, prediction or {})


# ============================ 视图 ============================

def rule_view(rule: AuditRule, active_logic: dict | None = None) -> dict:
    out = {
        "id": rule.id, "rule_key": rule.rule_key, "name": rule.name, "domain": rule.domain or "",
        "description": rule.description or "", "risk_level": rule.risk_level,
        "evidence_requirement": rule.evidence_requirement or "", "current_version": rule.current_version,
        "is_enabled": rule.is_enabled, "created_by": rule.created_by,
        "created_at": rule.created_at.isoformat() if rule.created_at else "",
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else "",
    }
    if active_logic is not None:
        out["check_logic"] = active_logic
    return out


def version_view(v: AuditRuleVersion, sample_count: int = 0) -> dict:
    return {
        "id": v.id, "rule_id": v.rule_id, "version": v.version,
        "check_logic": _loads(v.check_logic_json, {}), "change_note": v.change_note or "",
        "is_active": v.is_active, "created_by": v.created_by, "sample_count": sample_count,
        "created_at": v.created_at.isoformat() if v.created_at else "",
    }


async def _get_rule(db: AsyncSession, rule_id: str) -> AuditRule:
    rule = (await db.execute(select(AuditRule).where(AuditRule.id == rule_id))).scalar_one_or_none()
    if rule is None:
        raise AppError("NOT_FOUND", "审计规则不存在。")
    return rule


async def _active_version(db: AsyncSession, rule: AuditRule) -> AuditRuleVersion:
    v = (await db.execute(select(AuditRuleVersion).where(
        AuditRuleVersion.rule_id == rule.id, AuditRuleVersion.is_active == True))).scalar_one_or_none()  # noqa: E712
    if v is None:
        v = (await db.execute(select(AuditRuleVersion).where(
            AuditRuleVersion.rule_id == rule.id, AuditRuleVersion.version == rule.current_version))).scalar_one_or_none()
    if v is None:
        raise AppError("NOT_FOUND", "规则没有可用版本。")
    return v


async def _samples_of(db: AsyncSession, version_id: str) -> list[RuleTestSample]:
    return list((await db.execute(select(RuleTestSample).where(
        RuleTestSample.rule_version_id == version_id))).scalars().all())


def _validate_logic(logic: dict) -> None:
    if not isinstance(logic, dict) or logic.get("type") not in CHECK_TYPES:
        raise AppError("VALIDATION_ERROR", f"check_logic_json.type 须为 {sorted(CHECK_TYPES)}。")


def _validate_samples(samples: list[dict]) -> None:
    for s in samples:
        if not isinstance(s, dict) or not isinstance(s.get("input"), dict) or not isinstance(s.get("expected"), dict):
            raise AppError("VALIDATION_ERROR", "每条测试样本须包含 input 与 expected 对象。")


# ============================ 默认规则种子 ============================

def _default_rules() -> list[dict]:
    """镜像既有比对引擎的代表性规则（参数一致性 / 单位不一致 / 证据缺失）。"""
    return [
        {
            "rule_key": "param_consistency", "name": "参数一致性校验", "domain": "机器学习",
            "description": "比对论文与复现配置的关键超参数，数值按相对容差，字符串归一化；镜像第二层程序化比对。",
            "risk_level": "high", "evidence_requirement": "需论文侧与复现侧双侧原文证据。",
            "check_logic": {"type": "field_compare",
                            "fields": ["learning_rate", "batch_size", "epochs", "optimizer"],
                            "tolerance": REL_TOL, "severity": "high"},
            "samples": [
                {"label": "consistent_case",
                 "input": {"a": {"learning_rate": 0.001, "batch_size": 64, "epochs": 100, "optimizer": "AdamW"},
                           "b": {"learning_rate": 0.001, "batch_size": 64, "epochs": 100, "optimizer": "adamw"}},
                 "expected": {"status": "consistent", "conflict_fields": []}},
                {"label": "batch_size_conflict",
                 "input": {"a": {"learning_rate": 0.001, "batch_size": 64, "epochs": 100, "optimizer": "AdamW"},
                           "b": {"learning_rate": 0.001, "batch_size": 32, "epochs": 100, "optimizer": "AdamW"}},
                 "expected": {"status": "conflict", "conflict_fields": ["batch_size"]}},
                {"label": "missing_epochs",
                 "input": {"a": {"learning_rate": 0.001, "batch_size": 64, "epochs": 100, "optimizer": "AdamW"},
                           "b": {"learning_rate": 0.001, "batch_size": 64, "optimizer": "AdamW"}},
                 "expected": {"status": "missing", "missing_fields": ["epochs"]}},
            ],
        },
        {
            "rule_key": "unit_mismatch", "name": "单位不一致检测", "domain": "机器学习",
            "description": "同一字段两侧单位不同即判冲突，避免把不同量纲的数值误判为一致。",
            "risk_level": "medium", "evidence_requirement": "需标注两侧单位来源。",
            "check_logic": {"type": "unit_mismatch", "fields": ["learning_rate", "batch_size"], "severity": "medium"},
            "samples": [
                {"label": "same_unit",
                 "input": {"a": {"learning_rate": {"value": 0.001, "unit": ""}, "batch_size": {"value": 64, "unit": "samples"}},
                           "b": {"learning_rate": {"value": 0.001, "unit": ""}, "batch_size": {"value": 64, "unit": "samples"}}},
                 "expected": {"status": "consistent", "unit_mismatch_fields": []}},
                {"label": "unit_conflict",
                 "input": {"a": {"learning_rate": {"value": 0.001, "unit": ""}, "batch_size": {"value": 64, "unit": "samples"}},
                           "b": {"learning_rate": {"value": 0.001, "unit": ""}, "batch_size": {"value": 64, "unit": "steps"}}},
                 "expected": {"status": "conflict", "unit_mismatch_fields": ["batch_size"]}},
            ],
        },
        {
            "rule_key": "missing_evidence", "name": "证据缺失检测", "domain": "通用",
            "description": "字段任一侧缺少证据引用（evidence_ref）即标记，确保结论可溯源。",
            "risk_level": "high", "evidence_requirement": "每个参与比对的字段都须有 evidence_ref。",
            "check_logic": {"type": "missing_evidence", "fields": ["learning_rate", "batch_size"], "severity": "high"},
            "samples": [
                {"label": "all_evidenced",
                 "input": {"a": {"learning_rate": {"value": 0.001, "evidence_ref": "p_001"}, "batch_size": {"value": 64, "evidence_ref": "p_002"}},
                           "b": {"learning_rate": {"value": 0.001, "evidence_ref": "c_001"}, "batch_size": {"value": 64, "evidence_ref": "c_002"}}},
                 "expected": {"status": "consistent", "missing_evidence_fields": []}},
                {"label": "evidence_missing",
                 "input": {"a": {"learning_rate": {"value": 0.001, "evidence_ref": "p_001"}, "batch_size": {"value": 64, "evidence_ref": "p_002"}},
                           "b": {"learning_rate": {"value": 0.001, "evidence_ref": "c_001"}, "batch_size": {"value": 64}}},
                 "expected": {"status": "conflict", "missing_evidence_fields": ["batch_size"]}},
            ],
        },
    ]


async def seed_default_rules(db: AsyncSession, user: User | None = None, request_id: str = "") -> dict:
    """幂等种子：按 rule_key 去重，已存在则跳过（不重复建版本 / 样本）。"""
    org_id = await resolve_rule_org(db, user) if user is not None else None
    seeded: list[str] = []
    skipped: list[str] = []
    for spec in _default_rules():
        exists = (await db.execute(select(AuditRule).where(AuditRule.rule_key == spec["rule_key"]))).scalar_one_or_none()
        if exists is not None:
            skipped.append(spec["rule_key"])
            continue
        rule = AuditRule(id=new_id("rule"), rule_key=spec["rule_key"], name=spec["name"],
                         domain=spec["domain"], description=spec["description"], risk_level=spec["risk_level"],
                         evidence_requirement=spec["evidence_requirement"], current_version=1,
                         is_enabled=True, created_by=user.id if user else None)
        db.add(rule)
        await db.flush()
        v = AuditRuleVersion(id=new_id("rv"), rule_id=rule.id, version=1,
                             check_logic_json=_dumps(spec["check_logic"]), change_note="默认规则初始版本",
                             created_by=user.id if user else None, is_active=True)
        db.add(v)
        await db.flush()
        for s in spec["samples"]:
            db.add(RuleTestSample(id=new_id("rts"), rule_version_id=v.id,
                                  input_json=_dumps(s["input"]), expected_json=_dumps(s["expected"]),
                                  label=s.get("label", "")))
        seeded.append(spec["rule_key"])
    if seeded:
        await record_trail(db, action="rule.seed", actor_user_id=user.id if user else None, org_id=org_id,
                           target_type="audit_rule", target_id=",".join(seeded),
                           after={"seeded": seeded}, summary="初始化默认审计规则", request_id=request_id)
    await db.commit()
    return {"seeded": seeded, "skipped": skipped, "total": len(seeded) + len(skipped)}


# ============================ CRUD / 版本 ============================

async def create_rule(db: AsyncSession, user: User, payload: dict, request_id: str = "") -> dict:
    org_id = await resolve_rule_org(db, user)
    rule_key = (payload.get("rule_key") or "").strip()
    name = (payload.get("name") or "").strip()
    if not rule_key or not name:
        raise AppError("VALIDATION_ERROR", "rule_key 与 name 不能为空。")
    if not re.match(r"^[a-z0-9_\-]{2,80}$", rule_key):
        raise AppError("VALIDATION_ERROR", "rule_key 仅允许小写字母 / 数字 / 下划线 / 连字符（2-80 位）。")
    logic = payload.get("check_logic_json") or payload.get("check_logic") or {}
    _validate_logic(logic)
    risk = payload.get("risk_level", "medium")
    if risk not in _RISK_LEVELS:
        raise AppError("VALIDATION_ERROR", f"risk_level 须为 {sorted(_RISK_LEVELS)}。")
    exists = (await db.execute(select(AuditRule).where(AuditRule.rule_key == rule_key))).scalar_one_or_none()
    if exists is not None:
        raise AppError("CONFLICT", f"规则键已存在：{rule_key}。")
    samples = payload.get("test_samples") or []
    _validate_samples(samples)

    rule = AuditRule(id=new_id("rule"), rule_key=rule_key, name=name, domain=payload.get("domain", ""),
                     description=payload.get("description", ""), risk_level=risk,
                     evidence_requirement=payload.get("evidence_requirement", ""), current_version=1,
                     is_enabled=bool(payload.get("is_enabled", True)), created_by=user.id)
    db.add(rule)
    await db.flush()
    v = AuditRuleVersion(id=new_id("rv"), rule_id=rule.id, version=1, check_logic_json=_dumps(logic),
                         change_note=payload.get("change_note", "初始版本"), created_by=user.id, is_active=True)
    db.add(v)
    await db.flush()
    for s in samples:
        db.add(RuleTestSample(id=new_id("rts"), rule_version_id=v.id, input_json=_dumps(s["input"]),
                              expected_json=_dumps(s["expected"]), label=s.get("label", "")))
    await record_trail(db, action="rule.create", actor_user_id=user.id, org_id=org_id,
                       target_type="audit_rule", target_id=rule.id,
                       after={"rule_key": rule_key, "version": 1, "check_logic": logic},
                       summary=f"创建审计规则 {rule_key}", request_id=request_id)
    await db.commit()
    return rule_view(rule, logic)


async def list_rules(db: AsyncSession, user: User, domain: str | None = None,
                     is_enabled: bool | None = None) -> list[dict]:
    q = select(AuditRule)
    if domain:
        q = q.where(AuditRule.domain == domain)
    if is_enabled is not None:
        q = q.where(AuditRule.is_enabled == is_enabled)
    rows = (await db.execute(q.order_by(AuditRule.created_at.asc()))).scalars().all()
    out = []
    for r in rows:
        v = await _active_version(db, r)
        out.append(rule_view(r, _loads(v.check_logic_json, {})))
    return out


async def get_rule(db: AsyncSession, user: User, rule_id: str) -> dict:
    rule = await _get_rule(db, rule_id)
    v = await _active_version(db, rule)
    samples = await _samples_of(db, v.id)
    data = rule_view(rule, _loads(v.check_logic_json, {}))
    data["active_version"] = version_view(v, len(samples))
    data["test_samples"] = [{"id": s.id, "label": s.label, "input": _loads(s.input_json),
                             "expected": _loads(s.expected_json)} for s in samples]
    return data


async def set_enabled(db: AsyncSession, user: User, rule_id: str, is_enabled: bool, request_id: str = "") -> dict:
    org_id = await resolve_rule_org(db, user)
    rule = await _get_rule(db, rule_id)
    before = rule.is_enabled
    rule.is_enabled = bool(is_enabled)
    await record_trail(db, action="rule.enable" if is_enabled else "rule.disable", actor_user_id=user.id,
                       org_id=org_id, target_type="audit_rule", target_id=rule.id,
                       before={"is_enabled": before}, after={"is_enabled": rule.is_enabled},
                       summary="启用规则" if is_enabled else "停用规则", request_id=request_id)
    await db.commit()
    return rule_view(rule)


async def create_version(db: AsyncSession, user: User, rule_id: str, check_logic_json: dict,
                         change_note: str, test_samples: list[dict], request_id: str = "") -> dict:
    org_id = await resolve_rule_org(db, user)
    rule = await _get_rule(db, rule_id)
    _validate_logic(check_logic_json)
    if not test_samples or len(test_samples) < 1:
        raise AppError("VALIDATION_ERROR", "新版本必须附带至少 1 条测试样本（先离线验证再上生产）。")
    _validate_samples(test_samples)

    old_version = rule.current_version
    old_active = await _active_version(db, rule)
    before = {"current_version": old_version, "check_logic": _loads(old_active.check_logic_json, {})}

    # 停用旧版本
    for v in (await db.execute(select(AuditRuleVersion).where(AuditRuleVersion.rule_id == rule.id))).scalars().all():
        v.is_active = False
    new_no = old_version + 1
    nv = AuditRuleVersion(id=new_id("rv"), rule_id=rule.id, version=new_no,
                          check_logic_json=_dumps(check_logic_json), change_note=change_note or "",
                          created_by=user.id, is_active=True)
    db.add(nv)
    await db.flush()
    for s in test_samples:
        db.add(RuleTestSample(id=new_id("rts"), rule_version_id=nv.id, input_json=_dumps(s["input"]),
                              expected_json=_dumps(s["expected"]), label=s.get("label", "")))
    rule.current_version = new_no
    await record_trail(db, action="rule.version_create", actor_user_id=user.id, org_id=org_id,
                       target_type="audit_rule", target_id=rule.id, before=before,
                       after={"current_version": new_no, "check_logic": check_logic_json, "change_note": change_note},
                       summary=f"规则 {rule.rule_key} 新版本 v{new_no}", request_id=request_id)
    await db.commit()
    return {"rule_id": rule.id, "current_version": new_no, "version": version_view(nv, len(test_samples))}


async def list_versions(db: AsyncSession, user: User, rule_id: str) -> list[dict]:
    rule = await _get_rule(db, rule_id)
    rows = (await db.execute(select(AuditRuleVersion).where(AuditRuleVersion.rule_id == rule.id)
                             .order_by(AuditRuleVersion.version.desc()))).scalars().all()
    out = []
    for v in rows:
        samples = await _samples_of(db, v.id)
        out.append(version_view(v, len(samples)))
    return out


async def rollback(db: AsyncSession, user: User, rule_id: str, version: int, request_id: str = "") -> dict:
    """回滚：复制目标版本逻辑为一个全新版本号并激活，历史完整保留（不删改旧版本）。"""
    org_id = await resolve_rule_org(db, user)
    rule = await _get_rule(db, rule_id)
    target = (await db.execute(select(AuditRuleVersion).where(
        AuditRuleVersion.rule_id == rule.id, AuditRuleVersion.version == version))).scalar_one_or_none()
    if target is None:
        raise AppError("NOT_FOUND", f"目标版本不存在：v{version}。")
    target_logic = _loads(target.check_logic_json, {})
    target_samples = await _samples_of(db, target.id)

    old_version = rule.current_version
    old_active = await _active_version(db, rule)
    before = {"current_version": old_version, "check_logic": _loads(old_active.check_logic_json, {})}

    for v in (await db.execute(select(AuditRuleVersion).where(AuditRuleVersion.rule_id == rule.id))).scalars().all():
        v.is_active = False
    new_no = old_version + 1
    nv = AuditRuleVersion(id=new_id("rv"), rule_id=rule.id, version=new_no,
                          check_logic_json=_dumps(target_logic),
                          change_note=f"回滚自 v{version}", created_by=user.id, is_active=True)
    db.add(nv)
    await db.flush()
    # 复制目标版本的测试样本，保证回滚后仍可离线测试
    for s in target_samples:
        db.add(RuleTestSample(id=new_id("rts"), rule_version_id=nv.id, input_json=s.input_json,
                              expected_json=s.expected_json, label=s.label))
    rule.current_version = new_no
    await record_trail(db, action="rule.rollback", actor_user_id=user.id, org_id=org_id,
                       target_type="audit_rule", target_id=rule.id, before=before,
                       after={"current_version": new_no, "rolled_back_to": version, "check_logic": target_logic},
                       summary=f"规则 {rule.rule_key} 回滚到 v{version}（生成 v{new_no}）", request_id=request_id)
    await db.commit()
    return {"rule_id": rule.id, "rolled_back_to": version, "current_version": new_no,
            "check_logic": target_logic, "version": version_view(nv, len(target_samples))}


async def run_rule_tests(db: AsyncSession, user: User, rule_id: str, request_id: str = "") -> dict:
    """跑当前激活版本的测试样本，返回逐条 pass/fail 与通过率（真实评估，非硬编码）。"""
    await resolve_rule_org(db, user)
    rule = await _get_rule(db, rule_id)
    v = await _active_version(db, rule)
    logic = _loads(v.check_logic_json, {})
    samples = await _samples_of(db, v.id)
    results = []
    passed = 0
    for s in samples:
        inp = _loads(s.input_json, {})
        exp = _loads(s.expected_json, {})
        try:
            pred = run_check(logic, inp)
            ok_sample = sample_passes(exp, pred)
            err = None
        except AppError as exc:
            pred, ok_sample, err = {}, False, exc.message
        if ok_sample:
            passed += 1
        results.append({"sample_id": s.id, "label": s.label, "passed": ok_sample,
                        "expected": exp, "actual": pred, "error": err})
    total = len(samples)
    pass_rate = (passed / total) if total else 0.0
    return {"rule_id": rule.id, "version": v.version, "total": total, "passed": passed,
            "failed": total - passed, "pass_rate": round(pass_rate, 4), "results": results}


async def list_evaluations(db: AsyncSession, user: User, rule_id: str) -> list[dict]:
    rule = await _get_rule(db, rule_id)
    rows = (await db.execute(select(RuleEvaluation).where(RuleEvaluation.rule_id == rule.id)
                             .order_by(RuleEvaluation.created_at.desc()))).scalars().all()
    runner_ids = {e.ran_by for e in rows if e.ran_by}
    runners: dict[str, str] = {}
    if runner_ids:
        runners = dict((await db.execute(
            select(User.id, User.display_name).where(User.id.in_(runner_ids)))).all())
    return [{"id": e.id, "rule_id": e.rule_id, "version": e.version, "dataset_ref": e.dataset_ref or "",
             "metrics": _loads(e.metrics_json, {}), "ran_by": e.ran_by,
             "ran_by_name": runners.get(e.ran_by),
             "created_at": e.created_at.isoformat() if e.created_at else ""} for e in rows]