"""统一模型网关：任务绑定解析 → 凭据解密 → 能力校验 → 适配器调用 → 结构化校验 → 日志。

关键行为：
- 用户未配置任何模型时透明回落到既有 LLMService（环境变量），保证历史功能零回归。
- 自动故障切换仅走用户显式配置的 fallback_profile_id，并记录 fallback_reason。
- 任何失败都不伪造结果；结构化输出经 Pydantic 严格校验 + 一次有限修复。
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any, TypeVar

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    AppError, InvalidKeyError, InvalidModelFormatError, NetworkError,
    RateLimitError, TimeoutError_,
)
from app.core.logging import logger
from app.core.config import settings
from app.llm import LLMResponse, _extract_json, llm_service
from app.modelhub.base import ModelRequest, ModelResponse
from app.modelhub.capabilities import Capability
from app.modelhub.context import current_org_id, current_user_id
from app.modelhub.errors import (
    CredentialNotFoundError, CredentialRevokedError, ModelDisabledError,
    ModelNotFoundError, RouteDisabledError,
)
from app.modelhub.registry import build_adapter, get_provider
from app.modelhub.security import decrypt_credential, redact_secrets, resolve_model_endpoint
from app.models.modelhub import (
    ModelCallLog, ModelCredential, ModelProfile, ModelRoute, TaskModelBinding,
)
from app.schemas import TokenUsage

T = TypeVar("T")

_TRANSIENT = {"LLM_PROVIDER_ERROR", "LLM_RATE_LIMITED", "LLM_TIMEOUT", "LLM_NETWORK_ERROR",
              "MODEL_NOT_FOUND", "LLM_INVALID_KEY"}


def _load_json(value: str | None, default: Any) -> Any:
    try:
        return json.loads(value) if value else default
    except (ValueError, TypeError):
        return default


class ModelGateway:
    """业务任务调用模型的唯一入口。"""

    async def is_configured(self, db: AsyncSession, task_key: str, project_id: str) -> bool:
        if settings.is_llm_configured:
            return True
        uid = current_user_id.get()
        if not uid:
            return False
        binding = await self._resolve_binding(db, uid, task_key, project_id)
        if binding and binding.primary_profile_id:
            return True
        return (await self.resolve_default_profile(db, uid)) is not None

    async def resolve_default_profile(
        self, db: AsyncSession, uid: str,
    ) -> tuple[ModelProfile, ModelCredential] | None:
        """返回用户明确设为默认并已启用的模型及其有效凭据。"""
        result = (await db.execute(select(ModelProfile, ModelCredential).join(
            ModelCredential, ModelCredential.id == ModelProfile.credential_id,
        ).where(
            ModelProfile.owner_user_id == uid,
            ModelProfile.enabled.is_(True),
            ModelProfile.is_default.is_(True),
            ModelCredential.owner_user_id == uid,
            ModelCredential.provider_key == ModelProfile.provider_key,
            ModelCredential.status == "active",
            ModelCredential.key_ciphertext != "",
        ).order_by(ModelProfile.created_at.desc(), ModelProfile.id).limit(1))).first()
        return (result[0], result[1]) if result is not None else None

    async def _get_fallback_profile(
        self, db: AsyncSession, uid: str, exclude_id: str,
    ) -> ModelProfile | None:
        return (await db.execute(select(ModelProfile).where(
            ModelProfile.owner_user_id == uid,
            ModelProfile.enabled.is_(True),
            ModelProfile.is_fallback.is_(True),
            ModelProfile.id != exclude_id,
        ).order_by(ModelProfile.created_at.desc()))).scalars().first()

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        response_schema: type[T] | None = None,
        max_tokens: int | None = None,
        task_key: str = "default",
        db: AsyncSession | None = None,
        user_id: str | None = None,
        project_id: str | None = None,
        org_id: str | None = None,
    ) -> LLMResponse:
        uid = user_id or current_user_id.get()
        oid = org_id or current_org_id.get()
        if not uid:
            # 兼容性回落：无用户上下文（CLI / 旧测试）走既有环境变量配置
            return await llm_service.chat(messages, response_schema=response_schema,
                                          max_tokens=max_tokens)

        from app.db import SessionLocal
        own_session = db is None
        session = db or SessionLocal()
        try:
            return await self._chat_resolved(
                session, uid, oid, messages, task_key, response_schema,
                max_tokens, project_id,
            )
        finally:
            if own_session:
                try:
                    await session.commit()
                except Exception as exc:  # noqa: BLE001 - 日志失败不影响模型结果
                    logger.warning("model_gateway_log_failed type=%s", type(exc).__name__)
                finally:
                    await session.close()

    async def _chat_resolved(
        self,
        db: AsyncSession,
        uid: str,
        oid: str | None,
        messages: list[dict[str, Any]],
        task_key: str,
        response_schema: type[T] | None,
        max_tokens: int | None,
        project_id: str | None,
    ) -> LLMResponse:
        binding = await self._resolve_binding(db, uid, task_key, project_id)
        if binding is not None and binding.primary_profile_id:
            primary = await self._get_profile(db, binding.primary_profile_id, uid)
            if primary is None:
                raise ModelNotFoundError(binding.primary_profile_id or "未配置")
            if not primary.enabled:
                raise ModelDisabledError(primary.model_id)
            fallback = await self._get_profile(db, binding.fallback_profile_id, uid)
            binding_params = _load_json(binding.params_json, {})
            auto_route = bool(binding.auto_route)
        else:
            default_pair = await self.resolve_default_profile(db, uid)
            if default_pair is None:
                # 用户既无任务绑定也无默认模型 → 明确回落环境变量配置
                logger.info("model_gateway_fallback_env task=%s user=%s", task_key, uid)
                return await llm_service.chat(messages, response_schema=response_schema,
                                              max_tokens=max_tokens)
            primary = default_pair[0]
            fallback = await self._get_fallback_profile(db, uid, primary.id)
            binding_params = {}
            auto_route = False

        if auto_route and not primary.is_default:
            # 自动路由开启时仅按能力/成本偏好校验，不静默切到未授权供应商
            chosen = await self._auto_route(db, uid, task_key, primary, response_schema)
            if chosen.id != primary.id:
                logger.info("model_gateway_route task=%s from=%s to=%s",
                            task_key, primary.id, chosen.id)
        else:
            chosen = primary

        if auto_route:
            await self._record_route(db, uid, task_key, chosen.id, {
                "binding": "auto_route", "primary_profile_id": primary.id, "task_key": task_key,
            })
        return await self._call_profiles(
            db, uid, oid, messages, task_key, response_schema, max_tokens,
            chosen, fallback, binding_params,
        )

    async def test_default_model(
        self, db: AsyncSession, profile: ModelProfile, credential: ModelCredential,
    ) -> LLMResponse:
        """只测试已选定的默认模型，跳过任务路由和故障切换。"""
        return await self._call_profiles(
            db, profile.owner_user_id, credential.org_id,
            [{"role": "user", "content": "请简短回复：ReproCheck API 连接成功。"}],
            "connection_test", None, 64, profile, None, {},
        )

    async def _call_profiles(
        self, db: AsyncSession, uid: str, oid: str | None,
        messages: list[dict[str, Any]], task_key: str, response_schema: type[T] | None,
        max_tokens: int | None, chosen: ModelProfile, fallback: ModelProfile | None,
        binding_params: dict[str, Any],
    ) -> LLMResponse:
        want_json = response_schema is not None

        started = time.perf_counter()
        last_error: AppError | None = None
        used_fallback = False
        candidates = [chosen]
        if fallback is not None and fallback.enabled and fallback.id != chosen.id:
            candidates.append(fallback)

        response: ModelResponse | None = None
        parsed: Any = None
        fallback_error: AppError | None = None
        for idx, profile in enumerate(candidates):
            params = {**_load_json(profile.params_json, {}), **binding_params}
            req = ModelRequest(
                model=profile.model_id, messages=messages,
                temperature=float(params.get("temperature", 0.0)),
                max_tokens=max_tokens or profile.max_tokens,
                response_format={"type": "json_object"} if want_json else None,
                extra=params.get("extra") or {},
                timeout=float(profile.timeout_s or 60.0),
                max_retries=int(profile.max_retries if profile.max_retries is not None else 1),
            )
            try:
                adapter = await self._build_adapter(db, profile, uid)
                if want_json:
                    adapter.require(Capability.JSON_SCHEMA)
                response = await adapter.chat(req)
                parsed = await self._validate_schema(response.content, response_schema)
                if idx > 0:
                    used_fallback = True
                fallback_error = last_error
                last_error = None   # 成功必须清空，否则会被误判为失败
                break
            except AppError as exc:
                last_error = exc
                logger.warning("model_gateway_call_failed task=%s provider=%s code=%s",
                               task_key, profile.provider_key, exc.code)
                if idx + 1 < len(candidates) and exc.code in _TRANSIENT:
                    continue
                break
            except (ValidationError, ValueError, json.JSONDecodeError) as exc:
                # schema 校验失败由 _validate_schema 负责修复/抛错，这里兜底
                last_error = InvalidModelFormatError(details={"error": str(exc)[:200]})
                break

        if response is None or last_error is not None:
            code = last_error.code if last_error else "LLM_PROVIDER_ERROR"
            await self._log_call(db, uid, oid, task_key, req, success=False, error_code=code,
                                 provider_key=profile.provider_key,
                                 duration_ms=int((time.perf_counter() - started) * 1000))
            raise last_error or AppError("LLM_PROVIDER_ERROR", "模型调用失败。")

        duration_ms = int((time.perf_counter() - started) * 1000)
        await self._log_call(db, uid, oid, task_key, req, success=True, error_code=None,
                             provider_key=profile.provider_key, usage=response.usage,
                             duration_ms=duration_ms,
                             fallback_reason=("主模型失败：" + fallback_error.code)
                             if (used_fallback and fallback_error) else None)
        return LLMResponse(
            content=response.content,
            model=response.model,
            usage=response.usage,
            duration_ms=duration_ms,
            request_id=req.request_id,
            provider=response.provider,
            parsed=parsed,
        )

    async def _validate_schema(self, content: str, schema: type[T] | None) -> Any:
        if schema is None:
            return None
        try:
            return schema.model_validate(_extract_json(content))
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            raise InvalidModelFormatError(
                "模型输出不符合结构要求。",
                details={"validation_error": str(exc)[:400]},
            ) from exc

    async def _resolve_binding(self, db: AsyncSession, uid: str, task_key: str,
                               project_id: str | None) -> TaskModelBinding | None:
        # 项目级优先，其次用户级；只取当前用户自己的绑定
        if project_id:
            row = (await db.execute(select(TaskModelBinding).where(
                TaskModelBinding.owner_user_id == uid,
                TaskModelBinding.project_id == project_id,
                TaskModelBinding.task_key == task_key,
                TaskModelBinding.enabled.is_(True),
            ))).scalar_one_or_none()
            if row:
                return row
        return (await db.execute(select(TaskModelBinding).where(
            TaskModelBinding.owner_user_id == uid,
            TaskModelBinding.project_id.is_(None),
            TaskModelBinding.task_key == task_key,
            TaskModelBinding.enabled.is_(True),
        ))).scalar_one_or_none()

    async def _get_profile(self, db: AsyncSession, profile_id: str | None,
                           uid: str) -> ModelProfile | None:
        if not profile_id:
            return None
        return (await db.execute(select(ModelProfile).where(
            ModelProfile.id == profile_id, ModelProfile.owner_user_id == uid,
        ))).scalar_one_or_none()

    async def _auto_route(self, db: AsyncSession, uid: str, task_key: str,
                          primary: ModelProfile,
                          schema: type | None) -> ModelProfile:
        """按能力矩阵与成本偏好选择；绝不切换到用户未配置的供应商。"""
        candidates = (await db.execute(select(ModelProfile).where(
            ModelProfile.owner_user_id == uid, ModelProfile.enabled.is_(True),
        ))).scalars().all()
        allowed = [p for p in candidates if p.credential_id and p.provider_key == primary.provider_key]
        if not allowed:
            return primary
        spec = get_provider(primary.provider_key)
        caps = spec.capabilities if spec else frozenset()
        if schema is not None and Capability.JSON_SCHEMA not in caps:
            return primary
        # 成本偏好仅在用户显式配置时生效；缺少价格数据时按默认模型优先
        return next((p for p in allowed if p.is_default), primary)

    async def _record_route(self, db: AsyncSession, uid: str, task_key: str,
                            profile_id: str, reason: dict) -> None:
        db.add(ModelRoute(id=f"mroute-{time.time_ns():x}", owner_user_id=uid,
                          task_key=task_key, chosen_profile_id=profile_id,
                          reason_json=json.dumps(reason, ensure_ascii=False),
                          auto_route=True))

    async def _build_adapter(self, db: AsyncSession, profile: ModelProfile,
                             uid: str):
        cred = (await db.execute(select(ModelCredential).where(
            ModelCredential.id == profile.credential_id,
            ModelCredential.owner_user_id == uid,
        ))).scalar_one_or_none() if profile.credential_id else None
        if cred is None or cred.provider_key != profile.provider_key:
            raise CredentialNotFoundError()
        adapter, _ = await self._credential_adapter(cred)
        return adapter

    async def _credential_adapter(self, credential):
        if getattr(credential, "status", "active") != "active":
            raise CredentialRevokedError()
        spec = get_provider(credential.provider_key)
        if spec is None:
            raise ModelNotFoundError(credential.provider_key)
        base_url = credential.base_url or spec.default_base_url
        if not base_url:
            raise AppError("VALIDATION_ERROR", "该供应商需要在凭据中配置 Base URL。")
        pinned_ip = None
        if credential.provider_key == "openai_compatible" or base_url != spec.default_base_url:
            base_url, pinned_ip = await asyncio.to_thread(resolve_model_endpoint, base_url)
        api_key = getattr(credential, "key_plaintext", None) or decrypt_credential(credential.key_ciphertext)
        adapter = build_adapter(credential.provider_key, base_url, api_key)
        adapter.pinned_ip = pinned_ip
        return adapter, api_key

    async def _log_call(self, db: AsyncSession, uid: str, oid: str | None, task_key: str,
                        req: ModelRequest, *, success: bool, error_code: str | None,
                        duration_ms: int, provider_key: str = "",
                        usage: TokenUsage | None = None,
                        fallback_reason: str | None = None) -> None:
        # 由创建会话的一方负责事务边界。
        db.add(ModelCallLog(
            id=f"mcall-{time.time_ns():x}", request_id=req.request_id,
            owner_user_id=uid, org_id=oid, task_key=task_key,
            provider_key=provider_key,
            model_id=req.model[:160], success=success, error_code=error_code,
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
            duration_ms=duration_ms, fallback_reason=fallback_reason,
            cost_estimate="unavailable",
        ))

    # 连接测试 / 模型列表（真实调用目标 API）

    async def test_credential(self, credential, profile=None) -> dict[str, Any]:
        spec = get_provider(credential.provider_key)
        if spec is None:
            raise ModelNotFoundError(credential.provider_key)
        adapter, api_key = await self._credential_adapter(credential)
        model = profile.model_id if profile else (spec.default_models[0] if spec.default_models else "")
        if not model:
            raise AppError("VALIDATION_ERROR", "请提供要测试的模型名称。")
        req = ModelRequest(model=model, messages=[{"role": "user", "content": "请只回复：OK"}],
                           max_tokens=32, timeout=30.0, max_retries=0)
        started = time.perf_counter()
        try:
            resp = await adapter.chat(req)
            result = {
                "status": "success", "provider": credential.provider_key,
                "model": resp.model, "latency_ms": resp.duration_ms,
                "prompt_tokens": resp.usage.prompt_tokens,
                "completion_tokens": resp.usage.completion_tokens,
                "reply_preview": resp.content[:120],
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        except AppError as exc:
            result = {
                "status": self._status_for(exc.code), "provider": credential.provider_key,
                "model": model, "error_code": exc.code, "error_message": redact_secrets(exc.message, [api_key]),
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        return result

    @staticmethod
    def _status_for(code: str) -> str:
        return {
            "LLM_INVALID_KEY": "auth_failed",
            "LLM_RATE_LIMITED": "rate_limited",
            "LLM_TIMEOUT": "timeout",
            "LLM_NETWORK_ERROR": "network_error",
            "LLM_INVALID_FORMAT": "incompatible_format",
            "MODEL_NOT_FOUND": "model_not_found",
            "CAPABILITY_UNSUPPORTED": "capability_unsupported",
            "SSRF_BLOCKED": "ssrf_blocked",
        }.get(code, "provider_error")

    async def list_models(self, credential) -> list[dict[str, Any]]:
        adapter, _ = await self._credential_adapter(credential)
        return await adapter.list_models()


model_gateway = ModelGateway()
