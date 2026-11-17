"""路由级依赖：请求 ID、受保护接口的访问令牌校验。

连接测试/审计演示会真实消耗 API 额度，生产环境必须配置 ADMIN_TOKEN 才能访问。
"""
from __future__ import annotations

from fastapi import Header, HTTPException, Request

from app.core.config import settings


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """若配置了 ADMIN_TOKEN，则要求请求头 X-Admin-Token 匹配；否则按开发开关放行。"""
    if settings.admin_token:
        if x_admin_token != settings.admin_token:
            raise HTTPException(status_code=403, detail="FORBIDDEN: 需要有效的 X-Admin-Token")
        return
    # 未配置令牌：仅当显式允许时才放行
    if not settings.allow_unauth_test_endpoints:
        raise HTTPException(status_code=403, detail="FORBIDDEN: 服务端未开放此接口")
