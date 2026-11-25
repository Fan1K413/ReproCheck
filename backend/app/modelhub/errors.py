"""模型中心统一错误码。全部为 AppError 子类，兼容现有信封与异常处理器。"""
from __future__ import annotations

from typing import Any

from app.core.errors import AppError

# 追加到全局错误码表（在 main.py 导入本模块时生效，app_error_handler 用 status_code 属性）
MODEL_ERROR_STATUS: dict[str, int] = {
    "CAPABILITY_UNSUPPORTED": 422,
    "CREDENTIAL_NOT_FOUND": 404,
    "CREDENTIAL_REVOKED": 410,
    "ENCRYPTION_UNAVAILABLE": 503,
    "SSRF_BLOCKED": 422,
    "MODEL_NOT_FOUND": 404,
    "MODEL_DISABLED": 403,
    "ROUTE_DISABLED": 403,
    "MODEL_PROFILE_NOT_FOUND": 404,
    "BINDING_NOT_FOUND": 404,
}


def _register() -> None:
    from app.core import errors as core_errors
    core_errors.ERROR_STATUS.update(MODEL_ERROR_STATUS)


_register()


class CapabilityUnsupportedError(AppError):
    def __init__(self, provider: str, capability: str, reason: str):
        super().__init__(
            "CAPABILITY_UNSUPPORTED",
            f"供应商 {provider} 不支持能力「{capability}」：{reason}",
            details={"provider": provider, "capability": capability, "reason": reason},
        )


class CredentialNotFoundError(AppError):
    def __init__(self) -> None:
        super().__init__("CREDENTIAL_NOT_FOUND", "未找到该 API 凭据，或不属于当前用户。")


class CredentialRevokedError(AppError):
    def __init__(self) -> None:
        super().__init__("CREDENTIAL_REVOKED", "该 API 凭据已撤销，请重新配置。")


class EncryptionUnavailableError(AppError):
    def __init__(self) -> None:
        super().__init__(
            "ENCRYPTION_UNAVAILABLE",
            "服务端未配置独立的模型凭据加密密钥（MODEL_CREDENTIAL_KEY），无法安全保存 API Key。",
        )


class SSRFBlockedError(AppError):
    def __init__(self, reason: str) -> None:
        # reason 只含泛化原因（如"私网地址"），不回显完整 URL，避免探测细节泄露
        super().__init__("SSRF_BLOCKED", f"自定义模型地址被安全策略拒绝：{reason}",
                         details={"reason": reason})


class ModelNotFoundError(AppError):
    def __init__(self, model_id: str) -> None:
        super().__init__("MODEL_NOT_FOUND", f"模型 {model_id} 不存在或当前凭据无权访问。")


class ModelDisabledError(AppError):
    def __init__(self, model_id: str) -> None:
        super().__init__("MODEL_DISABLED", f"模型 {model_id} 已被禁用。")


class RouteDisabledError(AppError):
    def __init__(self) -> None:
        super().__init__("ROUTE_DISABLED", "自动模型路由未开启，且当前任务没有可用绑定。")
