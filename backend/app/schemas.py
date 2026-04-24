from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator, model_validator


def _normalize_skill_list(value: object) -> list[str]:
    if value is None:
        return []

    parts: list[str] = []
    if isinstance(value, str):
        parts = value.split(",")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                parts.extend(item.split(","))
            elif item is not None:
                parts.extend(str(item).split(","))
    else:
        parts = str(value).split(",")

    deduped: list[str] = []
    seen: set[str] = set()
    for part in parts:
        normalized = part.strip().lower()
        if normalized and normalized not in seen:
            seen.add(normalized)
            deduped.append(normalized)

    return deduped


class UploadJobQueued(BaseModel):
    job_id: str
    status: str
    source: str | None = None
    batch_id: str | None = None


class UploadJobStatus(BaseModel):
    status: str
    candidate_id: int | None = None
    error: str | None = None
    source: str | None = None
    source_url: str | None = None
    batch_id: str | None = None
    stage: str | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class BulkUploadQueued(BaseModel):
    batch_id: str
    total: int
    jobs: list[UploadJobQueued] = Field(default_factory=list)


class JobQueueOverview(BaseModel):
    total: int
    queued: int
    processing: int
    completed: int
    failed: int
    jobs: list[UploadJobStatus] = Field(default_factory=list)


class BatchUploadStatus(BaseModel):
    batch_id: str
    total: int
    queued: int
    processing: int
    completed: int
    failed: int
    created_candidate_ids: list[int] = Field(default_factory=list)
    remaining_jobs: list[UploadJobStatus] = Field(default_factory=list)
    jobs: list[UploadJobStatus] = Field(default_factory=list)


class ResumeUrlUploadRequest(BaseModel):
    url: AnyHttpUrl
    requirement_id: int | None = None


class ResumeBulkUrlUploadRequest(BaseModel):
    urls: list[AnyHttpUrl] = Field(min_length=1)
    requirement_id: int | None = None


class UploadEnqueueResponse(BaseModel):
    status: Literal["queued"]
    accepted: int


class BulkUploadEnqueueResponse(BaseModel):
    status: Literal["queued"]
    accepted: int
    rejected: int
    errors: list[str] = Field(default_factory=list)


class QueueJobsStatus(BaseModel):
    running: int
    queued: int
    workers_online: int


class ErrorResponse(BaseModel):
    detail: str


class UserCreate(BaseModel):
    username: str
    email: str
    password: str


class UserRead(BaseModel):
    id: int
    username: str | None = None
    email: str
    is_active: bool | None = True


class LoginRequest(BaseModel):
    identifier: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    ai_mode: str
    provider: str
    llm_model: str
    embed_mode: str
    embed_provider: str
    embed_model: str
    embed_dimensions: int


class CandidateSkillRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    context: Literal["primary", "secondary", "project", "mentioned"]
    experience_months: int | None = None
    experience_years: float | None = None


class HRCommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    comment: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class HRCommentWrite(BaseModel):
    comment: str = Field(min_length=1, max_length=1500)

    @field_validator("comment")
    @classmethod
    def normalize_comment(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Comment cannot be empty")
        return cleaned


class CandidateExperienceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    role: str
    company: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    skills_used: list[str] = Field(default_factory=list)


class CandidateProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    skills_used: list[str] = Field(default_factory=list)


class CandidateEducationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    institute: str
    degree_name: str
    branch_name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    year_of_passing: int | None = None
    gpa: float | None = None


class CandidateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    current_company: str | None = None
    experience_years: int | None = None
    skills: list[str] = Field(default_factory=list)
    highest_degree: str | None = None
    year_of_passing: int | None = None
    gpa: float | None = None
    resume_url: str | None = None
    hr_comments: list[HRCommentRead] = Field(default_factory=list)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    # Per-requirement status when `requirement_id` is passed to the list endpoint.
    # - `null` when no requirement_id was requested
    # - `"not_applied"` when the candidate has no CandidateStatus for the requirement
    requirement_status: Literal["not_applied", "new", "processing", "rejected", "hired"] | None = None
    interview_date: date | None = None
    interview_time: str | None = None
    created_at: datetime | None = None
    structured_profile: dict | None = None
    skill_profiles: list[CandidateSkillRead] = Field(default_factory=list)
    experiences: list[CandidateExperienceRead] = Field(default_factory=list)
    projects: list[CandidateProjectRead] = Field(default_factory=list)
    educations: list[CandidateEducationRead] = Field(default_factory=list)


class CandidateUpdate(BaseModel):
    interview_date: date | None = None
    interview_time: str | None = None


class RequirementSkillInput(BaseModel):
    name: str
    min_experience_years: float | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if not cleaned:
            raise ValueError("Skill name cannot be empty")
        return cleaned


class RequirementSkillRead(BaseModel):
    name: str
    min_experience_months: int | None = None
    min_experience_years: float | None = None


class RequirementCreate(BaseModel):
    title: str
    skills: list[RequirementSkillInput] = Field(default_factory=list)
    required_skills: list[str] = Field(default_factory=list)
    min_experience: int | None = None
    max_experience: int | None = None
    location: str | None = None
    min_ctc: float | None = None
    max_ctc: float | None = None
    notes: str | None = None
    qualification: str | None = None

    @field_validator("required_skills", mode="before")
    @classmethod
    def normalize_required_skills(cls, value: object) -> list[str]:
        return _normalize_skill_list(value)

    @model_validator(mode="before")
    @classmethod
    def migrate_required_skills_payload(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value

        payload = dict(value)

        if payload.get("skills") is None:
            payload["skills"] = []

        if payload.get("required_skills") and not payload.get("skills"):
            payload["skills"] = [
                {"name": skill, "min_experience_years": None}
                for skill in _normalize_skill_list(payload.get("required_skills"))
            ]

        normalized_skills: list[dict] = []
        for item in payload.get("skills") or []:
            if isinstance(item, str):
                normalized_skills.append({"name": item, "min_experience_years": None})
                continue
            if isinstance(item, dict):
                normalized_skills.append(item)

        payload["skills"] = normalized_skills
        return payload

    @model_validator(mode="after")
    def sync_required_skills(self) -> "RequirementCreate":
        if self.skills:
            self.required_skills = [item.name for item in self.skills]
        elif self.required_skills:
            self.skills = [
                RequirementSkillInput(name=skill, min_experience_years=None)
                for skill in self.required_skills
            ]
        return self


class RequirementExtractRequest(BaseModel):
    text: str = Field(min_length=20)


class RequirementExtractResponse(BaseModel):
    requirement: RequirementCreate


class RequirementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    skills: list[RequirementSkillRead] = Field(default_factory=list)
    required_skills: list[str] = Field(default_factory=list)
    min_experience: int | None = None
    max_experience: int | None = None
    location: str | None = None
    min_ctc: float | None = None
    max_ctc: float | None = None
    notes: str | None = None
    qualification: str | None = None
    summary_text: str | None = None
    created_at: datetime | None = None

    @field_validator("required_skills", mode="before")
    @classmethod
    def normalize_required_skills(cls, value: object) -> list[str]:
        return _normalize_skill_list(value)


class CandidateMatchView(BaseModel):
    id: int
    name: str | None = None
    email: str | None = None
    location: str | None = None
    experience_years: int | None = None
    skills: list[str] = Field(default_factory=list)
    current_company: str | None = None
    resume_url: str | None = None


class RequirementMatchView(BaseModel):
    id: int
    title: str


class CandidateRequirementStatusRead(BaseModel):
    candidate_id: int
    requirement_id: int
    status: Literal["new", "processing", "rejected", "hired"]


class MatchStatusUpdateRequest(BaseModel):
    status: Literal["new", "processing", "rejected", "hired"]


class MatchThresholdStatusRequest(BaseModel):
    threshold: float
    status: Literal["processing", "rejected", "hired"]


class BulkStatusUpdateResponse(BaseModel):
    requirement_id: int
    updated_count: int
    status: Literal["processing", "rejected", "hired"]


class RequirementOverviewRead(BaseModel):
    requirement_id: int
    total_current_candidates: int
    total_rejected_candidates: int
    total_hired_candidates: int
    total_processing_candidates: int


class MatchResultRead(BaseModel):
    candidate: CandidateMatchView
    requirement: RequirementMatchView
    score: float
    reason: str
    status: Literal["not_applied", "new", "processing", "rejected", "hired"]
