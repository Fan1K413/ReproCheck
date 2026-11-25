"""统一异常与错误码：任何失败都不会被包装成审计成功。"""
from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


# 错误码 -> HTTP 状态码
ERROR_STATUS: dict[str, int] = {
    "VALIDATION_ERROR": 422,
    "NOT_FOUND": 404,
    "LLM_KEY_NOT_CONFIGURED": 503,
    # 上游 LLM Key 失效属于服务端配置/上游鉴权问题（502），不是用户身份失效（401）。
    # 前端据此区分：401 清会话，LLM_* 仅提示服务端配置错误。
    "LLM_INVALID_KEY": 502,
    "LLM_NETWORK_ERROR": 502,
    "LLM_TIMEOUT": 504,
    "LLM_RATE_LIMITED": 429,
    "LLM_INVALID_FORMAT": 502,
    "LLM_PROVIDER_ERROR": 502,
    "EVIDENCE_VALIDATION_FAILED": 422,
    "DB_SAVE_FAILED": 500,
    "FORBIDDEN": 403,
    "UNAUTHORIZED": 401,
    "CONFLICT": 409,
    "INTERNAL_ERROR": 500,
    # 第四阶段
    "EXECUTION_DISABLED": 423,
    "SECURITY_BLOCKED": 422,
    "DAG_INVALID": 422,
    "METRIC_UNEXTRACTABLE": 422,
    "PDF_UNAVAILABLE": 501,
}


class AppError(Exception):
    """业务异常基类。message 中永远不得包含密钥或用户私密材料。"""

    def __init__(self, code: str, message: str, details: Any | None = None,
                 status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details
        self.status_code = status_code or ERROR_STATUS.get(code, 500)


class NotConfiguredError(AppError):
    def __init__(self, message: str = "尚未配置 API Key，请在后端 .env 中设置 LLM_API_KEY。"):
        super().__init__("LLM_KEY_NOT_CONFIGURED", message)


class InvalidKeyError(AppError):
    def __init__(self, message: str = "API Key 无效或已过期，请检查该模型凭据的配置。"):
        super().__init__("LLM_INVALID_KEY", message)


class NetworkError(AppError):
    def __init__(self, message: str = "无法连接模型服务，请检查网络与 LLM_BASE_URL。"):
        super().__init__("LLM_NETWORK_ERROR", message)


class TimeoutError_(AppError):
    def __init__(self, message: str = "模型服务请求超时。"):
        super().__init__("LLM_TIMEOUT", message)


class RateLimitError(AppError):
    def __init__(self, message: str = "模型服务触发限流，请稍后重试。"):
        super().__init__("LLM_RATE_LIMITED", message)


class InvalidModelFormatError(AppError):
    def __init__(self, message: str = "模型返回格式异常，且修复请求后仍不合法。", details: Any | None = None):
        super().__init__("LLM_INVALID_FORMAT", message, details)


class EvidenceValidationError(AppError):
    def __init__(self, message: str = "证据验证失败：模型引用了不存在的证据或文本块。", details: Any | None = None):
        super().__init__("EVIDENCE_VALIDATION_FAILED", message, details)


class DbSaveError(AppError):
    def __init__(self, message: str = "数据库保存失败。", details: Any | None = None):
        super().__init__("DB_SAVE_FAILED", message, details)


def ok(data: Any, request_id: str) -> dict[str, Any]:
    return {"success": True, "data": data, "error": None, "request_id": request_id}


def fail(code: str, message: str, request_id: str, details: Any | None = None) -> dict[str, Any]:
    return {
        "success": False,
        "data": None,
        "error": {"code": code, "message": message, "details": details},
        "request_id": request_id,
    }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    rid = getattr(request.state, "request_id", "-")
    return JSONResponse(
        status_code=exc.status_code,
        content=fail(exc.code, exc.message, rid, exc.details),
    )
