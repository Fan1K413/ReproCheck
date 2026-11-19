"""外部仓库连接器（D）：GitHub/GitLab/Gitee 凭据加密托管、仓库快照同步。

安全要点：
- 访问令牌用 Fernet 加密落库（token_encrypted），任何响应/日志绝不回显明文或密文。
- 同步必须真实拉取远端 commit；无凭据或不在白名单时落 BLOCKED 快照，绝不伪造 sha。
- 仅允许连接创建者所在组织可见；撤销后立即清空密文。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import user_has_permission
from app.core.errors import AppError
from app.core.security import decrypt_secret, encrypt_secret, new_id
from app.models.stage6 import OrgMember, RepositoryConnection, RepositorySnapshot, User
from app.services.trail_service import record_trail

PROVIDERS = {"github", "gitlab", "gitee"}


async def _user_org_ids(db: AsyncSession, user: User) -> list[str]:
    rows = (await db.execute(select(OrgMember.org_id).where(OrgMember.user_id == user.id))).scalars().all()
    return list(rows)


def _view(conn: RepositoryConnection) -> dict:
    """绝不包含 token_encrypted / 明文令牌。"""
    return {
        "connection_id": conn.id,
        "provider": conn.provider,
        "account_label": conn.account_label,
        "auth_type": conn.auth_type,
        "status": conn.status,
        "org_id": conn.org_id,
        "repo_allowlist": json.loads(conn.repo_allowlist_json or "[]"),
        "has_token": bool(conn.token_encrypted),
        "created_at": conn.created_at.isoformat() if conn.created_at else "",
        "revoked_at": conn.revoked_at.isoformat() if conn.revoked_at else None,
    }


async def connect_repository(db: AsyncSession, user: User, payload: dict, rid: str) -> dict:
    provider = (payload.get("provider") or "").lower()
    if provider not in PROVIDERS:
        raise AppError("VALIDATION_ERROR", f"不支持的仓库服务商：{provider or '(空)'}")
    org_id = payload.get("org_id")
    if not org_id:
        orgs = await _user_org_ids(db, user)
        org_id = orgs[0] if orgs else None
    if not await user_has_permission(db, user, "integration.manage", org_id=org_id):
        raise AppError("FORBIDDEN", "缺少权限：integration.manage")
    token = payload.get("token") or ""
    allowlist = payload.get("repo_allowlist") or []
    conn = RepositoryConnection(
        id=new_id("repo"), org_id=org_id, user_id=user.id, provider=provider,
        account_label=payload.get("account_label", ""), auth_type=payload.get("auth_type", "pat"),
        token_encrypted=encrypt_secret(token) if token else None,
        scopes_json=json.dumps(payload.get("scopes") or [], ensure_ascii=False),
        status="connected" if token else "no_credentials",
        repo_allowlist_json=json.dumps(allowlist, ensure_ascii=False),
    )
    db.add(conn)
    await record_trail(db, action="integration.connect", actor_user_id=user.id, org_id=org_id,
                       target_type="repository_connection", target_id=conn.id,
                       after={"provider": provider, "has_token": bool(token)},
                       summary="连接外部仓库", request_id=rid)
    await db.commit()
    await db.refresh(conn)
    return _view(conn)


async def list_repositories(db: AsyncSession, user: User) -> list[dict]:
    if user.is_platform_admin:
        rows = (await db.execute(select(RepositoryConnection))).scalars().all()
    else:
        orgs = await _user_org_ids(db, user)
        rows = (await db.execute(select(RepositoryConnection).where(
            (RepositoryConnection.user_id == user.id)
            | (RepositoryConnection.org_id.in_(orgs) if orgs else False)
        ))).scalars().all()
    return [_view(c) for c in rows]


async def _get_conn(db: AsyncSession, user: User, conn_id: str) -> RepositoryConnection:
    conn = (await db.execute(select(RepositoryConnection).where(
        RepositoryConnection.id == conn_id))).scalar_one_or_none()
    if conn is None:
        raise AppError("NOT_FOUND", "仓库连接不存在或无权访问。")
    if user.is_platform_admin or conn.user_id == user.id:
        return conn
    orgs = await _user_org_ids(db, user)
    if conn.org_id and conn.org_id in orgs:
        return conn
    raise AppError("NOT_FOUND", "仓库连接不存在或无权访问。")


async def revoke_repository(db: AsyncSession, user: User, conn_id: str, rid: str) -> dict:
    conn = await _get_conn(db, user, conn_id)
    is_admin = await user_has_permission(db, user, "integration.manage", org_id=conn.org_id)
    if conn.user_id != user.id and not is_admin and not user.is_platform_admin:
        raise AppError("FORBIDDEN", "仅创建者或组织管理员可撤销连接。")
    conn.status = "revoked"
    conn.token_encrypted = None
    conn.revoked_at = datetime.now(timezone.utc)
    await record_trail(db, action="integration.revoke", actor_user_id=user.id, org_id=conn.org_id,
                       target_type="repository_connection", target_id=conn.id,
                       summary="撤销仓库连接并清空凭据", request_id=rid)
    await db.commit()
    return _view(conn)


async def _fetch_remote_commit(provider: str, token: str, repo_full_name: str, ref: str) -> dict:
    """真实拉取远端 commit 元信息。测试可 monkeypatch 本函数注入确定性结果。"""
    if provider == "github":
        url = f"https://api.github.com/repos/{repo_full_name}/commits/{ref or 'HEAD'}"
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            data = r.json()
            return {"commit_sha": data.get("sha", ""), "branch": ref or "HEAD",
                    "default_branch": "", "message": (data.get("commit") or {}).get("message", "")}
    if provider == "gitlab":
        from urllib.parse import quote
        proj = quote(repo_full_name, safe="")
        url = f"https://gitlab.com/api/v4/projects/{proj}/repository/commits/{ref or 'HEAD'}"
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, headers={"PRIVATE-TOKEN": token})
            r.raise_for_status()
            data = r.json()
            return {"commit_sha": data.get("id", ""), "branch": ref or "HEAD",
                    "default_branch": "", "message": data.get("message", "")}
    if provider == "gitee":
        url = f"https://gitee.com/api/v5/repos/{repo_full_name}/commits/{ref or 'HEAD'}"
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, params={"access_token": token})
            r.raise_for_status()
            data = r.json()
            sha = data[0].get("sha", "") if isinstance(data, list) and data else data.get("sha", "")
            return {"commit_sha": sha, "branch": ref or "HEAD", "default_branch": "", "message": ""}
    raise AppError("VALIDATION_ERROR", f"不支持的仓库服务商：{provider}")


async def sync_repository(db: AsyncSession, user: User, conn_id: str,
                          repo_full_name: str, ref: str, rid: str) -> dict:
    conn = await _get_conn(db, user, conn_id)
    if not await user_has_permission(db, user, "integration.manage", org_id=conn.org_id):
        raise AppError("FORBIDDEN", "缺少权限：integration.manage")
    if conn.status == "revoked":
        raise AppError("CONFLICT", "连接已撤销，无法同步。")
    allowlist = json.loads(conn.repo_allowlist_json or "[]")
    if allowlist and repo_full_name not in allowlist:
        raise AppError("FORBIDDEN", "仓库不在该连接的白名单内。")

    snapshot = RepositorySnapshot(
        id=new_id("snap"), connection_id=conn.id, project_id=None,
        repo_full_name=repo_full_name, branch=ref or "",
    )
    if not conn.token_encrypted:
        snapshot.version_diff_json = json.dumps(
            {"status": "blocked_no_credentials",
             "reason": "未配置访问令牌，无法真实拉取远端 commit；不伪造版本号。"}, ensure_ascii=False)
        db.add(snapshot)
        await db.commit()
        await db.refresh(snapshot)
        return _snapshot_view(snapshot)

    token = decrypt_secret(conn.token_encrypted)
    try:
        info = await _fetch_remote_commit(conn.provider, token, repo_full_name, ref)
    except Exception as exc:  # noqa: BLE001
        snapshot.version_diff_json = json.dumps(
            {"status": "blocked_fetch_failed", "reason": f"远端拉取失败：{type(exc).__name__}"},
            ensure_ascii=False)
        db.add(snapshot)
        await db.commit()
        await db.refresh(snapshot)
        return _snapshot_view(snapshot)

    snapshot.commit_sha = info.get("commit_sha", "")
    snapshot.default_branch = info.get("default_branch", "")
    snapshot.branch = info.get("branch", ref or "")
    snapshot.version_diff_json = json.dumps({"status": "synced", "message": info.get("message", "")},
                                            ensure_ascii=False)
    db.add(snapshot)
    await record_trail(db, action="integration.sync", actor_user_id=user.id, org_id=conn.org_id,
                       target_type="repository_snapshot", target_id=snapshot.id,
                       after={"repo": repo_full_name, "commit_sha": snapshot.commit_sha},
                       summary="同步仓库快照", request_id=rid)
    await db.commit()
    await db.refresh(snapshot)
    return _snapshot_view(snapshot)


def _snapshot_view(s: RepositorySnapshot) -> dict:
    diff = json.loads(s.version_diff_json or "{}")
    return {
        "snapshot_id": s.id, "connection_id": s.connection_id,
        "repo_full_name": s.repo_full_name, "default_branch": s.default_branch,
        "commit_sha": s.commit_sha, "tag": s.tag, "branch": s.branch,
        "status": diff.get("status", "synced"), "detail": diff,
        "fetched_at": s.fetched_at.isoformat() if s.fetched_at else "",
    }


async def list_snapshots(db: AsyncSession, user: User, conn_id: str) -> list[dict]:
    await _get_conn(db, user, conn_id)
    rows = (await db.execute(select(RepositorySnapshot).where(
        RepositorySnapshot.connection_id == conn_id).order_by(RepositorySnapshot.fetched_at.desc()))).scalars().all()
    return [_snapshot_view(s) for s in rows]