"""第六阶段幂等迁移：新增表 + 既有表加可空列 + RBAC 种子 + 默认组织回填。

沿用第二阶段「Inspector 检测 + 幂等加列」约定。upgrade 全程 additive，不丢数据。
可独立运行：python -m app.db.migrate_stage6
"""
from __future__ import annotations

import shutil
from pathlib import Path

from sqlalchemy import inspect, select, text

from app.core.config import settings
from app.core.rbac import PERMISSIONS, ROLES
from app.core.security import hash_password, new_id
from app.db import Base, SessionLocal, engine

LEGACY_ORG_SLUG = "legacy"
LEGACY_USER_EMAIL = "legacy-system@reprocheck.local"

# 既有表 -> 新增可空列（列名, SQL 类型）
ADD_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "projects": [("owner_user_id", "VARCHAR(36)"), ("org_id", "VARCHAR(36)"), ("workspace_id", "VARCHAR(36)")],
    "reproduction_runs": [("requested_by_user_id", "VARCHAR(36)")],
    "remediation_reviews": [("reviewer_user_id", "VARCHAR(36)")],
}


def _backup_db() -> None:
    url = settings.database_url
    if "sqlite" not in url or ":memory:" in url:
        return
    path = url.split("///")[-1]
    src = Path(path)
    if src.exists():
        bak = src.with_suffix(src.suffix + ".pre_stage6.bak")
        if not bak.exists():
            shutil.copy2(src, bak)


def _add_columns(conn) -> None:
    insp = inspect(conn)
    existing_tables = set(insp.get_table_names())
    for table, cols in ADD_COLUMNS.items():
        if table not in existing_tables:
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        for name, sqltype in cols:
            if name not in have:
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {name} {sqltype}'))


async def _seed_rbac(db) -> None:
    from app.models.stage6 import Permission, Role, RolePermission

    perm_ids: dict[str, str] = {}
    for key, (_scope, desc) in PERMISSIONS.items():
        row = (await db.execute(select(Permission).where(Permission.key == key))).scalar_one_or_none()
        if not row:
            row = Permission(id=new_id("perm"), key=key, description=desc)
            db.add(row)
            await db.flush()
        perm_ids[key] = row.id

    for role_key, (name, scope, desc, perms) in ROLES.items():
        role = (await db.execute(select(Role).where(Role.key == role_key))).scalar_one_or_none()
        if not role:
            role = Role(id=new_id("role"), key=role_key, name=name, scope=scope, description=desc, is_system=True)
            db.add(role)
            await db.flush()
        existing = (await db.execute(select(RolePermission).where(RolePermission.role_id == role.id))).scalars().all()
        have_perm = {rp.permission_id for rp in existing}
        for pkey in perms:
            pid = perm_ids[pkey]
            if pid not in have_perm:
                db.add(RolePermission(id=new_id("rp"), role_id=role.id, permission_id=pid))
    await db.commit()


async def _default_org_and_backfill(db) -> None:
    from app.models import Project
    from app.models.stage6 import OrgMember, Organization, User

    org = (await db.execute(select(Organization).where(Organization.slug == LEGACY_ORG_SLUG))).scalar_one_or_none()
    legacy_user = (await db.execute(select(User).where(User.email == LEGACY_USER_EMAIL))).scalar_one_or_none()
    if not legacy_user:
        legacy_user = User(id=new_id("user"), email=LEGACY_USER_EMAIL,
                           password_hash=hash_password(new_id("unusable")),
                           display_name="遗留系统账户", is_active=False, is_platform_admin=True)
        db.add(legacy_user)
        await db.flush()
    if not org:
        org = Organization(id=new_id("org"), name="默认组织（遗留）", slug=LEGACY_ORG_SLUG,
                           description="第六阶段迁移自动创建，承载此前无归属的项目。",
                           owner_user_id=legacy_user.id)
        db.add(org)
        await db.flush()
        db.add(OrgMember(id=new_id("om"), org_id=org.id, user_id=legacy_user.id, role_key="org_admin"))

    # 回填遗留项目归属
    projects = (await db.execute(select(Project).where(Project.org_id.is_(None)))).scalars().all()
    for p in projects:
        p.org_id = org.id
        if not p.owner_user_id:
            p.owner_user_id = legacy_user.id
    await db.commit()

    # 可选：从 env 创建首个平台管理员
    if settings.bootstrap_admin_email and settings.bootstrap_admin_password:
        exists = (await db.execute(select(User).where(User.email == settings.bootstrap_admin_email))).scalar_one_or_none()
        if not exists:
            admin = User(id=new_id("user"), email=settings.bootstrap_admin_email,
                         password_hash=hash_password(settings.bootstrap_admin_password),
                         display_name="平台管理员", is_active=True, is_platform_admin=True)
            db.add(admin)
            await db.flush()
            db.add(OrgMember(id=new_id("om"), org_id=org.id, user_id=admin.id, role_key="org_admin"))
            await db.commit()


async def migrate_stage6() -> None:
    import app.models  # noqa: F401
    import app.models.stage2  # noqa: F401
    import app.models.stage4  # noqa: F401
    import app.models.stage6  # noqa: F401

    _backup_db()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_columns)

    async with SessionLocal() as db:
        await _seed_rbac(db)
        await _default_org_and_backfill(db)


if __name__ == "__main__":
    import asyncio

    asyncio.run(migrate_stage6())
    print("stage6 migration complete")