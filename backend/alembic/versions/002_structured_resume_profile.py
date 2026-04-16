"""structured resume profile

Revision ID: 002_structured_resume_profile
Revises: 001_init
Create Date: 2026-04-15

"""

from typing import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_structured_resume_profile"
down_revision: str | None = "001_init"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE candidate ADD COLUMN IF NOT EXISTS structured_profile JSONB")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS skill (
            id          BIGSERIAL PRIMARY KEY,
            name        VARCHAR(255) NOT NULL UNIQUE,
            created_at  TIMESTAMP DEFAULT NOW()
        )
        """
    )

    # Ensure table shape is consistent even if a previous migration attempt created an older variant.
    op.execute("DROP TABLE IF EXISTS candidate_skill")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS candidate_skill (
            id            BIGSERIAL PRIMARY KEY,
            candidate_id  BIGINT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
            skill_id      BIGINT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
            context       VARCHAR(20) NOT NULL DEFAULT 'mentioned',
            experience_months INTEGER,
            created_at    TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_candidate_skill UNIQUE (candidate_id, skill_id),
            CONSTRAINT ck_candidate_skill_context CHECK (
                context IN ('primary', 'secondary', 'project', 'mentioned')
            )
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS candidate_experience (
            id            BIGSERIAL PRIMARY KEY,
            candidate_id  BIGINT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
            role          VARCHAR(255) NOT NULL,
            company       VARCHAR(255),
            start_date    VARCHAR(50),
            end_date      VARCHAR(50),
            skills_used   TEXT[],
            sort_order    INTEGER NOT NULL DEFAULT 0,
            created_at    TIMESTAMP DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS candidate_project (
            id            BIGSERIAL PRIMARY KEY,
            candidate_id  BIGINT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
            name          VARCHAR(255) NOT NULL,
            description   TEXT,
            skills_used   TEXT[],
            sort_order    INTEGER NOT NULL DEFAULT 0,
            created_at    TIMESTAMP DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS candidate_education (
            id              BIGSERIAL PRIMARY KEY,
            candidate_id    BIGINT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
            institute       VARCHAR(255) NOT NULL,
            degree_name     VARCHAR(255) NOT NULL,
            branch_name     VARCHAR(255),
            start_date      VARCHAR(50),
            end_date        VARCHAR(50),
            year_of_passing INTEGER,
            gpa             DECIMAL(5,2),
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS requirement_skill (
            id                    BIGSERIAL PRIMARY KEY,
            requirement_id        BIGINT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
            skill_id              BIGINT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
            min_experience_months INTEGER,
            created_at            TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_requirement_skill UNIQUE (requirement_id, skill_id)
        )
        """
    )

    op.execute(
        """
        INSERT INTO skill(name)
        SELECT DISTINCT LOWER(BTRIM(raw_skill))
        FROM (
            SELECT UNNEST(COALESCE(c.skills, ARRAY[]::text[])) AS raw_skill
            FROM candidate c
            UNION ALL
            SELECT UNNEST(COALESCE(r.required_skills, ARRAY[]::text[])) AS raw_skill
            FROM requirement r
        ) all_skills
        WHERE raw_skill IS NOT NULL AND BTRIM(raw_skill) <> ''
        ON CONFLICT (name) DO NOTHING
        """
    )

    op.execute(
        """
        INSERT INTO candidate_skill(candidate_id, skill_id, context)
        SELECT DISTINCT c.id, s.id, 'mentioned'
        FROM candidate c
        CROSS JOIN LATERAL UNNEST(COALESCE(c.skills, ARRAY[]::text[])) AS raw_skill
        JOIN skill s ON s.name = LOWER(BTRIM(raw_skill))
        ON CONFLICT (candidate_id, skill_id) DO NOTHING
        """
    )

    op.execute(
        """
        INSERT INTO requirement_skill(requirement_id, skill_id, min_experience_months)
        SELECT DISTINCT r.id, s.id, NULL::INTEGER
        FROM requirement r
        CROSS JOIN LATERAL UNNEST(COALESCE(r.required_skills, ARRAY[]::text[])) AS raw_skill
        JOIN skill s ON s.name = LOWER(BTRIM(raw_skill))
        ON CONFLICT (requirement_id, skill_id) DO NOTHING
        """
    )

    op.execute("DROP INDEX IF EXISTS idx_candidate_fts")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_candidate_fts ON candidate
        USING gin (to_tsvector('english', COALESCE(summary_text, '')))
        """
    )

    op.execute("ALTER TABLE candidate DROP COLUMN IF EXISTS skills")
    op.execute("ALTER TABLE requirement DROP COLUMN IF EXISTS required_skills")

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_candidate_skill_candidate ON candidate_skill(candidate_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_candidate_skill_skill ON candidate_skill(skill_id)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_skill_name_lower ON skill((LOWER(name)))")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_candidate_experience_candidate ON candidate_experience(candidate_id, sort_order)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_candidate_project_candidate ON candidate_project(candidate_id, sort_order)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_candidate_education_candidate ON candidate_education(candidate_id, sort_order)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_requirement_skill_requirement ON requirement_skill(requirement_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_requirement_skill_skill ON requirement_skill(skill_id)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE candidate ADD COLUMN IF NOT EXISTS skills TEXT[]")
    op.execute("ALTER TABLE requirement ADD COLUMN IF NOT EXISTS required_skills TEXT[]")

    op.execute(
        """
        UPDATE candidate c
        SET skills = sub.skills
        FROM (
            SELECT cs.candidate_id,
                   ARRAY_AGG(s.name ORDER BY s.name) AS skills
            FROM candidate_skill cs
            JOIN skill s ON s.id = cs.skill_id
            GROUP BY cs.candidate_id
        ) sub
        WHERE c.id = sub.candidate_id
        """
    )

    op.execute(
        """
        UPDATE requirement r
        SET required_skills = sub.skills
        FROM (
            SELECT rs.requirement_id,
                   ARRAY_AGG(s.name ORDER BY s.name) AS skills
            FROM requirement_skill rs
            JOIN skill s ON s.id = rs.skill_id
            GROUP BY rs.requirement_id
        ) sub
        WHERE r.id = sub.requirement_id
        """
    )

    op.execute("DROP INDEX IF EXISTS idx_requirement_skill_skill")
    op.execute("DROP INDEX IF EXISTS idx_requirement_skill_requirement")
    op.execute("DROP INDEX IF EXISTS idx_candidate_education_candidate")
    op.execute("DROP INDEX IF EXISTS idx_candidate_project_candidate")
    op.execute("DROP INDEX IF EXISTS idx_candidate_experience_candidate")
    op.execute("DROP INDEX IF EXISTS idx_skill_name_lower")
    op.execute("DROP INDEX IF EXISTS idx_candidate_skill_skill")
    op.execute("DROP INDEX IF EXISTS idx_candidate_skill_candidate")

    op.execute("DROP TABLE IF EXISTS requirement_skill")
    op.execute("DROP TABLE IF EXISTS candidate_education")
    op.execute("DROP TABLE IF EXISTS candidate_project")
    op.execute("DROP TABLE IF EXISTS candidate_experience")
    op.execute("DROP TABLE IF EXISTS candidate_skill")
    op.execute("DROP TABLE IF EXISTS skill")

    op.execute("ALTER TABLE candidate DROP COLUMN IF EXISTS structured_profile")
