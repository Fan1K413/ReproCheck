"""Add project paper-audit history and AgentArts check receipts."""
from alembic import op

from app.models.agentarts import PaperAuditCheck, PaperAuditRun

revision = "0003_agentarts_paper_audit"
down_revision = "0002_stage2"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    PaperAuditRun.__table__.create(bind, checkfirst=True)
    PaperAuditCheck.__table__.create(bind, checkfirst=True)


def downgrade():
    bind = op.get_bind()
    PaperAuditCheck.__table__.drop(bind, checkfirst=True)
    PaperAuditRun.__table__.drop(bind, checkfirst=True)
