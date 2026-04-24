"""add users and refresh tokens

Revision ID: 007_add_user_and_refresh_token
Revises: 006_requirement_qualification
Create Date: 2026-04-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "007_add_user_and_refresh_token"
down_revision: Union[str, None] = "006_requirement_qualification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_user",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False, unique=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(), server_default=sa.text("now()")),
    )

    op.create_table(
        "refresh_token",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("app_user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()")),
    )

    op.create_index("ix_refresh_token_token_hash", "refresh_token", ["token_hash"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_refresh_token_token_hash", table_name="refresh_token")
    op.drop_table("refresh_token")
    op.drop_table("app_user")
