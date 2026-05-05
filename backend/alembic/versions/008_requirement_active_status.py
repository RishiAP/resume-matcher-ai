"""add requirement active status

Revision ID: 008_requirement_active_status
Revises: 007_add_user_and_refresh_token
Create Date: 2026-05-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "008_requirement_active_status"
down_revision: Union[str, None] = "007_add_user_and_refresh_token"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "requirement",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("requirement", "is_active")
