"""initial schema

Revision ID: 001_init
Revises:
Create Date: 2026-04-12

"""

from typing import Sequence

from alembic import op

from app.config import get_settings

# revision identifiers, used by Alembic.
revision: str = "001_init"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    embed_dimensions = get_settings().resolved_embed_dimensions

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.execute(
        f"""
        CREATE TABLE candidate (
            id                BIGSERIAL PRIMARY KEY,
            name              VARCHAR(255),
            email             VARCHAR(255),
            phone             VARCHAR(50),
            location          VARCHAR(255),
            current_company   VARCHAR(255),
            experience_years  INTEGER,
            skills            TEXT[],
            highest_degree    VARCHAR(255),
            year_of_passing   INTEGER,
            gpa               DECIMAL(4,2),
            resume_url        VARCHAR(500),
            summary_text      TEXT,
            embedding         vector({embed_dimensions}),
            hr_comments       TEXT,
            interview_date    DATE,
            interview_time    VARCHAR(10),
            status            VARCHAR(50) DEFAULT 'new',
            created_at        TIMESTAMP DEFAULT NOW(),
            updated_at        TIMESTAMP DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE INDEX idx_candidate_fts ON candidate
        USING gin (
            (
                array_to_tsvector(COALESCE(skills, ARRAY[]::text[])) ||
                to_tsvector('english', COALESCE(summary_text, ''))
            )
        )
        """
    )

    op.execute(
        """
        CREATE INDEX idx_candidate_embedding ON candidate
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
        """
    )

    op.execute(
        f"""
        CREATE TABLE requirement (
            id               BIGSERIAL PRIMARY KEY,
            title            VARCHAR(255) NOT NULL,
            required_skills  TEXT[],
            min_experience   INTEGER,
            max_experience   INTEGER,
            location         VARCHAR(255),
            min_ctc          DECIMAL(12,2),
            max_ctc          DECIMAL(12,2),
            notes            TEXT,
            summary_text     TEXT,
            embedding        vector({embed_dimensions}),
            created_at       TIMESTAMP DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE match_result (
            id              BIGSERIAL PRIMARY KEY,
            requirement_id  BIGINT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
            candidate_id    BIGINT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
            score           DECIMAL(5,2),
            reason          TEXT,
            rrf_score       DECIMAL(10,6),
            created_at      TIMESTAMP DEFAULT NOW(),
            UNIQUE (requirement_id, candidate_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS match_result")
    op.execute("DROP TABLE IF EXISTS requirement")
    op.execute("DROP TABLE IF EXISTS candidate")
