"""数据库引擎与会话（SQLite 起步，可平滑迁移 PostgreSQL）。"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    """建表 + 第二阶段幂等迁移。

    同时覆盖两种形态：
    - 空库：create_all 直接建全部表（含第二阶段新表与扩展列）；
    - 已有第一阶段库：create_all 跳过已存在的表，再由 migrate_stage2 幂等补列。
    """
    # 确保第二阶段模型已注册到 metadata
    import app.models  # noqa: F401
    import app.models.stage2  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    from app.db.migrate import migrate_stage2
    await migrate_stage2()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
