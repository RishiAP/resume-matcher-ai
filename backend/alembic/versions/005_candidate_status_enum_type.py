"""use postgres enum type for candidate_status.status

Revision ID: 005_candidate_status_enum_type
Revises: 004_candidate_status_scope
Create Date: 2026-04-15

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "005_candidate_status_enum_type"
down_revision: Union[str, None] = "004_candidate_status_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old CHECK constraint if present; the enum enforces allowed values
    op.execute(
        """
        ALTER TABLE candidate_status
        DROP CONSTRAINT IF EXISTS ck_candidate_status_value
        """
    )

    # Create the enum type if it does not already exist
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'candidate_status_enum') THEN
                CREATE TYPE candidate_status_enum AS ENUM ('new', 'processing', 'rejected', 'hired');
            END IF;
        END
        $$;
        """
    )

    # Change the column to use the enum type
    op.execute(
        """
        ALTER TABLE candidate_status
        ALTER COLUMN status TYPE candidate_status_enum
        USING status::candidate_status_enum;
        """
    )


def downgrade() -> None:
    # Revert the column back to VARCHAR and recreate the CHECK constraint
    op.execute(
        """
        ALTER TABLE candidate_status
        ALTER COLUMN status TYPE VARCHAR(20)
        USING status::text;
        """
    )

    op.execute(
        """
        ALTER TABLE candidate_status
        ADD CONSTRAINT ck_candidate_status_value
        CHECK (status IN ('new', 'processing', 'rejected', 'hired'))
        """
    )

    # Optionally drop the enum type (safe if nothing else uses it)
    op.execute("DROP TYPE IF EXISTS candidate_status_enum")
