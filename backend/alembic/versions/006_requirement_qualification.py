"""add qualification field to requirement

Revision ID: 006_requirement_qualification
Revises: 005_candidate_status_enum_type
Create Date: 2026-04-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "006_requirement_qualification"
down_revision: Union[str, None] = "005_candidate_status_enum_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requirement", sa.Column("qualification", sa.Text(), nullable=True))



def downgrade() -> None:
    op.drop_column("requirement", "qualification")
