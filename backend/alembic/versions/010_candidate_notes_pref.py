"""Add candidate notes and skill preference

Revision ID: 010_candidate_notes_pref
Revises: 009_create_interview_table
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "010_candidate_notes_pref"
down_revision: Union[str, None] = "009_create_interview_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the skill_preference ENUM type using DO block to avoid errors if it exists
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'skill_preference') THEN
                CREATE TYPE skill_preference AS ENUM ('preferred', 'non_preferred', 'unknown');
            END IF;
        END
        $$;
        """
    )

    # Add notes column to candidate table
    op.add_column("candidate", sa.Column("notes", sa.Text(), nullable=True))

    # Add preference column to candidate_skill table
    op.add_column(
        "candidate_skill",
        sa.Column(
            "preference",
            sa.Enum(
                "preferred",
                "non_preferred",
                "unknown",
                name="skill_preference",
                create_type=False,
            ),
            nullable=False,
            server_default="unknown",
        ),
    )

    # Backfill existing rows (server_default handles new inserts automatically)
    op.execute("UPDATE candidate_skill SET preference = 'unknown'")


def downgrade() -> None:
    # Drop preference column from candidate_skill table first
    op.drop_column("candidate_skill", "preference")
    
    # Drop notes column from candidate table
    op.drop_column("candidate", "notes")
    
    # Drop the skill_preference enum type with CASCADE in case of dependencies
    op.execute("DROP TYPE IF EXISTS skill_preference CASCADE")
