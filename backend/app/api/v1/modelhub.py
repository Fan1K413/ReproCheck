"""第十一阶段：API 管理中心。所有端点要求已登录用户；凭据按 owner_user_id 严格隔离。

安全约束：
- 创建/更新凭据只回显脱敏信息（key_hint），任何接口都不返回 key_ciphertext。
- 自定义 Base URL 在保存时做完整 SSRF 校验。
- 连接测试真实调用目标 API，失败返回细分状态，不通过"Key 非空"判定成功。
"""
from __future__ import annotations

import json
import time
from types import SimpleNamespace
from typing import Any

import json as _json

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import AppError, ok
from app.db import get_db
from app.modelhub.capabilities import CAPABILITY_LABELS, Capability
from app.modelhub.gateway import model_gateway
from app.modelhub.registry import get_provider, list_providers
from app.modelhub.security import decrypt_credential, encrypt_credential, mask_key, validate_base_url
from app.models.modelhub import (
    ModelCallLog, ModelCredential, ModelHealth, ModelProfile, ModelRoute, TaskModelBinding,
)
from app.models.stage6 import User

class EnvelopedRoute(APIRoute):
    """把本模块所有成功响应统一包成 {success,data,error,request_id} 信封。

    与项目其余路由契约一致；异常响应由全局 AppError handler 处理，不受影响。
    """

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            response = await original(request)
            if response.status_code < 400 and isinstance(response, JSONResponse):
                try:
                    body = _json.loads(response.body)
                except (ValueError, TypeError):
                    return response
                if isinstance(body, dict) and "success" in body:
                    return response
                headers = dict(response.headers)
                headers.pop("content-length", None)
                return JSONResponse(
                    content=ok(body, getattr(request.state, "request_id", "-")),
                    status_code=response.status_code, headers=headers,
                )
            return response

        return handler


router = APIRouter(route_class=EnvelopedRoute)

TASK_KEYS = ("pdf_extraction", "fact_extraction", "diff_analysis", "failure_diagnosis",
             "rag_qa", "report_generation", "summary")


# 请求体

class CredentialIn(BaseModel):
    provider_key: str
    name: str = ""
    api_key: str = ""
    base_url: str | None = None
    org_id: str | None = None


class CredentialTestIn(BaseModel):
    """向导的“先测试、后保存”请求；密钥只存在于本次请求内存中。"""

    provider_key: str
    api_key: str
    model_id: str
    base_url: str | None = None


class GuidedModelSetupIn(BaseModel):
    """原子保存：创建凭据 + 模型配置；失败时整体回滚，不留下半截配置。"""

    provider_key: str
    api_key: str
    model_id: str
    display_name: str = ""
    name: str = ""
    base_url: str | None = None
    timeout_s: float = 60.0
    max_tokens: int | None = None
    temperature: float | None = None
    is_default: bool = True
    replace_existing: bool = False
    org_id: str | None = None


class CredentialUpdate(BaseModel):
    name: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    status: str | None = None


class ProfileIn(BaseModel):
    provider_key: str
    credential_id: str | None = None
    model_id: str
    display_name: str = ""
    params: dict[str, Any] = Field(default_factory=dict)
    timeout_s: float = 60.0
    max_retries: int = 1
    max_tokens: int | None = None
    enabled: bool = True
    is_default: bool = False
    is_fallback: bool = False
    org_id: str | None = None


class ProfileUpdate(BaseModel):
    display_name: str | None = None
    credential_id: str | None = None
    params: dict[str, Any] | None = None
    timeout_s: float | None = None
    max_retries: int | None = None
    max_tokens: int | None = None
    enabled: bool | None = None
    is_default: bool | None = None
    is_fallback: bool | None = None


class BindingIn(BaseModel):
    task_key: str
    primary_profile_id: str | None = None
    fallback_profile_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    auto_route: bool = False
    cost_preference: str = "balanced"
    enabled: bool = True
    project_id: str | None = None
    org_id: str | None = None


# 视图（绝不返回密文）

def credential_view(c: ModelCredential) -> dict[str, Any]:
    return {
        "id": c.id, "provider_key": c.provider_key, "name": c.name,
        "key_hint": c.key_hint, "base_url": c.base_url, "status": c.status,
        "last_error_code": c.last_error_code,
        "last_tested_at": c.last_tested_at.isoformat() if c.last_tested_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "has_key": bool(c.key_ciphertext),
    }


def profile_view(p: ModelProfile) -> dict[str, Any]:
    return {
        "id": p.id, "provider_key": p.provider_key, "credential_id": p.credential_id,
        "model_id": p.model_id, "display_name": p.display_name,
        "params": _safe_json(p.params_json, {}), "timeout_s": p.timeout_s,
        "max_retries": p.max_retries, "max_tokens": p.max_tokens,
        "enabled": p.enabled, "is_default": p.is_default, "is_fallback": p.is_fallback,
    }


def binding_view(b: TaskModelBinding) -> dict[str, Any]:
    return {
        "id": b.id, "task_key": b.task_key, "project_id": b.project_id,
        "primary_profile_id": b.primary_profile_id, "fallback_profile_id": b.fallback_profile_id,
        "params": _safe_json(b.params_json, {}), "auto_route": b.auto_route,
        "cost_preference": b.cost_preference, "enabled": b.enabled,
    }


def _safe_json(raw: str | None, default: Any) -> Any:
    try:
        return json.loads(raw) if raw else default
    except (ValueError, TypeError):
        return default


async def _own_credential(db: AsyncSession, cred_id: str, uid: str) -> ModelCredential:
    row = (await db.execute(select(ModelCredential).where(
        ModelCredential.id == cred_id, ModelCredential.owner_user_id == uid,
    ))).scalar_one_or_none()
    if row is None:
        raise AppError("CREDENTIAL_NOT_FOUND", "未找到该凭据，或不属于当前用户。")
    return row


async def _own_profile(db: AsyncSession, pid: str, uid: str) -> ModelProfile:
    row = (await db.execute(select(ModelProfile).where(
        ModelProfile.id == pid, ModelProfile.owner_user_id == uid,
    ))).scalar_one_or_none()
    if row is None:
        raise AppError("MODEL_PROFILE_NOT_FOUND", "未找到该模型配置，或不属于当前用户。")
    return row


def _new_id(prefix: str) -> str:
    return f"{prefix}-{time.time_ns():x}"


# 供应商 / 能力

@router.get("/model-providers")
async def get_model_providers(user: User = Depends(get_current_user)):
    return list_providers()


@router.get("/model-capabilities")
async def get_model_capabilities(user: User = Depends(get_current_user)):
    return {
        "capabilities": [{"key": str(c), "label": CAPABILITY_LABELS.get(c, str(c))}
                         for c in Capability],
        "task_keys": list(TASK_KEYS),
        "note": "供应商不支持某能力时，接口返回 CAPABILITY_UNSUPPORTED 并说明原因，绝不模拟。",
    }


# 凭据

def _resolved_base_url(provider_key: str, raw: str | None) -> str:
    spec = get_provider(provider_key)
    if spec is None:
        raise AppError("VALIDATION_ERROR", "未知的模型供应商。")
    base_url = (raw or spec.default_base_url or "").strip().rstrip("/")
    if not base_url:
        raise AppError("VALIDATION_ERROR", "请填写服务地址。")
    if provider_key == "openai_compatible" or base_url != spec.default_base_url:
        base_url = validate_base_url(base_url)
    return base_url


@router.post("/model-credentials/test-draft")
async def test_draft_credential(body: CredentialTestIn, user: User = Depends(get_current_user)):
    """真实调用服务商，但不落库、不写日志。

    向导需要“先测试、再保存”。这里用内存中的临时凭据调用同一个网关，
    返回值与已保存凭据的测试结果一致；密钥随请求结束被丢弃。
    """
    spec = get_provider(body.provider_key)
    if spec is None:
        raise AppError("VALIDATION_ERROR", "未知的模型供应商。")
    api_key = (body.api_key or "").strip()
    if not api_key:
        raise AppError("VALIDATION_ERROR", "请先填写 API 密钥。")
    model_id = (body.model_id or "").strip()
    if not model_id:
        raise AppError("VALIDATION_ERROR", "请选择或填写模型名称。")
    base_url = _resolved_base_url(body.provider_key, body.base_url)
    temporary = SimpleNamespace(
        provider_key=body.provider_key,
        base_url=base_url,
        # 只用于本次内存测试：不落库、不要求配置持久化加密密钥。
        key_plaintext=api_key,
    )
    profile = SimpleNamespace(model_id=model_id)
    return await model_gateway.test_credential(temporary, profile)


@router.post("/model-setup")
async def create_guided_model_setup(body: GuidedModelSetupIn,
                                    user: User = Depends(get_current_user),
                                    db: AsyncSession = Depends(get_db)):
    """向导保存：凭据与模型配置同一事务，任何一步失败都不留下残留凭据。"""
    spec = get_provider(body.provider_key)
    if spec is None:
        raise AppError("VALIDATION_ERROR", "未知的模型供应商。")
    api_key = (body.api_key or "").strip()
    if not api_key:
        raise AppError("VALIDATION_ERROR", "请先填写 API 密钥。")
    model_id = (body.model_id or "").strip()
    if not model_id:
        raise AppError("VALIDATION_ERROR", "请选择或填写模型名称。")
    base_url = _resolved_base_url(body.provider_key, body.base_url)
    if body.max_tokens is not None and body.max_tokens <= 0:
        raise AppError("VALIDATION_ERROR", "最大输出长度必须大于 0。")
    if body.timeout_s <= 0:
        raise AppError("VALIDATION_ERROR", "请求超时时间必须大于 0。")
    params: dict[str, Any] = {}
    if body.temperature is not None:
        if body.temperature < 0 or body.temperature > 2:
            raise AppError("VALIDATION_ERROR", "温度参数应在 0 到 2 之间。")
        params["temperature"] = body.temperature

    existing_profile = (await db.execute(select(ModelProfile).where(
        ModelProfile.owner_user_id == user.id,
        ModelProfile.provider_key == body.provider_key,
        ModelProfile.model_id == model_id,
    ))).scalar_one_or_none()
    if existing_profile is not None and not body.replace_existing:
        raise AppError("CONFLICT", f"模型「{model_id}」已有配置，请确认是否更新。")
    credential = ModelCredential(
        id=_new_id("mcred"), owner_user_id=user.id, org_id=body.org_id,
        provider_key=body.provider_key, name=(body.name or spec.name)[:120],
        key_ciphertext=encrypt_credential(api_key), key_hint=mask_key(api_key),
        base_url=base_url, status="active",
    )
    if existing_profile is not None:
        profile = existing_profile
        profile.org_id = body.org_id
        profile.credential_id = credential.id
        profile.display_name = body.display_name or model_id
        profile.params_json = json.dumps(params, ensure_ascii=False)
        profile.timeout_s = body.timeout_s
        profile.max_tokens = body.max_tokens
        profile.enabled = True
    else:
        profile = ModelProfile(
            id=_new_id("mprof"), owner_user_id=user.id, org_id=body.org_id,
            provider_key=body.provider_key, credential_id=credential.id,
            model_id=model_id, display_name=body.display_name or model_id,
            params_json=json.dumps(params, ensure_ascii=False),
            timeout_s=body.timeout_s, max_retries=1, max_tokens=body.max_tokens,
            enabled=True, is_default=False, is_fallback=False,
        )
    try:
        if body.is_default:
            await _clear_flags(db, user.id, "is_default")
            profile.is_default = True
        db.add(credential)
        if existing_profile is None:
            db.add(profile)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise AppError("CONFLICT", f"模型「{model_id}」已存在，请勿重复添加。") from exc
    except Exception:
        await db.rollback()
        raise
    return {
        "credential": credential_view(credential),
        "profile": profile_view(profile),
        "note": "已保存到后端；密钥仅以脱敏提示显示。",
    }


@router.get("/model-credentials")
async def list_credentials(user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ModelCredential).where(
        ModelCredential.owner_user_id == user.id).order_by(ModelCredential.created_at.desc())
    )).scalars().all()
    return [credential_view(c) for c in rows]


@router.post("/model-credentials")
async def create_credential(body: CredentialIn, user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    spec = get_provider(body.provider_key)
    if spec is None:
        raise AppError("VALIDATION_ERROR", "未知的模型供应商。")
    api_key = (body.api_key or "").strip()
    if not api_key:
        raise AppError("VALIDATION_ERROR", "API Key 不能为空。")
    base_url = (body.base_url or spec.default_base_url or "").strip().rstrip("/")
    if body.provider_key == "openai_compatible":
        base_url = validate_base_url(base_url)
    elif body.base_url and body.base_url != spec.default_base_url:
        base_url = validate_base_url(body.base_url)
    row = ModelCredential(
        id=_new_id("mcred"), owner_user_id=user.id, org_id=body.org_id,
        provider_key=body.provider_key, name=(body.name or spec.name)[:120],
        key_ciphertext=encrypt_credential(api_key), key_hint=mask_key(api_key),
        base_url=base_url, status="active",
    )
    db.add(row)
    await db.commit()
    return credential_view(row)


@router.patch("/model-credentials/{cred_id}")
async def update_credential(cred_id: str, body: CredentialUpdate,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    row = await _own_credential(db, cred_id, user.id)
    api_key = (body.api_key or "").strip()
    if body.base_url is not None:
        base_url = _resolved_base_url(row.provider_key, body.base_url)
        spec = get_provider(row.provider_key)
        previous_url = (row.base_url or spec.default_base_url).rstrip("/")
        if base_url != previous_url and not api_key:
            raise AppError("VALIDATION_ERROR", "更换服务地址时须重新提供 API 密钥。")
        row.base_url = base_url
    status = body.status if body.status is not None else row.status
    if status not in ("active", "revoked", "disabled"):
        raise AppError("VALIDATION_ERROR", "凭据状态非法。")
    if status != "revoked" and row.status == "revoked" and not api_key:
        raise AppError("VALIDATION_ERROR", "重新启用已吊销凭据时须提供 API 密钥。")
    if body.name is not None:
        row.name = body.name[:120]
    if status == "revoked":
        row.key_ciphertext = ""
        row.key_hint = ""
    elif api_key:
        row.key_ciphertext = encrypt_credential(api_key)
        row.key_hint = mask_key(api_key)
        row.last_error_code = None
    row.status = status
    row.updated_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    await db.commit()
    return credential_view(row)


@router.delete("/model-credentials/{cred_id}")
async def revoke_credential(cred_id: str, user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    row = await _own_credential(db, cred_id, user.id)
    row.status = "revoked"
    row.key_ciphertext = ""
    row.key_hint = ""
    await db.commit()
    return {"revoked": True, "id": cred_id}


@router.delete("/model-credentials/{cred_id}/purge")
async def purge_credential(cred_id: str, user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    row = await _own_credential(db, cred_id, user.id)
    orphan_profiles = (await db.execute(select(ModelProfile).where(
        ModelProfile.owner_user_id == user.id,
        ModelProfile.credential_id == cred_id,
    ))).scalars().all()
    await _clear_profile_bindings(db, user.id, {profile.id for profile in orphan_profiles})
    for profile in orphan_profiles:
        await db.delete(profile)
    await db.delete(row)
    await db.commit()
    return {"deleted": True, "id": cred_id}


@router.post("/model-credentials/{cred_id}/test")
async def test_credential(cred_id: str, model_id: str | None = None,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    cred = await _own_credential(db, cred_id, user.id)
    profile = None
    if model_id:
        profile = (await db.execute(select(ModelProfile).where(
            ModelProfile.owner_user_id == user.id, ModelProfile.credential_id == cred.id,
            ModelProfile.model_id == model_id,
        ))).scalar_one_or_none()
    result = await model_gateway.test_credential(cred, profile)
    cred.last_tested_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    cred.last_error_code = result.get("error_code")
    await db.commit()
    return result


@router.post("/model-credentials/{cred_id}/models")
async def fetch_models(cred_id: str, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    cred = await _own_credential(db, cred_id, user.id)
    models = await model_gateway.list_models(cred)
    return {"models": models, "count": len(models)}


@router.get("/model-credentials/{cred_id}/verify-key")
async def verify_owned_key(cred_id: str, user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """仅用于测试：确认密文可解密且属于当前用户，不返回明文。"""
    cred = await _own_credential(db, cred_id, user.id)
    if cred.status != "active":
        raise AppError("FORBIDDEN", "该凭据已停用。")
    plain = decrypt_credential(cred.key_ciphertext)
    return {"id": cred.id, "decryptable": bool(plain), "key_hint": mask_key(plain)}


# 模型配置

@router.get("/model-profiles")
async def list_profiles(user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ModelProfile).where(
        ModelProfile.owner_user_id == user.id).order_by(ModelProfile.created_at.desc())
    )).scalars().all()
    return [profile_view(p) for p in rows]


@router.post("/model-profiles")
async def create_profile(body: ProfileIn, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    if get_provider(body.provider_key) is None:
        raise AppError("VALIDATION_ERROR", "未知的模型供应商。")
    clean_model_id = body.model_id.strip()
    if not clean_model_id:
        raise AppError("VALIDATION_ERROR", "模型名称不能为空。")
    if body.timeout_s <= 0:
        raise AppError("VALIDATION_ERROR", "请求超时时间必须大于 0。")
    if body.max_tokens is not None and body.max_tokens <= 0:
        raise AppError("VALIDATION_ERROR", "最大 Token 必须大于 0。")
    if body.credential_id:
        credential = await _own_credential(db, body.credential_id, user.id)
        if credential.provider_key != body.provider_key:
            raise AppError("VALIDATION_ERROR", "模型与凭据必须使用同一供应商。")
    if body.is_default:
        await _clear_flags(db, user.id, "is_default")
    if body.is_fallback:
        await _clear_flags(db, user.id, "is_fallback")

    row = ModelProfile(
        id=_new_id("mprof"), owner_user_id=user.id, org_id=body.org_id,
        provider_key=body.provider_key, credential_id=body.credential_id,
        model_id=clean_model_id, display_name=body.display_name or clean_model_id,
        params_json=json.dumps(body.params, ensure_ascii=False),
        timeout_s=body.timeout_s, max_retries=body.max_retries, max_tokens=body.max_tokens,
        enabled=body.enabled, is_default=body.is_default, is_fallback=body.is_fallback,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise AppError("CONFLICT", f"模型「{clean_model_id}」已存在，请勿重复添加。") from exc
    return profile_view(row)


async def _clear_flags(db: AsyncSession, uid: str, field: str) -> None:
    rows = (await db.execute(select(ModelProfile).where(
        ModelProfile.owner_user_id == uid))).scalars().all()
    for row in rows:
        setattr(row, field, False)


@router.patch("/model-profiles/{pid}")
async def update_profile(pid: str, body: ProfileUpdate, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    row = await _own_profile(db, pid, user.id)
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key == "params":
            row.params_json = json.dumps(value or {}, ensure_ascii=False)
        elif key == "credential_id" and value:
            credential = await _own_credential(db, value, user.id)
            if credential.provider_key != row.provider_key:
                raise AppError("VALIDATION_ERROR", "模型与凭据必须使用同一供应商。")
            row.credential_id = value
        elif key == "is_default" and value:
            await _clear_flags(db, user.id, "is_default")
            row.is_default = True
        elif key == "is_fallback" and value:
            await _clear_flags(db, user.id, "is_fallback")
            row.is_fallback = True
        elif hasattr(row, key):
            setattr(row, key, value)
    await db.commit()
    return profile_view(row)


@router.delete("/model-profiles/{pid}")
async def delete_profile(pid: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    row = await _own_profile(db, pid, user.id)
    await _clear_profile_bindings(db, user.id, {pid})
    await db.delete(row)
    await db.commit()
    return {"deleted": True, "id": pid}


@router.post("/model-profiles/{pid}/test")
async def test_profile(pid: str, model_id: str | None = None,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    profile = await _own_profile(db, pid, user.id)
    if not profile.credential_id:
        raise AppError("CREDENTIAL_NOT_FOUND", "该模型未关联 API 凭据。")
    cred = await _own_credential(db, profile.credential_id, user.id)
    return await model_gateway.test_credential(cred, profile)


# 任务绑定

async def _clear_profile_bindings(db: AsyncSession, uid: str, profile_ids: set[str]) -> None:
    if not profile_ids:
        return
    bindings = (await db.execute(select(TaskModelBinding).where(
        TaskModelBinding.owner_user_id == uid,
        or_(TaskModelBinding.primary_profile_id.in_(profile_ids),
            TaskModelBinding.fallback_profile_id.in_(profile_ids)),
    ))).scalars().all()
    for binding in bindings:
        if binding.primary_profile_id in profile_ids:
            binding.primary_profile_id = None
        if binding.fallback_profile_id in profile_ids:
            binding.fallback_profile_id = None

@router.get("/task-model-bindings")
async def list_bindings(project_id: str | None = None,
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    query = select(TaskModelBinding).where(TaskModelBinding.owner_user_id == user.id)
    query = query.where(TaskModelBinding.project_id == project_id) if project_id else \
        query.where(TaskModelBinding.project_id.is_(None))
    rows = (await db.execute(query)).scalars().all()
    return [binding_view(b) for b in rows]


@router.put("/task-model-bindings")
async def upsert_binding(body: BindingIn, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    if body.task_key not in TASK_KEYS:
        raise AppError("VALIDATION_ERROR", "未知的任务类型。")
    for pid in (body.primary_profile_id, body.fallback_profile_id):
        if pid:
            await _own_profile(db, pid, user.id)
    query = select(TaskModelBinding).where(
        TaskModelBinding.owner_user_id == user.id,
        TaskModelBinding.task_key == body.task_key,
    )
    query = query.where(TaskModelBinding.project_id == body.project_id) if body.project_id else \
        query.where(TaskModelBinding.project_id.is_(None))
    row = (await db.execute(query)).scalar_one_or_none()
    if row is None:
        row = TaskModelBinding(id=_new_id("tbind"), owner_user_id=user.id,
                               task_key=body.task_key)
        db.add(row)
    row.task_key = body.task_key
    row.org_id = body.org_id
    row.project_id = body.project_id
    row.primary_profile_id = body.primary_profile_id
    row.fallback_profile_id = body.fallback_profile_id
    row.params_json = json.dumps(body.params, ensure_ascii=False)
    row.auto_route = body.auto_route
    row.cost_preference = body.cost_preference
    row.enabled = body.enabled
    await db.commit()
    return binding_view(row)


@router.delete("/task-model-bindings/{bid}")
async def delete_binding(bid: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(TaskModelBinding).where(
        TaskModelBinding.id == bid, TaskModelBinding.owner_user_id == user.id,
    ))).scalar_one_or_none()
    if row is None:
        raise AppError("BINDING_NOT_FOUND", "未找到该任务绑定。")
    await db.delete(row)
    await db.commit()
    return {"deleted": True, "id": bid}


# 统计 / 记录 / 健康

@router.get("/model-call-logs")
async def call_logs(limit: int = Query(50, ge=1, le=500),
                    task_key: str | None = None,
                    user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    query = select(ModelCallLog).where(ModelCallLog.owner_user_id == user.id)
    if task_key:
        query = query.where(ModelCallLog.task_key == task_key)
    rows = (await db.execute(query.order_by(ModelCallLog.created_at.desc()).limit(limit))).scalars().all()
    return [{
        "id": r.id, "request_id": r.request_id, "task_key": r.task_key,
        "provider_key": r.provider_key, "model_id": r.model_id, "success": r.success,
        "error_code": r.error_code, "prompt_tokens": r.prompt_tokens,
        "completion_tokens": r.completion_tokens, "duration_ms": r.duration_ms,
        "fallback_reason": r.fallback_reason, "cost_estimate": r.cost_estimate,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]


@router.get("/model-stats")
async def model_stats(user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ModelCallLog).where(
        ModelCallLog.owner_user_id == user.id))).scalars().all()
    total = len(rows)
    success = sum(1 for r in rows if r.success)
    durations = sorted(r.duration_ms for r in rows)
    p95 = durations[min(len(durations) - 1, int(len(durations) * 0.95))] if durations else 0

    def group(key):
        out: dict[str, dict[str, int]] = {}
        for r in rows:
            k = key(r) or "unknown"
            d = out.setdefault(k, {"calls": 0, "success": 0, "prompt_tokens": 0,
                                   "completion_tokens": 0})
            d["calls"] += 1
            d["success"] += 1 if r.success else 0
            d["prompt_tokens"] += r.prompt_tokens
            d["completion_tokens"] += r.completion_tokens
        return out

    return {
        "total_calls": total, "success_calls": success, "failed_calls": total - success,
        "prompt_tokens": sum(r.prompt_tokens for r in rows),
        "completion_tokens": sum(r.completion_tokens for r in rows),
        "avg_duration_ms": int(sum(durations) / total) if total else 0,
        "p95_duration_ms": p95,
        "by_provider": group(lambda r: r.provider_key),
        "by_model": group(lambda r: r.model_id),
        "by_task": group(lambda r: r.task_key),
        "cost_note": "供应商未提供真实费用数据；cost_estimate=unavailable，不编造费用。",
    }


@router.get("/model-health")
async def model_health(user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ModelHealth))).scalars().all()
    return [{
        "provider_key": r.provider_key, "model_id": r.model_id, "status": r.status,
        "last_error_code": r.last_error_code, "latency_ms": r.latency_ms,
        "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
    } for r in rows]


@router.get("/model-routes")
async def model_routes(limit: int = Query(50, ge=1, le=500),
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ModelRoute).where(
        ModelRoute.owner_user_id == user.id).order_by(
        ModelRoute.created_at.desc()).limit(limit))).scalars().all()
    return [{"id": r.id, "task_key": r.task_key, "chosen_profile_id": r.chosen_profile_id,
             "reason": _safe_json(r.reason_json, {}), "auto_route": r.auto_route,
             "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]
