"""数据库引擎与会话（SQLite 起步，可平滑迁移 PostgreSQL）。"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import event
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

if engine.dialect.name == "sqlite":
    @event.listens_for(engine.sync_engine, "connect")
    def _configure_sqlite(connection, _record) -> None:
        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout=15000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
        finally:
            cursor.close()


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    """建表 + 第二阶段幂等迁移。

    同时覆盖两种形态：
    - 空库：create_all 直接建全部表（含第二阶段新表与扩展列）；
    - 已有第一阶段库：create_all 跳过已存在的表，再由 migrate_stage2 幂等补列。
    """
    # 确保各阶段模型已注册到 metadata
    import app.models  # noqa: F401
    import app.models.stage2  # noqa: F401
    import app.models.stage4  # noqa: F401
    import app.models.stage6  # noqa: F401
    import app.models.stage7  # noqa: F401 - 第七阶段工作流升级（编排/补证/恢复）
    import app.models.modelhub  # noqa: F401 - 第十一阶段模型中心 7 表
    import app.models.stage12  # noqa: F401 - 第十二阶段生命周期/知识库/交接/工作项
    import app.models.data_audit  # noqa: F401 - 数据质量审计运行记录

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    from app.db.migrate import migrate_stage2
    await migrate_stage2(engine)

    from app.db.migrate_stage6 import migrate_stage6
    await migrate_stage6()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
