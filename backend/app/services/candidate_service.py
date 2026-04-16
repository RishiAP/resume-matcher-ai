import math
import re
from datetime import date
from decimal import Decimal
from typing import Literal

from sqlalchemy.orm import Session, selectinload

from app.models import Candidate, CandidateSkill, CandidateStatus, HRComment
from app.services.experience_calculator import (
    calculate_role_experience_months,
    calculate_skill_experience_months,
)


class CandidateService:
    _EXPERIENCE_FILTER_PATTERN = re.compile(
        r"^\s*(?P<name>.+?)\s*(?:>=|>|:)\s*(?P<years>\d+(?:\.\d+)?)\s*$"
    )

    @staticmethod
    def _normalize_skill_filters(skills: list[str] | None) -> list[str]:
        if not skills:
            return []

        normalized: list[str] = []
        seen: set[str] = set()

        for raw_skill in skills:
            for part in raw_skill.split(","):
                skill = part.strip().lower()
                if skill and skill not in seen:
                    seen.add(skill)
                    normalized.append(skill)

        return normalized

    @staticmethod
    def _candidate_skill_set(candidate: Candidate) -> set[str]:
        return {
            link.skill.name.strip().lower()
            for link in (candidate.skill_links or [])
            if link.skill is not None and isinstance(link.skill.name, str) and link.skill.name.strip()
        }

    @staticmethod
    def _matches_any_skill(candidate_skills: set[str], normalized_skills: set[str]) -> bool:
        return bool(candidate_skills.intersection(normalized_skills))

    @staticmethod
    def _matches_all_skills(candidate_skills: set[str], normalized_skills: set[str]) -> bool:
        return normalized_skills.issubset(candidate_skills)

    @staticmethod
    def _parse_threshold_filters(filters: list[str] | None) -> dict[str, int]:
        if not filters:
            return {}

        thresholds: dict[str, int] = {}
        for raw_filter in filters:
            if not raw_filter:
                continue

            match = CandidateService._EXPERIENCE_FILTER_PATTERN.match(raw_filter)
            if not match:
                continue

            name = match.group("name").strip().lower()
            years = float(match.group("years"))
            months = max(0, math.ceil(years * 12))
            if name and months > 0:
                thresholds[name] = months

        return thresholds

    @staticmethod
    def _experience_payload(candidate: Candidate) -> list[dict]:
        return [
            {
                "role": experience.role,
                "start_date": (
                    experience.start_date.isoformat()
                    if experience.start_date is not None
                    else None
                ),
                "end_date": (
                    experience.end_date.isoformat()
                    if experience.end_date is not None
                    else None
                ),
                "skills_used": list(experience.skills_used or []),
            }
            for experience in (candidate.experiences or [])
        ]

    @staticmethod
    def _matches_experience_filters(
        candidate: Candidate,
        skill_thresholds: dict[str, int],
        role_thresholds: dict[str, int],
    ) -> bool:
        if not skill_thresholds and not role_thresholds:
            return True

        experiences = CandidateService._experience_payload(candidate)
        skill_months = calculate_skill_experience_months(experiences)
        role_months = calculate_role_experience_months(experiences)

        for skill, required_months in skill_thresholds.items():
            if skill_months.get(skill, 0) < required_months:
                return False

        for role, required_months in role_thresholds.items():
            best_match_months = max(
                (
                    months
                    for role_name, months in role_months.items()
                    if role in role_name
                ),
                default=0,
            )
            if best_match_months < required_months:
                return False

        return True

    @staticmethod
    def find_all(
        db: Session,
        skills: list[str] | None,
        min_exp: int | None,
        max_exp: int | None,
        location: str | None,
        skill_experience: list[str] | None = None,
        role_experience: list[str] | None = None,
        skill_match_mode: Literal["all", "any"] = "all",
        comment_order: Literal["desc", "asc"] = "desc",
        requirement_id: int | None = None,
    ) -> list[dict]:
        query = db.query(Candidate).options(
            selectinload(Candidate.skill_links).selectinload(CandidateSkill.skill),
            selectinload(Candidate.experiences),
            selectinload(Candidate.projects),
            selectinload(Candidate.educations),
            selectinload(Candidate.hr_comments),
        )
        normalized_skills = CandidateService._normalize_skill_filters(skills)
        skill_thresholds = CandidateService._parse_threshold_filters(skill_experience)
        role_thresholds = CandidateService._parse_threshold_filters(role_experience)

        if requirement_id is not None:
            query = query.join(
                CandidateStatus,
                (CandidateStatus.candidate_id == Candidate.id)
                & (CandidateStatus.requirement_id == requirement_id),
            )

        if min_exp is not None:
            query = query.filter(Candidate.experience_years >= min_exp)
        if max_exp is not None:
            query = query.filter(Candidate.experience_years <= max_exp)
        if location:
            query = query.filter(Candidate.location.ilike(f"%{location.strip()}%"))

        rows = query.order_by(Candidate.created_at.desc()).all()

        if normalized_skills:
            skill_set = set(normalized_skills)
            if skill_match_mode == "all":
                rows = [
                    row
                    for row in rows
                    if CandidateService._matches_all_skills(
                        CandidateService._candidate_skill_set(row),
                        skill_set,
                    )
                ]
            else:
                rows = [
                    row
                    for row in rows
                    if CandidateService._matches_any_skill(
                        CandidateService._candidate_skill_set(row),
                        skill_set,
                    )
                ]

        if skill_thresholds or role_thresholds:
            rows = [
                row
                for row in rows
                if CandidateService._matches_experience_filters(
                    row,
                    skill_thresholds,
                    role_thresholds,
                )
            ]

        return [
            CandidateService._to_dict(
                row,
                selected_skills=normalized_skills,
                comment_order=comment_order,
            )
            for row in rows
        ]

    @staticmethod
    def update(db: Session, candidate_id: int, updates: dict) -> dict:
        allowed = {"interview_date", "interview_time"}
        safe_updates = {k: v for k, v in updates.items() if k in allowed}

        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")

        for key, value in safe_updates.items():
            setattr(candidate, key, value)

        db.commit()
        db.refresh(candidate)
        return CandidateService._to_dict(candidate)

    @staticmethod
    def add_comment(db: Session, candidate_id: int, comment: str) -> dict:
        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")

        text = str(comment or "").strip()
        if not text:
            raise ValueError("Comment cannot be empty")

        row = HRComment(candidate_id=int(candidate.id), comment=text)
        db.add(row)
        db.commit()
        db.refresh(row)
        return CandidateService._comment_to_dict(row)

    @staticmethod
    def update_comment(db: Session, candidate_id: int, comment_id: int, comment: str) -> dict:
        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")

        row = (
            db.query(HRComment)
            .filter(HRComment.id == comment_id, HRComment.candidate_id == candidate_id)
            .first()
        )
        if not row:
            raise LookupError(
                f"Comment {comment_id} not found for candidate {candidate_id}"
            )

        text = str(comment or "").strip()
        if not text:
            raise ValueError("Comment cannot be empty")

        row.comment = text
        db.commit()
        db.refresh(row)
        return CandidateService._comment_to_dict(row)

    @staticmethod
    def _comment_to_dict(comment: HRComment) -> dict:
        return {
            "id": comment.id,
            "comment": comment.comment,
            "created_at": comment.created_at.isoformat() if comment.created_at else None,
            "updated_at": comment.updated_at.isoformat() if comment.updated_at else None,
        }

    @staticmethod
    def _to_float(value: Decimal | float | int | None) -> float | None:
        if value is None:
            return None
        return float(value)

    @staticmethod
    def _to_date(value: date | None) -> str | None:
        if not value:
            return None
        return value.isoformat()

    @staticmethod
    def _to_dict(
        candidate: Candidate,
        selected_skills: list[str] | None = None,
        comment_order: Literal["desc", "asc"] = "desc",
    ) -> dict:
        def serialized_skill_profile(link: CandidateSkill) -> dict:
            return {
                "name": link.skill.name,
                "context": link.context,
                "experience_months": link.experience_months,
                "experience_years": (
                    round(link.experience_months / 12, 2)
                    if link.experience_months is not None
                    else None
                ),
            }

        sorted_experiences = sorted(
            candidate.experiences or [],
            key=lambda experience: (experience.sort_order or 0, experience.id or 0),
        )
        sorted_projects = sorted(
            candidate.projects or [],
            key=lambda project: (project.sort_order or 0, project.id or 0),
        )
        sorted_educations = sorted(
            candidate.educations or [],
            key=lambda education: (education.sort_order or 0, education.id or 0),
        )
        sorted_skill_links = sorted(
            [link for link in (candidate.skill_links or []) if link.skill is not None],
            key=lambda link: (
                link.experience_months is None,
                -(link.experience_months or 0),
                link.skill.name.lower(),
                link.id or 0,
            ),
        )

        sorted_hr_comments = sorted(
            candidate.hr_comments or [],
            key=lambda row: (row.created_at is not None, row.created_at),
            reverse=(comment_order == "desc"),
        )

        candidate_skills = [link.skill.name for link in sorted_skill_links]
        candidate_skill_set = {name.strip().lower() for name in candidate_skills if name.strip()}
        normalized_selected_skills = [
            skill.strip().lower() for skill in (selected_skills or []) if skill.strip()
        ]
        matched_skills = [
            skill for skill in normalized_selected_skills if skill in candidate_skill_set
        ]
        missing_skills = [
            skill for skill in normalized_selected_skills if skill not in candidate_skill_set
        ]

        return {
            "id": candidate.id,
            "name": candidate.name,
            "email": candidate.email,
            "phone": candidate.phone,
            "location": candidate.location,
            "current_company": candidate.current_company,
            "experience_years": candidate.experience_years,
            "skills": candidate_skills,
            "highest_degree": candidate.highest_degree,
            "year_of_passing": candidate.year_of_passing,
            "gpa": CandidateService._to_float(candidate.gpa),
            "resume_url": candidate.resume_url,
            "hr_comments": [
                {
                    "id": row.id,
                    "comment": row.comment,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                }
                for row in sorted_hr_comments
            ],
            "matched_skills": matched_skills,
            "missing_skills": missing_skills,
            "interview_date": CandidateService._to_date(candidate.interview_date),
            "interview_time": candidate.interview_time,
            "created_at": candidate.created_at.isoformat() if candidate.created_at else None,
            "structured_profile": candidate.structured_profile,
            "skill_profiles": [serialized_skill_profile(link) for link in sorted_skill_links],
            "experiences": [
                {
                    "role": experience.role,
                    "company": experience.company,
                    "start_date": CandidateService._to_date(experience.start_date),
                    "end_date": CandidateService._to_date(experience.end_date),
                    "skills_used": list(experience.skills_used or []),
                }
                for experience in sorted_experiences
            ],
            "projects": [
                {
                    "name": project.name,
                    "description": project.description,
                    "start_date": CandidateService._to_date(project.start_date),
                    "end_date": CandidateService._to_date(project.end_date),
                    "skills_used": list(project.skills_used or []),
                }
                for project in sorted_projects
            ],
            "educations": [
                {
                    "institute": education.institute,
                    "degree_name": education.degree_name,
                    "branch_name": education.branch_name,
                    "start_date": CandidateService._to_date(education.start_date),
                    "end_date": CandidateService._to_date(education.end_date),
                    "year_of_passing": education.year_of_passing,
                    "gpa": CandidateService._to_float(education.gpa),
                }
                for education in sorted_educations
            ],
        }
