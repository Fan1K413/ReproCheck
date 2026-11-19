"""科研复现基准库服务（第六阶段 B 组）：案例 / 事实 / 验证 / 质量等级。

核心约束：
- **质量等级由程序按验证证据确定性计算，AI 与客户端都不能直接设置**
  （create_case 显式拒绝 quality_level 入参；等级只能来自 evaluate_quality）。
- **可见性隔离**：公共案例 + 本人所属组织案例 + 本人创建案例；平台管理员可见全部。
  不可见一律 404（隐藏存在性），与项目级隔离口径一致。
- **来源可追溯**：案例保留 doi/source_url/code_repo_url/code_commit/license，
  事实保留 raw_field/raw_value/source_type/source_ref/context/applicable_experiment。
  本库只存「元数据 + 事实 + 指针」，不再分发论文附件、代码或数据集本体。
- **重要判断留痕**：创建案例、新增事实、提交验证、质量变更全部写 audit_trail。

质量规则见 docs/CASE_QUALITY_STANDARD.md。
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import user_has_permission
from app.core.errors import AppError
from app.core.security import new_id
from app.models.stage6 import (
    BenchmarkCase,
    CaseFact,
    CaseVerification,
    OrgMember,
    User,
)
from app.services import fact_schema as fs
from app.services.trail_service import record_trail

RULE_VERSION = "stage6-b1"

# ============================ 质量等级阶梯 ============================

QUALITY_LADDER: list[dict[str, str]] = [
    {"key": "unverified", "label": "未验证",
     "requirement": "无任何验证记录，或现有验证均未通过（fail/partial）。"},
    {"key": "partially_verified", "label": "部分验证",
     "requirement": "存在人工复核通过（review pass），或执行通过但未声明运行环境。"},
    {"key": "execution_verified", "label": "执行验证",
     "requirement": "存在执行复现通过（execution pass）且 conditions 声明了运行环境。"},
    {"key": "independently_reviewed", "label": "独立复核",
     "requirement": "在 execution_verified 基础上，另有独立人工复核通过（复核人 ≠ 执行人且 ≠ 案例创建者）。"},
]
QUALITY_RANK: dict[str, int] = {item["key"]: i for i, item in enumerate(QUALITY_LADDER)}
QUALITY_LABELS: dict[str, str] = {item["key"]: item["label"] for item in QUALITY_LADDER}

VERIFICATION_TYPES = {"execution", "review"}
VERIFICATION_RESULTS = {"pass", "fail", "partial"}
SOURCE_TYPES = {"paper", "code", "config", "log", "dataset_card", "manual",
                "execution", "review", "other"}

# 判定「执行验证声明了运行环境」的条件键（任一非空即成立，支持嵌套 environment/env）
ENVIRONMENT_KEYS = {
    "environment", "env", "hardware", "gpu", "gpu_model", "gpu_count", "num_gpus",
    "cpu", "memory", "ram", "python_version", "pytorch_version", "torch_version",
    "cuda_version", "cudnn_version", "operating_system", "os", "driver_version",
    "docker_image", "container_image", "framework", "library_versions", "dependencies",
    "code_commit", "commit", "commit_sha", "mixed_precision", "precision",
}

_CASE_SORTS = {"recent", "updated", "quality", "title"}
_SERVER_OWNED_CASE_FIELDS = {"quality_level", "quality_evidence_json", "quality_evidence",
                             "created_by", "id"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _task_key(value: Any) -> str:
    """domain / research_task 归一为 snake_case 小写键，便于结构化筛选与检索匹配。"""
    s = str(value or "").strip().lower()
    s = re.sub(r"[\s\-–—/]+", "_", s)
    s = re.sub(r"[^\w\u4e00-\u9fff]+", "", s)
    return re.sub(r"_+", "_", s).strip("_")


def _payload_dict(payload: Any) -> dict[str, Any]:
    if payload is None:
        return {}
    if isinstance(payload, dict):
        return dict(payload)
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    raise AppError("VALIDATION_ERROR", "请求体格式不正确。")


def _loads(text: str | None) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


async def user_org_ids(db: AsyncSession, user: User) -> list[str]:
    rows = (await db.execute(select(OrgMember.org_id).where(OrgMember.user_id == user.id))).scalars().all()
    return list(dict.fromkeys(rows))


# ============================ 视图 ============================

def traceability_view(case: BenchmarkCase) -> dict[str, Any]:
    """来源与许可完整性：只存指针，不再分发原文/代码/数据集。"""
    has_source = bool((case.doi or "").strip() or (case.source_url or "").strip())
    has_code = bool((case.code_repo_url or "").strip())
    has_license = bool((case.license or "").strip())
    warnings: list[str] = []
    if not has_source:
        warnings.append("缺少论文来源（doi 或 source_url），无法追溯原始文献。")
    if not has_license:
        warnings.append("缺少 license 声明，引用该案例前需确认原文与代码的许可条款。")
    if has_code and not (case.code_commit or "").strip():
        warnings.append("缺少 code_commit，代码版本不可复现定位。")
    return {
        "has_source": has_source,
        "has_code": has_code,
        "has_code_commit": bool((case.code_commit or "").strip()),
        "has_license": has_license,
        "complete": has_source and has_license and (not has_code or bool((case.code_commit or "").strip())),
        "redistribution": "metadata_only",
        "warnings": warnings,
    }


def case_view(case: BenchmarkCase, *, fact_count: int | None = None,
              verification_count: int | None = None,
              verifications: list[dict] | None = None,
              created_by_name: str | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": case.id,
        "title": case.title,
        "doi": case.doi or "",
        "source_url": case.source_url or "",
        "domain": case.domain or "",
        "research_task": case.research_task or "",
        "model_architecture": case.model_architecture or "",
        "dataset_name": case.dataset_name or "",
        "code_repo_url": case.code_repo_url or "",
        "code_commit": case.code_commit or "",
        "license": case.license or "",
        "quality_level": case.quality_level or "unverified",
        "quality_label": QUALITY_LABELS.get(case.quality_level or "unverified", "未验证"),
        "quality_evidence": _loads(case.quality_evidence_json) or {},
        "version": case.version,
        "org_id": case.org_id,
        "is_public": bool(case.is_public),
        "created_by": case.created_by,
        "summary": case.summary or "",
        "traceability": traceability_view(case),
        "created_at": case.created_at.isoformat() if case.created_at else "",
        "updated_at": case.updated_at.isoformat() if case.updated_at else "",
    }
    if fact_count is not None:
        data["fact_count"] = fact_count
    if verification_count is not None:
        data["verification_count"] = verification_count
    if verifications is not None:
        data["verifications"] = verifications
    if created_by_name is not None:
        data["created_by_name"] = created_by_name
    return data


def fact_view(fact: CaseFact) -> dict[str, Any]:
    spec = fs.field_spec(fact.field_key)
    return {
        "id": fact.id,
        "case_id": fact.case_id,
        "field_key": fact.field_key,
        "label": spec["label"] if spec else fact.field_key,
        "label_en": spec["label_en"] if spec else fact.field_key,
        "category": spec["category"] if spec else "other",
        "category_label": fs.CATEGORIES.get(spec["category"], "其他") if spec else "其他",
        "is_standard": spec is not None,
        "raw_field": fact.raw_field or "",
        "raw_value": fact.raw_value or "",
        "normalized_value": fact.normalized_value or "",
        "unit": fact.unit or "",
        "source_type": fact.source_type or "",
        "source_ref": fact.source_ref or "",
        "context": fact.context or "",
        "applicable_experiment": fact.applicable_experiment or "",
        "confidence": fact.confidence,
        "created_at": fact.created_at.isoformat() if fact.created_at else "",
    }


def _conditions_dict(conditions_json: str | None) -> dict[str, Any]:
    parsed = _loads(conditions_json)
    return parsed if isinstance(parsed, dict) else {}


def verification_view(row: CaseVerification, verifier_name: str = "") -> dict[str, Any]:
    return {
        "id": row.id,
        "case_id": row.case_id,
        "verification_type": row.verification_type,
        "result": row.result,
        "verifier_user_id": row.verifier_user_id,
        "verifier_name": verifier_name,
        "conditions": _conditions_dict(row.conditions_json),
        "conditions_json": row.conditions_json or "",
        "notes": row.notes or "",
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def quality_standard_view() -> dict[str, Any]:
    """质量阶梯与判定规则（供前端展示与文档引用；等级只能由系统计算）。"""
    return {
        "rule_version": RULE_VERSION,
        "levels": QUALITY_LADDER,
        "verification_types": sorted(VERIFICATION_TYPES),
        "results": sorted(VERIFICATION_RESULTS),
        "environment_keys": sorted(ENVIRONMENT_KEYS),
        "principles": [
            "等级由 evaluate_quality 依据验证记录确定性计算，AI/客户端不可直接设置。",
            "recompute 默认只升不降；降级须显式 confirm_downgrade=true 人工确认。",
            "独立复核要求复核人不同于执行人且不同于案例创建者。",
            "每次等级变更写入 audit_trail，并保存 quality_evidence_json 证据清单。",
        ],
    }


# ============================ 质量判定（纯函数，可单测） ============================

def has_environment_conditions(conditions: Any) -> bool:
    """执行验证是否声明了运行环境（任一环境键非空，或嵌套 environment/env 非空）。"""
    if not isinstance(conditions, dict) or not conditions:
        return False
    for key, value in conditions.items():
        if str(key).strip().lower() not in ENVIRONMENT_KEYS:
            continue
        if isinstance(value, dict):
            if any(str(v).strip() for v in value.values() if v is not None):
                return True
        elif isinstance(value, (list, tuple)):
            if any(str(v).strip() for v in value if v is not None):
                return True
        elif value is not None and str(value).strip():
            return True
    return False


def extract_environment(conditions: Any) -> dict[str, Any]:
    """抽取环境条件用于证据展示（嵌套 environment/env 展平）。"""
    if not isinstance(conditions, dict):
        return {}
    out: dict[str, Any] = {}
    for key, value in conditions.items():
        low = str(key).strip().lower()
        if low in ("environment", "env") and isinstance(value, dict):
            for k, v in value.items():
                out[str(k)] = v
        elif low in ENVIRONMENT_KEYS and value not in (None, "", {}, []):
            out[low] = value
    return out


def _basis_item(row: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "verification_id": row.get("id", ""),
        "verification_type": row.get("verification_type", ""),
        "result": row.get("result", ""),
        "verifier_user_id": row.get("verifier_user_id"),
        "created_at": row.get("created_at", ""),
        "reason": reason,
    }


def evaluate_quality(created_by: str | None,
                     verifications: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    """确定性质量判定：输入验证记录（dict 列表），返回 (等级, 证据)。

    规则（只依据 pass 记录，fail/partial 不升级）：
      无通过记录                     -> unverified
      review pass                    -> partially_verified
      execution pass（未声明环境）    -> partially_verified
      execution pass（声明环境）      -> execution_verified
      上述 + 独立 review pass         -> independently_reviewed
    """
    rows = sorted(verifications, key=lambda v: str(v.get("created_at") or ""))
    exec_pass = [v for v in rows if v.get("verification_type") == "execution" and v.get("result") == "pass"]
    exec_pass_env = [v for v in exec_pass if has_environment_conditions(v.get("conditions"))]
    exec_pass_noenv = [v for v in exec_pass if not has_environment_conditions(v.get("conditions"))]
    review_pass = [v for v in rows if v.get("verification_type") == "review" and v.get("result") == "pass"]
    fails = [v for v in rows if v.get("result") == "fail"]
    partials = [v for v in rows if v.get("result") == "partial"]

    basis: list[dict[str, Any]] = []
    supporting: list[dict[str, Any]] = []
    notes: list[str] = []
    environment: dict[str, Any] = {}
    independent: dict[str, Any] | None = None
    level = "unverified"

    if exec_pass_env:
        execution = exec_pass_env[-1]
        level = "execution_verified"
        environment = extract_environment(execution.get("conditions"))
        basis.append(_basis_item(execution, "执行复现通过，且 conditions 声明了运行环境"))
        for review in review_pass:
            reviewer = review.get("verifier_user_id")
            if reviewer and reviewer != execution.get("verifier_user_id") and reviewer != created_by:
                independent = review
                break
            supporting.append(_basis_item(review, "人工复核通过，但复核人与执行人/创建者相同，不构成独立复核"))
        if independent is not None:
            level = "independently_reviewed"
            basis.append(_basis_item(independent, "独立人工复核通过（复核人 ≠ 执行人且 ≠ 案例创建者）"))
        else:
            notes.append("尚无独立人工复核：升级为 independently_reviewed 需由不同于执行人与案例创建者的用户提交 review pass。")
        for extra in exec_pass_env[:-1]:
            supporting.append(_basis_item(extra, "历史执行复现通过记录"))
    elif review_pass:
        level = "partially_verified"
        basis.append(_basis_item(review_pass[-1], "人工复核通过（材料与结论审阅）"))
        for extra in review_pass[:-1]:
            supporting.append(_basis_item(extra, "历史人工复核通过记录"))
        notes.append("缺少声明运行环境的 execution pass，无法升级为 execution_verified。")
    elif exec_pass_noenv:
        level = "partially_verified"
        basis.append(_basis_item(exec_pass_noenv[-1], "执行复现通过但未声明运行环境条件，按部分验证计"))
        notes.append("执行验证的 conditions 需包含环境键（如 gpu/python_version/pytorch_version/cuda_version/operating_system）才计入 execution_verified。")
    elif not rows:
        notes.append("尚无任何验证记录，案例保持 unverified。")
    else:
        notes.append("现有验证均为 fail/partial，不足以支撑任何验证等级。")

    if fails:
        notes.append(f"存在 {len(fails)} 条 fail 验证，引用该案例前须阅读失败原因。")
    if partials:
        notes.append(f"存在 {len(partials)} 条 partial 验证，结论仅部分成立。")

    evidence = {
        "level": level,
        "rule_version": RULE_VERSION,
        "computed_at": _now_iso(),
        "basis": basis,
        "supporting": supporting,
        "environment": environment,
        "independent_reviewer_user_id": (independent or {}).get("verifier_user_id"),
        "counts": {
            "total": len(rows),
            "execution_pass": len(exec_pass),
            "execution_pass_with_environment": len(exec_pass_env),
            "review_pass": len(review_pass),
            "fail": len(fails),
            "partial": len(partials),
        },
        "notes": notes,
    }
    return level, evidence


# ============================ 可见性与权限 ============================

async def build_visible_stmt(db: AsyncSession, user: User,
                             filters: dict[str, Any] | None = None) -> Select:
    """构造「当前用户可见 + 结构化筛选」的案例查询（list/search 共用）。"""
    filters = filters or {}
    org_ids = await user_org_ids(db, user)
    stmt = select(BenchmarkCase)
    if not user.is_platform_admin:
        conds = [BenchmarkCase.is_public.is_(True), BenchmarkCase.created_by == user.id]
        if org_ids:
            conds.append(BenchmarkCase.org_id.in_(org_ids))
        stmt = stmt.where(or_(*conds))

    domain = _task_key(filters.get("domain"))
    if domain:
        stmt = stmt.where(BenchmarkCase.domain == domain)
    task = _task_key(filters.get("research_task"))
    if task:
        stmt = stmt.where(BenchmarkCase.research_task == task)
    dataset = _clean(filters.get("dataset") or filters.get("dataset_name"))
    if dataset:
        canonical, _ = fs.normalize_value("dataset_name", dataset)
        stmt = stmt.where(or_(
            func.lower(BenchmarkCase.dataset_name) == canonical.lower(),
            func.lower(BenchmarkCase.dataset_name).like(f"%{dataset.lower()}%"),
        ))
    quality = _clean(filters.get("quality_level"))
    if quality:
        if quality not in QUALITY_RANK:
            raise AppError("VALIDATION_ERROR", f"quality_level 须为 {list(QUALITY_RANK)}。")
        stmt = stmt.where(BenchmarkCase.quality_level == quality)
    org_id = _clean(filters.get("org_id"))
    if org_id:
        stmt = stmt.where(BenchmarkCase.org_id == org_id)
    if filters.get("is_public") is not None and _clean(filters.get("is_public")) != "":
        stmt = stmt.where(BenchmarkCase.is_public.is_(_as_bool(filters.get("is_public"))))
    q = _clean(filters.get("q"))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            func.lower(BenchmarkCase.title).like(like),
            func.lower(BenchmarkCase.summary).like(like),
            func.lower(BenchmarkCase.research_task).like(like),
            func.lower(BenchmarkCase.model_architecture).like(like),
            func.lower(BenchmarkCase.dataset_name).like(like),
            func.lower(BenchmarkCase.domain).like(like),
        ))
    return stmt


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def int_param(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        raise AppError("VALIDATION_ERROR", "limit/offset/top_k 须为整数。")
    return max(minimum, min(parsed, maximum))


async def get_visible_case(db: AsyncSession, user: User, case_id: str) -> BenchmarkCase:
    case = (await db.execute(select(BenchmarkCase).where(BenchmarkCase.id == case_id))).scalar_one_or_none()
    if case is None:
        raise AppError("NOT_FOUND", "案例不存在或无权访问。")
    if user.is_platform_admin:
        return case
    if case.is_public or case.created_by == user.id:
        return case
    if case.org_id and case.org_id in await user_org_ids(db, user):
        return case
    raise AppError("NOT_FOUND", "案例不存在或无权访问。")


async def _can_manage_case(db: AsyncSession, user: User, case: BenchmarkCase) -> bool:
    if case.created_by == user.id:
        return True
    return await user_has_permission(db, user, "case.manage", org_id=case.org_id)


async def _can_verify_case(db: AsyncSession, user: User, case: BenchmarkCase,
                           project_id: str | None = None) -> bool:
    for perm in ("finding.review", "case.manage"):
        if await user_has_permission(db, user, perm, org_id=case.org_id, project_id=project_id):
            return True
    return False


async def _verification_rows(db: AsyncSession, case_id: str) -> list[CaseVerification]:
    return list((await db.execute(
        select(CaseVerification).where(CaseVerification.case_id == case_id)
        .order_by(CaseVerification.created_at.asc(), CaseVerification.id.asc())
    )).scalars().all())


async def _verification_dicts(db: AsyncSession, rows: list[CaseVerification]) -> list[dict[str, Any]]:
    ids = {r.verifier_user_id for r in rows if r.verifier_user_id}
    names: dict[str, str] = {}
    if ids:
        users = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
        names = {u.id: (u.display_name or "") for u in users}
    return [verification_view(r, names.get(r.verifier_user_id or "", "")) for r in rows]


# ============================ 案例 ============================

async def create_case(db: AsyncSession, user: User, payload: Any, rid: str = "") -> dict[str, Any]:
    """创建基准案例。quality_level 一律由系统置为 unverified，拒绝任何直接设置。"""
    data = _payload_dict(payload)
    for key in _SERVER_OWNED_CASE_FIELDS:
        if key in data and data[key] not in (None, ""):
            raise AppError("VALIDATION_ERROR",
                           f"{key} 由系统按验证证据计算，不接受客户端或 AI 直接设置。")
    title = _clean(data.get("title"))
    if not title:
        raise AppError("VALIDATION_ERROR", "案例标题不能为空。")
    if len(title) > 300:
        raise AppError("VALIDATION_ERROR", "案例标题不得超过 300 字符。")

    org_ids = await user_org_ids(db, user)
    org_id = _clean(data.get("org_id")) or None
    if org_id is None:
        org_id = org_ids[0] if org_ids else None
    elif org_id not in org_ids and not user.is_platform_admin:
        raise AppError("NOT_FOUND", "组织不存在或无权访问。")
    if not await user_has_permission(db, user, "case.manage", org_id=org_id):
        raise AppError("FORBIDDEN", "创建基准案例需要 case.manage 权限（researcher 及以上）。")

    is_public = _as_bool(data.get("is_public", False))
    if is_public and not await user_has_permission(db, user, "org.manage", org_id=org_id):
        raise AppError("FORBIDDEN", "发布公共案例需要组织管理员（org_admin）权限。")

    dataset_raw = _clean(data.get("dataset_name"))
    dataset_name = fs.normalize_value("dataset_name", dataset_raw)[0] if dataset_raw else ""
    limits = {"doi": 200, "source_url": 500, "code_repo_url": 500, "code_commit": 80,
              "license": 120, "model_architecture": 200, "domain": 120, "research_task": 200}
    values: dict[str, str] = {}
    for key, max_len in limits.items():
        value = _clean(data.get(key))
        if len(value) > max_len:
            raise AppError("VALIDATION_ERROR", f"{key} 不得超过 {max_len} 字符。")
        values[key] = value

    case = BenchmarkCase(
        id=new_id("case"),
        title=title,
        doi=values["doi"],
        source_url=values["source_url"],
        domain=_task_key(data.get("domain")),
        research_task=_task_key(data.get("research_task")),
        model_architecture=values["model_architecture"],
        dataset_name=dataset_name,
        code_repo_url=values["code_repo_url"],
        code_commit=values["code_commit"],
        license=values["license"],
        quality_level="unverified",
        quality_evidence_json=_dumps({
            "level": "unverified", "rule_version": RULE_VERSION, "computed_at": _now_iso(),
            "basis": [], "supporting": [], "environment": {}, "counts": {"total": 0},
            "notes": ["案例创建，尚无任何验证记录；等级只能由系统按验证证据计算。"],
        }),
        version=1,
        org_id=org_id,
        is_public=is_public,
        created_by=user.id,
        summary=str(data.get("summary") or "").strip(),
    )
    db.add(case)
    await db.flush()
    await record_trail(
        db, action="case.create", actor_user_id=user.id, org_id=org_id,
        target_type="benchmark_case", target_id=case.id,
        after={"title": title, "quality_level": "unverified", "is_public": is_public,
               "domain": case.domain, "research_task": case.research_task,
               "dataset_name": dataset_name},
        summary="创建基准案例", request_id=rid,
    )
    await db.commit()
    return case_view(case, fact_count=0, verification_count=0, verifications=[],
                     created_by_name=user.display_name or "")


async def list_cases(db: AsyncSession, user: User,
                     filters: dict[str, Any] | None = None) -> dict[str, Any]:
    """可见案例列表：domain/research_task/dataset/quality_level/q 筛选 + 分页 + 排序。"""
    filters = dict(filters or {})
    limit = int_param(filters.get("limit"), 20, 1, 100)
    offset = int_param(filters.get("offset"), 0, 0, 1_000_000)
    sort = _clean(filters.get("sort")) or "recent"
    if sort not in _CASE_SORTS:
        raise AppError("VALIDATION_ERROR", f"sort 须为 {sorted(_CASE_SORTS)}。")
    stmt = await build_visible_stmt(db, user, filters)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    if sort == "quality":
        rows = list((await db.execute(stmt.order_by(BenchmarkCase.created_at.desc()))).scalars().all())
        rows.sort(key=lambda c: (-QUALITY_RANK.get(c.quality_level or "unverified", 0),
                                 -(c.created_at.timestamp() if c.created_at else 0)))
        rows = rows[offset:offset + limit]
    else:
        order = {
            "recent": (BenchmarkCase.created_at.desc(), BenchmarkCase.id.desc()),
            "updated": (BenchmarkCase.updated_at.desc(), BenchmarkCase.id.desc()),
            "title": (BenchmarkCase.title.asc(), BenchmarkCase.id.asc()),
        }[sort]
        rows = list((await db.execute(stmt.order_by(*order).limit(limit).offset(offset))).scalars().all())

    # 一次性聚合事实数，避免逐案例 N+1 查询
    counts: dict[str, int] = {}
    if rows:
        agg = (await db.execute(
            select(CaseFact.case_id, func.count()).where(
                CaseFact.case_id.in_([c.id for c in rows])).group_by(CaseFact.case_id)
        )).all()
        counts = {case_id: int(n) for case_id, n in agg}
    creator_ids = {c.created_by for c in rows if c.created_by}
    creators: dict[str, str] = {}
    if creator_ids:
        creators = dict((await db.execute(
            select(User.id, User.display_name).where(User.id.in_(creator_ids)))).all())
    items = [case_view(case, fact_count=counts.get(case.id, 0),
                       created_by_name=creators.get(case.created_by)) for case in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset, "sort": sort}


async def get_case(db: AsyncSession, user: User, case_id: str) -> dict[str, Any]:
    case = await get_visible_case(db, user, case_id)
    fact_count = (await db.execute(select(func.count()).select_from(CaseFact)
                                   .where(CaseFact.case_id == case.id))).scalar_one()
    rows = await _verification_rows(db, case.id)
    verifications = await _verification_dicts(db, rows)
    creator_name = ""
    if case.created_by:
        u = (await db.execute(select(User).where(User.id == case.created_by))).scalar_one_or_none()
        creator_name = u.display_name if u else ""
    data = case_view(case, fact_count=fact_count, verification_count=len(rows),
                     verifications=verifications, created_by_name=creator_name)
    data["quality_standard"] = quality_standard_view()
    return data


# ============================ 案例事实 ============================

async def add_case_fact(db: AsyncSession, user: User, case_id: str, payload: Any,
                        rid: str = "") -> dict[str, Any]:
    """新增案例事实：字段名/值经 fact_schema 归一化，原文与来源一并保存。"""
    case = await get_visible_case(db, user, case_id)
    if not await _can_manage_case(db, user, case):
        raise AppError("FORBIDDEN", "新增案例事实需要案例创建者或 case.manage 权限。")
    data = _payload_dict(payload)
    raw_field = _clean(data.get("raw_field") or data.get("field_key") or data.get("field"))
    if not raw_field:
        raise AppError("VALIDATION_ERROR", "字段名（raw_field/field_key）不能为空。")
    if len(raw_field) > 120:
        raise AppError("VALIDATION_ERROR", "字段名不得超过 120 字符。")
    raw_value = data.get("raw_value")
    if raw_value is None:
        raw_value = data.get("value")
    raw_value = "" if raw_value is None else str(raw_value).strip()
    if not raw_value:
        raise AppError("VALIDATION_ERROR", "字段值（raw_value/value）不能为空。")

    field_key = fs.normalize_field(raw_field)
    if not field_key:
        raise AppError("VALIDATION_ERROR", "字段名无法归一化，请使用有意义的字段名（如 learning_rate）。")
    if len(field_key) > 80:
        raise AppError("VALIDATION_ERROR", "归一化后的 field_key 不得超过 80 字符。")
    normalized_value, unit = fs.normalize_value(field_key, raw_value)
    override_unit = _clean(data.get("unit"))
    if override_unit:
        if len(override_unit) > 40:
            raise AppError("VALIDATION_ERROR", "unit 不得超过 40 字符。")
        unit = override_unit

    source_type = _clean(data.get("source_type")) or "manual"
    if source_type not in SOURCE_TYPES:
        raise AppError("VALIDATION_ERROR", f"source_type 须为 {sorted(SOURCE_TYPES)}。")
    source_ref = _clean(data.get("source_ref"))
    applicable_experiment = _clean(data.get("applicable_experiment"))
    if len(source_ref) > 300:
        raise AppError("VALIDATION_ERROR", "source_ref 不得超过 300 字符。")
    if len(applicable_experiment) > 200:
        raise AppError("VALIDATION_ERROR", "applicable_experiment 不得超过 200 字符。")
    context = str(data.get("context") or "").strip()
    try:
        confidence = float(data.get("confidence") if data.get("confidence") is not None else 0.0)
    except (TypeError, ValueError):
        raise AppError("VALIDATION_ERROR", "confidence 须为 0~1 的数值。")
    if not 0.0 <= confidence <= 1.0:
        raise AppError("VALIDATION_ERROR", "confidence 须在 0~1 之间。")

    duplicate = (await db.execute(select(CaseFact).where(
        CaseFact.case_id == case.id, CaseFact.field_key == field_key,
        CaseFact.normalized_value == normalized_value,
        CaseFact.applicable_experiment == applicable_experiment,
        CaseFact.source_ref == source_ref,
    ))).scalar_one_or_none()
    if duplicate is not None:
        raise AppError("CONFLICT", "相同事实已存在（字段/归一值/适用实验/来源均一致）。")

    fact = CaseFact(
        id=new_id("cf"), case_id=case.id, field_key=field_key,
        raw_field=raw_field, raw_value=raw_value, normalized_value=normalized_value,
        unit=unit, source_type=source_type, source_ref=source_ref, context=context,
        applicable_experiment=applicable_experiment, confidence=confidence,
    )
    db.add(fact)
    case.version = (case.version or 1) + 1
    await db.flush()
    await record_trail(
        db, action="case.fact_add", actor_user_id=user.id, org_id=case.org_id,
        target_type="case_fact", target_id=fact.id,
        after={"case_id": case.id, "field_key": field_key, "raw_value": raw_value,
               "normalized_value": normalized_value, "unit": unit,
               "source_type": source_type, "source_ref": source_ref},
        summary=f"新增案例事实：{fs.field_label(field_key)}", request_id=rid,
    )
    await db.commit()
    return fact_view(fact)


async def list_case_facts(db: AsyncSession, user: User, case_id: str,
                          field_key: str | None = None,
                          category: str | None = None) -> list[dict[str, Any]]:
    case = await get_visible_case(db, user, case_id)
    stmt = select(CaseFact).where(CaseFact.case_id == case.id)
    if field_key:
        stmt = stmt.where(CaseFact.field_key == fs.normalize_field(field_key))
    rows = list((await db.execute(stmt.order_by(CaseFact.created_at.asc(), CaseFact.id.asc()))).scalars().all())
    views = [fact_view(r) for r in rows]
    if category:
        if category not in fs.CATEGORIES and category != "other":
            raise AppError("VALIDATION_ERROR", f"category 须为 {list(fs.CATEGORIES) + ['other']}。")
        views = [v for v in views if v["category"] == category]
    order = {k: i for i, k in enumerate(fs.CATEGORIES)}
    views.sort(key=lambda v: (order.get(v["category"], 99), v["field_key"], v["created_at"]))
    return views


# ============================ 验证与质量 ============================

async def _apply_quality(db: AsyncSession, user: User, case: BenchmarkCase, rid: str,
                         confirm_downgrade: bool, action: str) -> dict[str, Any]:
    """按验证证据重算等级；默认只升不降，降级需人工确认。写回证据并留痕。"""
    rows = await _verification_rows(db, case.id)
    verifications = [verification_view(r) for r in rows]
    computed, evidence = evaluate_quality(case.created_by, verifications)
    current = case.quality_level or "unverified"
    changed = False
    blocked = False
    if QUALITY_RANK[computed] > QUALITY_RANK.get(current, 0):
        case.quality_level = computed
        changed = True
    elif QUALITY_RANK[computed] < QUALITY_RANK.get(current, 0):
        if confirm_downgrade:
            case.quality_level = computed
            changed = True
        else:
            blocked = True
            evidence["notes"].append(
                f"计算等级 {computed} 低于当前等级 {current}；未确认降级，保持 {current}。")
    evidence["level"] = case.quality_level
    evidence["computed_level"] = computed
    evidence["previous_level"] = current
    evidence["downgrade_blocked"] = blocked
    evidence["confirm_downgrade"] = bool(confirm_downgrade)
    case.quality_evidence_json = _dumps(evidence)
    if changed:
        await record_trail(
            db, action=action, actor_user_id=user.id, org_id=case.org_id,
            target_type="benchmark_case", target_id=case.id,
            before={"quality_level": current},
            after={"quality_level": case.quality_level,
                   "basis": [b["verification_id"] for b in evidence["basis"]],
                   "rule_version": RULE_VERSION},
            summary=f"案例质量等级 {current} → {case.quality_level}", request_id=rid,
        )
    return {
        "case_id": case.id,
        "quality_level": case.quality_level,
        "quality_label": QUALITY_LABELS.get(case.quality_level, "未验证"),
        "computed_level": computed,
        "previous_level": current,
        "changed": changed,
        "downgrade_blocked": blocked,
        "quality_evidence": evidence,
        "verification_count": len(rows),
    }


async def add_verification(db: AsyncSession, user: User, case_id: str,
                           verification_type: str, conditions_json: Any = None,
                           result: str = "pass", notes: str = "", rid: str = "",
                           project_id: str | None = None) -> dict[str, Any]:
    """提交执行/人工复核验证；提交后自动按规则重算等级（只升不降）。"""
    case = await get_visible_case(db, user, case_id)
    if not await _can_verify_case(db, user, case, project_id):
        raise AppError("FORBIDDEN", "提交验证需要 finding.review 或 case.manage 权限（reviewer 及以上）。")
    vtype = _clean(verification_type).lower()
    if vtype not in VERIFICATION_TYPES:
        raise AppError("VALIDATION_ERROR", f"verification_type 须为 {sorted(VERIFICATION_TYPES)}。")
    vresult = _clean(result).lower()
    if vresult not in VERIFICATION_RESULTS:
        raise AppError("VALIDATION_ERROR", f"result 须为 {sorted(VERIFICATION_RESULTS)}。")

    conditions: dict[str, Any] = {}
    if isinstance(conditions_json, dict):
        conditions = conditions_json
    elif isinstance(conditions_json, str) and conditions_json.strip():
        parsed = _loads(conditions_json)
        if not isinstance(parsed, dict):
            raise AppError("VALIDATION_ERROR", "conditions_json 须为 JSON 对象字符串。")
        conditions = parsed
    elif conditions_json not in (None, ""):
        raise AppError("VALIDATION_ERROR", "conditions_json 须为 JSON 对象。")

    row = CaseVerification(
        id=new_id("cv"), case_id=case.id, verifier_user_id=user.id,
        verification_type=vtype,
        conditions_json=_dumps(conditions) if conditions else None,
        result=vresult, notes=str(notes or "").strip(),
    )
    db.add(row)
    await db.flush()
    await record_trail(
        db, action="case.verification", actor_user_id=user.id, org_id=case.org_id,
        target_type="case_verification", target_id=row.id,
        after={"case_id": case.id, "verification_type": vtype, "result": vresult,
               "conditions": conditions, "notes": row.notes},
        summary=f"提交案例验证：{vtype}/{vresult}", request_id=rid,
    )
    quality = await _apply_quality(db, user, case, rid, confirm_downgrade=False,
                                   action="case.quality_change")
    await db.commit()
    return {"verification": verification_view(row, user.display_name or ""), **quality}


async def list_verifications(db: AsyncSession, user: User, case_id: str) -> list[dict[str, Any]]:
    case = await get_visible_case(db, user, case_id)
    return await _verification_dicts(db, await _verification_rows(db, case.id))


async def recompute_quality(db: AsyncSession, user: User, case_id: str, rid: str = "",
                            confirm_downgrade: bool = False) -> dict[str, Any]:
    """显式重算质量等级（系统计算，AI 不可指定目标等级）。"""
    case = await get_visible_case(db, user, case_id)
    if not await _can_verify_case(db, user, case):
        raise AppError("FORBIDDEN", "重算质量等级需要 finding.review 或 case.manage 权限。")
    result = await _apply_quality(db, user, case, rid, confirm_downgrade,
                                  action="case.quality_recompute")
    await db.commit()
    return result