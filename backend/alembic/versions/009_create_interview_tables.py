"""create interview table

Revision ID: 009_create_interview_table
Revises: 008_requirement_active_status
Create Date: 2026-05-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "009_create_interview_table"
down_revision: Union[str, None] = "008_requirement_active_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create interview table
    op.create_table(
        "interview",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("candidate_id", sa.BigInteger(), sa.ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False),
        sa.Column("interview_date", sa.Date(), nullable=True),
        sa.Column("interview_time", sa.String(length=10), nullable=True),
        sa.Column("round", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(), server_default=sa.text("now()")),
    )
    # Migrate existing hr_comment rows to individual interview rows.
    # Create one interview row per hr_comment so each interview holds a single comment.
    op.execute(
        """
        INSERT INTO interview (candidate_id, interview_date, interview_time, round, comment, created_at, updated_at)
        SELECT
          h.candidate_id,
          c.interview_date,
          c.interview_time,
          ROW_NUMBER() OVER (PARTITION BY h.candidate_id ORDER BY h.created_at ASC) as rn,
          h.comment,
          h.created_at,
          h.updated_at
        FROM hr_comment h
        JOIN candidate c ON c.id = h.candidate_id
        """
    )

    # For any candidate that had interview_date/time set but no existing hr_comment,
    # create a single interview row (comment NULL).
    op.execute(
        """
        INSERT INTO interview (candidate_id, interview_date, interview_time, round, created_at, updated_at)
        SELECT c.id, c.interview_date, c.interview_time, 1, now(), now()
        FROM candidate c
        WHERE (c.interview_date IS NOT NULL OR c.interview_time IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM hr_comment h WHERE h.candidate_id = c.id)
        """
    )

    # Drop legacy hr_comment table and candidate interview_date/time columns
    op.drop_table("hr_comment")
    with op.batch_alter_table("candidate") as batch_op:
        batch_op.drop_column("interview_date")
        batch_op.drop_column("interview_time")


def downgrade() -> None:
    # Recreate candidate interview columns and hr_comment table and migrate back
    op.add_column("candidate", sa.Column("interview_time", sa.String(length=10), nullable=True))
    op.add_column("candidate", sa.Column("interview_date", sa.Date(), nullable=True))

    op.create_table(
        "hr_comment",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("candidate_id", sa.BigInteger(), sa.ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(), server_default=sa.text("now()")),
    )

    # Migrate interviews back into hr_comment rows (one hr_comment per interview with comment)
    op.execute(
        """
        INSERT INTO hr_comment (candidate_id, comment, created_at, updated_at)
        SELECT candidate_id, comment, created_at, updated_at
        FROM interview
        WHERE comment IS NOT NULL
        """
    )

    # Drop interview table
    op.drop_table("interview")