"""candidate status scoped to requirement

Revision ID: 004_candidate_status_scope
Revises: 003_hr_comment_dates
Create Date: 2026-04-15

"""

from typing import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_candidate_status_scope"
down_revision: str | None = "003_hr_comment_dates"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS candidate_status (
            id              BIGSERIAL PRIMARY KEY,
            candidate_id    BIGINT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
            requirement_id  BIGINT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
            status          VARCHAR(20) NOT NULL,
            created_at      TIMESTAMP DEFAULT NOW(),
            updated_at      TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_candidate_requirement_status UNIQUE (candidate_id, requirement_id),
            CONSTRAINT ck_candidate_status_value CHECK (status IN ('processing', 'rejected', 'hired'))
        )
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_candidate_status_requirement
        ON candidate_status(requirement_id)
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_candidate_status_candidate
        ON candidate_status(candidate_id)
        """
    )

    op.execute("ALTER TABLE candidate DROP COLUMN IF EXISTS status")


def downgrade() -> None:
    op.execute("ALTER TABLE candidate ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'new'")

    op.execute(
        """
        UPDATE candidate c
        SET status = latest.status
        FROM (
            SELECT DISTINCT ON (candidate_id)
                candidate_id,
                status
            FROM candidate_status
            ORDER BY candidate_id, updated_at DESC, id DESC
        ) latest
        WHERE c.id = latest.candidate_id
        """
    )

    op.execute("DROP INDEX IF EXISTS idx_candidate_status_candidate")
    op.execute("DROP INDEX IF EXISTS idx_candidate_status_requirement")
    op.execute("DROP TABLE IF EXISTS candidate_status")
