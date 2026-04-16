"""hr comment history and structured timeline dates

Revision ID: 003_hr_comment_dates
Revises: 002_structured_resume_profile
Create Date: 2026-04-16

"""

from typing import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003_hr_comment_dates"
down_revision: str | None = "002_structured_resume_profile"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS hr_comment (
            id            BIGSERIAL PRIMARY KEY,
            candidate_id  BIGINT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
            comment       TEXT NOT NULL,
            created_at    TIMESTAMP DEFAULT NOW(),
            updated_at    TIMESTAMP DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_hr_comment_candidate_created_at
        ON hr_comment(candidate_id, created_at DESC)
        """
    )

    op.execute(
        """
        INSERT INTO hr_comment(candidate_id, comment, created_at, updated_at)
        SELECT c.id, c.hr_comments, NOW(), NOW()
        FROM candidate c
        WHERE c.hr_comments IS NOT NULL
          AND BTRIM(c.hr_comments) <> ''
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION parse_resume_date_text(input_text TEXT)
        RETURNS DATE
        LANGUAGE plpgsql
        AS $$
        DECLARE
            cleaned TEXT;
            result DATE;
        BEGIN
            IF input_text IS NULL OR BTRIM(input_text) = '' THEN
                RETURN NULL;
            END IF;

            cleaned := LOWER(REGEXP_REPLACE(input_text, '\\s+', ' ', 'g'));
            cleaned := BTRIM(cleaned);

            IF cleaned IN ('present', 'current', 'now', 'ongoing', 'till date', 'to date', 'today') THEN
                RETURN DATE_TRUNC('month', CURRENT_DATE)::DATE;
            END IF;

            cleaned := REPLACE(REPLACE(REPLACE(input_text, '.', ' '), ',', ' '), '|', ' ');
            cleaned := BTRIM(REGEXP_REPLACE(cleaned, '\\s+', ' ', 'g'));

            BEGIN
                result := TO_DATE(cleaned, 'Mon YYYY');
                RETURN DATE_TRUNC('month', result)::DATE;
            EXCEPTION WHEN OTHERS THEN
            END;

            BEGIN
                result := TO_DATE(cleaned, 'Month YYYY');
                RETURN DATE_TRUNC('month', result)::DATE;
            EXCEPTION WHEN OTHERS THEN
            END;

            BEGIN
                result := TO_DATE(cleaned, 'MM/YYYY');
                RETURN DATE_TRUNC('month', result)::DATE;
            EXCEPTION WHEN OTHERS THEN
            END;

            BEGIN
                result := TO_DATE(cleaned, 'MM-YYYY');
                RETURN DATE_TRUNC('month', result)::DATE;
            EXCEPTION WHEN OTHERS THEN
            END;

            BEGIN
                result := TO_DATE(cleaned, 'YYYY/MM');
                RETURN DATE_TRUNC('month', result)::DATE;
            EXCEPTION WHEN OTHERS THEN
            END;

            BEGIN
                result := TO_DATE(cleaned, 'YYYY-MM');
                RETURN DATE_TRUNC('month', result)::DATE;
            EXCEPTION WHEN OTHERS THEN
            END;

            BEGIN
                result := TO_DATE(cleaned, 'YYYY');
                RETURN result;
            EXCEPTION WHEN OTHERS THEN
            END;

            RETURN NULL;
        END;
        $$
        """
    )

    op.execute(
        """
        ALTER TABLE candidate_experience
        ALTER COLUMN start_date TYPE DATE USING parse_resume_date_text(start_date::TEXT),
        ALTER COLUMN end_date TYPE DATE USING parse_resume_date_text(end_date::TEXT)
        """
    )

    op.execute(
        """
        ALTER TABLE candidate_education
        ALTER COLUMN start_date TYPE DATE USING parse_resume_date_text(start_date::TEXT),
        ALTER COLUMN end_date TYPE DATE USING parse_resume_date_text(end_date::TEXT)
        """
    )

    op.execute("ALTER TABLE candidate_project ADD COLUMN IF NOT EXISTS start_date DATE")
    op.execute("ALTER TABLE candidate_project ADD COLUMN IF NOT EXISTS end_date DATE")

    op.execute("DROP FUNCTION IF EXISTS parse_resume_date_text(TEXT)")
    op.execute("ALTER TABLE candidate DROP COLUMN IF EXISTS hr_comments")


def downgrade() -> None:
    op.execute("ALTER TABLE candidate ADD COLUMN IF NOT EXISTS hr_comments TEXT")

    op.execute(
        """
        UPDATE candidate c
        SET hr_comments = latest.comment
        FROM (
            SELECT DISTINCT ON (candidate_id)
                candidate_id,
                comment
            FROM hr_comment
            ORDER BY candidate_id, created_at DESC, id DESC
        ) latest
        WHERE c.id = latest.candidate_id
        """
    )

    op.execute(
        """
        ALTER TABLE candidate_experience
        ALTER COLUMN start_date TYPE VARCHAR(50)
            USING CASE WHEN start_date IS NULL THEN NULL ELSE TO_CHAR(start_date, 'YYYY-MM-DD') END,
        ALTER COLUMN end_date TYPE VARCHAR(50)
            USING CASE WHEN end_date IS NULL THEN NULL ELSE TO_CHAR(end_date, 'YYYY-MM-DD') END
        """
    )

    op.execute(
        """
        ALTER TABLE candidate_education
        ALTER COLUMN start_date TYPE VARCHAR(50)
            USING CASE WHEN start_date IS NULL THEN NULL ELSE TO_CHAR(start_date, 'YYYY-MM-DD') END,
        ALTER COLUMN end_date TYPE VARCHAR(50)
            USING CASE WHEN end_date IS NULL THEN NULL ELSE TO_CHAR(end_date, 'YYYY-MM-DD') END
        """
    )

    op.execute("ALTER TABLE candidate_project DROP COLUMN IF EXISTS start_date")
    op.execute("ALTER TABLE candidate_project DROP COLUMN IF EXISTS end_date")

    op.execute("DROP INDEX IF EXISTS idx_hr_comment_candidate_created_at")
    op.execute("DROP TABLE IF EXISTS hr_comment")
