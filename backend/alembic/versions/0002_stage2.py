"""第二阶段数据库迁移：扩展第一阶段表 + 新增四张表。

revision: 0002_stage2
down_revision: 0001_initial

设计：调用 app.db.migrate.migrate_stage2 的幂等逻辑（Inspector 检测后补列/补索引），
新表由 metadata.create_all 建立。旧数据一律保留，不删除、不重建。

运行：
  cd backend
  alembic upgrade head
或应用启动时 init_db() 自动执行等价迁移。

注意：第一阶段 0001 为占位脚本（pass），无 alembic_version 记录；
本迁移不依赖 0001 的实际执行，可直接在已有第一阶段库上空跑。
"""
from alembic import op  # noqa: F401
import asyncio

revision = "0002_stage2"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    from app.db.migrate import migrate_stage2
    result = asyncio.run(migrate_stage2())
    # 新表由 create_all 建立；alembic 环境下显式建一次确保脱离应用也能迁移
    from app.core.config import settings
    from app.db import Base
    import app.models  # noqa: F401
    import app.models.stage2  # noqa: F401
    from sqlalchemy import create_engine
    sync_engine = create_engine(settings.sync_database_url)
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()
    print("stage2 migration:", result)


def downgrade():
    # 第二阶段为追加式变更，降级仅删除新增表；扩展列保留以免破坏数据。
    op.drop_table("fact_revisions", checkfirst=True)
    op.drop_table("evidence_items", checkfirst=True)
    op.drop_table("parse_tasks", checkfirst=True)
    op.drop_table("material_parse_runs", checkfirst=True)
