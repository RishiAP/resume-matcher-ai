from enum import Enum as PyEnum

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    DECIMAL,
    BigInteger,
    Column,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    TIMESTAMP,
    UniqueConstraint,
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

from app.config import get_settings

settings = get_settings()
EMBED_DIMENSIONS = settings.resolved_embed_dimensions


class Base(DeclarativeBase):
    pass


class Candidate(Base):
    __tablename__ = "candidate"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(255))
    email = Column(String(255))
    phone = Column(String(50))
    location = Column(String(255))
    current_company = Column(String(255))
    experience_years = Column(Integer)
    highest_degree = Column(String(255))
    year_of_passing = Column(Integer)
    gpa = Column(DECIMAL(4, 2))
    resume_url = Column(String(500))

    summary_text = Column(Text)
    embedding = Column(Vector(EMBED_DIMENSIONS))
    structured_profile = Column(JSONB)

    interview_date = Column(Date)
    interview_time = Column(String(10))

    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    skill_links = relationship(
        "CandidateSkill",
        back_populates="candidate",
        cascade="all, delete-orphan",
    )
    experiences = relationship(
        "CandidateExperience",
        back_populates="candidate",
        cascade="all, delete-orphan",
    )
    projects = relationship(
        "CandidateProject",
        back_populates="candidate",
        cascade="all, delete-orphan",
    )
    educations = relationship(
        "CandidateEducation",
        back_populates="candidate",
        cascade="all, delete-orphan",
    )
    hr_comments = relationship(
        "HRComment",
        back_populates="candidate",
        cascade="all, delete-orphan",
    )


class HRComment(Base):
    __tablename__ = "hr_comment"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    candidate_id = Column(BigInteger, ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False)
    comment = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    candidate = relationship("Candidate", back_populates="hr_comments")


class Skill(Base):
    __tablename__ = "skill"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, unique=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    candidate_links = relationship("CandidateSkill", back_populates="skill")
    requirement_links = relationship("RequirementSkill", back_populates="skill")


class CandidateSkill(Base):
    __tablename__ = "candidate_skill"
    __table_args__ = (
        UniqueConstraint("candidate_id", "skill_id", name="uq_candidate_skill"),
        CheckConstraint(
            "context IN ('primary', 'secondary', 'project', 'mentioned')",
            name="ck_candidate_skill_context",
        ),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    candidate_id = Column(BigInteger, ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False)
    skill_id = Column(BigInteger, ForeignKey("skill.id", ondelete="CASCADE"), nullable=False)
    context = Column(String(20), nullable=False, server_default="mentioned")
    experience_months = Column(Integer)
    created_at = Column(TIMESTAMP, server_default=func.now())

    candidate = relationship("Candidate", back_populates="skill_links")
    skill = relationship("Skill", back_populates="candidate_links")


class CandidateExperience(Base):
    __tablename__ = "candidate_experience"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    candidate_id = Column(BigInteger, ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(255), nullable=False)
    company = Column(String(255))
    start_date = Column(Date)
    end_date = Column(Date)
    skills_used = Column(ARRAY(Text))
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

    candidate = relationship("Candidate", back_populates="experiences")


class CandidateProject(Base):
    __tablename__ = "candidate_project"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    candidate_id = Column(BigInteger, ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    start_date = Column(Date)
    end_date = Column(Date)
    skills_used = Column(ARRAY(Text))
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

    candidate = relationship("Candidate", back_populates="projects")


class CandidateEducation(Base):
    __tablename__ = "candidate_education"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    candidate_id = Column(BigInteger, ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False)
    institute = Column(String(255), nullable=False)
    degree_name = Column(String(255), nullable=False)
    branch_name = Column(String(255))
    start_date = Column(Date)
    end_date = Column(Date)
    year_of_passing = Column(Integer)
    gpa = Column(DECIMAL(5, 2))
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

    candidate = relationship("Candidate", back_populates="educations")


class Requirement(Base):
    __tablename__ = "requirement"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    title = Column(String(255), nullable=False)
    min_experience = Column(Integer)
    max_experience = Column(Integer)
    location = Column(String(255))
    min_ctc = Column(DECIMAL(12, 2))
    max_ctc = Column(DECIMAL(12, 2))
    qualification = Column(Text)
    notes = Column(Text)
    summary_text = Column(Text)
    embedding = Column(Vector(EMBED_DIMENSIONS))
    created_at = Column(TIMESTAMP, server_default=func.now())

    skill_requirements = relationship(
        "RequirementSkill",
        back_populates="requirement",
        cascade="all, delete-orphan",
    )


class RequirementSkill(Base):
    __tablename__ = "requirement_skill"
    __table_args__ = (
        UniqueConstraint("requirement_id", "skill_id", name="uq_requirement_skill"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    requirement_id = Column(
        BigInteger,
        ForeignKey("requirement.id", ondelete="CASCADE"),
        nullable=False,
    )
    skill_id = Column(BigInteger, ForeignKey("skill.id", ondelete="CASCADE"), nullable=False)
    min_experience_months = Column(Integer)
    created_at = Column(TIMESTAMP, server_default=func.now())

    requirement = relationship("Requirement", back_populates="skill_requirements")
    skill = relationship("Skill", back_populates="requirement_links")


class MatchResult(Base):
    __tablename__ = "match_result"
    __table_args__ = (UniqueConstraint("requirement_id", "candidate_id", name="uq_req_candidate"),)

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    requirement_id = Column(BigInteger, ForeignKey("requirement.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(BigInteger, ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False)
    score = Column(DECIMAL(5, 2))
    reason = Column(Text)
    rrf_score = Column(DECIMAL(10, 6))
    created_at = Column(TIMESTAMP, server_default=func.now())


class CandidateStatusEnum(str, PyEnum):
    NEW = "new"
    PROCESSING = "processing"
    REJECTED = "rejected"
    HIRED = "hired"


class CandidateStatus(Base):
    __tablename__ = "candidate_status"
    __table_args__ = (
        UniqueConstraint("candidate_id", "requirement_id", name="uq_candidate_requirement_status"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    candidate_id = Column(BigInteger, ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False)
    requirement_id = Column(BigInteger, ForeignKey("requirement.id", ondelete="CASCADE"), nullable=False)
    status = Column(
        SAEnum(
            CandidateStatusEnum,
            name="candidate_status_enum",
            create_type=False,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        nullable=False,
    )
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
