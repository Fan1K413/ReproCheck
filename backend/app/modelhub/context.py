"""请求级用户上下文（由 main.py 中间件设置，业务服务无需透传 user_id）。

仅用于"当前用户凭据解析"；所有 API 端点仍用 get_current_user 做强鉴权。
测试/脚本中未设置时视为匿名，网关回落到既有环境变量配置。
"""
from __future__ import annotations

from contextvars import ContextVar

current_user_id: ContextVar[str | None] = ContextVar("rc_model_current_user", default=None)
current_org_id: ContextVar[str | None] = ContextVar("rc_model_current_org", default=None)


def set_current(user_id: str | None, org_id: str | None = None):
    u = current_user_id.set(user_id)
    o = current_org_id.set(org_id)
    return u, o


def reset_current(tokens) -> None:
    current_user_id.reset(tokens[0])
    current_org_id.reset(tokens[1])
