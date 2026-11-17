"""初始迁移：由 init_db() 自动建表生成，此处作为基线占位。

运行方式：
  alembic revision --autogenerate -m "initial"
  alembic upgrade head
第一阶段默认由应用 startup 阶段的 init_db() 建表，迁移脚本保留给生产环境。
"""
from alembic import op  # noqa: F401

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # 表结构由 Base.metadata.create_all 定义；生产环境可用 autogenerate 生成
    pass


def downgrade():
    pass
