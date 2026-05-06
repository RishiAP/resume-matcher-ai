import math
import re
from datetime import date
from decimal import Decimal
from typing import Literal

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models import Candidate, CandidateSkill, CandidateStatus, Interview, Skill
from app.services.experience_calculator import (
    calculate_role_experience_months,
    calculate_skill_experience_months,
)


class CandidateService:
    _EXPERIENCE_FILTER_PATTERN = re.compile(
        r"^\s*(?P<name>.+?)\s*(?:>=|>|:)\s*(?P<years>\d+(?:\.\d+)?)\s*$"
    )

    _PREFERENCE_ORDER: dict[str, int] = {"preferred": 0, "unknown": 1, "non_preferred": 2}

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
        # Determine most-recent interview for backward compatibility fields
        most_recent_interview = None
        if candidate.interviews:
            most_recent_interview = sorted(
                candidate.interviews,
                key=lambda ii: (getattr(ii, "created_at", None), getattr(ii, "id", 0)),
                reverse=True,
            )[0]

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
            selectinload(Candidate.interviews),
        )
        normalized_skills = CandidateService._normalize_skill_filters(skills)
        skill_thresholds = CandidateService._parse_threshold_filters(skill_experience)
        role_thresholds = CandidateService._parse_threshold_filters(role_experience)

        # Do not filter out candidates by requirement — we want to return all
        # candidates and attach per-requirement status when requested. An
        # additional single query below will fetch statuses for the returned
        # candidate ids to avoid N+1 queries.

        if min_exp is not None:
            query = query.filter(Candidate.experience_years >= min_exp)
        if max_exp is not None:
            query = query.filter(Candidate.experience_years <= max_exp)
        if location:
            query = query.filter(Candidate.location.ilike(f"%{location.strip()}%"))

        rows = query.order_by(Candidate.created_at.desc()).all()

        # If a requirement_id is provided, fetch any existing CandidateStatus
        # rows for the returned candidates in a single query and attach a
        # `requirement_status` value to each returned dict below. If no
        # CandidateStatus exists for a candidate for the given requirement,
        # we'll return the sentinel value 'not_applied'. When no
        # requirement_id is provided, `requirement_status` will be null.
        requirement_status_map: dict[int, str] = {}
        if requirement_id is not None and rows:
            candidate_ids = [r.id for r in rows]
            status_rows = (
                db.query(CandidateStatus.candidate_id, CandidateStatus.status)
                .filter(
                    CandidateStatus.requirement_id == requirement_id,
                    CandidateStatus.candidate_id.in_(candidate_ids),
                )
                .all()
            )
            requirement_status_map = {r.candidate_id: r.status for r in status_rows}
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

        result: list[dict] = []
        for row in rows:
            item = CandidateService._to_dict(
                row,
                selected_skills=normalized_skills,
                comment_order=comment_order,
            )
            if requirement_id is None:
                item["requirement_status"] = None
            else:
                item["requirement_status"] = requirement_status_map.get(row.id, "not_applied")
            result.append(item)

        return result

    @staticmethod
    def update(db: Session, candidate_id: int, updates: dict) -> dict:
        # Backwards-compatible: accept interview_date/interview_time updates
        # and create a new Interview row for the candidate when provided.
        allowed = {"interview_date", "interview_time"}
        safe_updates = {k: v for k, v in updates.items() if k in allowed}

        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")

        if safe_updates:
            # Create a new interview row for backwards-compatible interview_date/time updates
            CandidateService.create_interview(
                db=db,
                candidate_id=candidate.id,
                interview_date=safe_updates.get("interview_date"),
                interview_time=safe_updates.get("interview_time"),
                comment=None,
            )

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

        # Find most recent interview for the candidate. If the most-recent
        # interview has no comment, attach the comment there. Otherwise create
        # a new interview row (one comment per interview).
        interview = None
        if candidate.interviews:
            interview = sorted(
                candidate.interviews,
                key=lambda i: (
                    i.created_at if getattr(i, "created_at", None) is not None else 0,
                    i.id or 0,
                ),
                reverse=True,
            )[0]

        if interview is None or (getattr(interview, "comment", None) is not None and str(interview.comment).strip()):
            existing_rounds = [i.round or 0 for i in (candidate.interviews or [])]
            next_round = (max(existing_rounds) + 1) if existing_rounds else 1
            interview = Interview(candidate_id=candidate.id, round=next_round, comment=text)
            db.add(interview)
            db.commit()
            db.refresh(interview)
        else:
            interview.comment = text
            db.commit()
            db.refresh(interview)

        return CandidateService._comment_to_dict(interview)

    @staticmethod
    def create_interview(
        db: Session,
        candidate_id: int,
        interview_date: date | None = None,
        interview_time: str | None = None,
        comment: str | None = None,
    ) -> dict:
        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")

        existing_rounds = [i.round or 0 for i in (candidate.interviews or [])]
        next_round = (max(existing_rounds) + 1) if existing_rounds else 1

        interview = Interview(
            candidate_id=candidate.id,
            interview_date=interview_date,
            interview_time=interview_time,
            round=next_round,
            comment=str(comment).strip() if comment is not None else None,
        )
        db.add(interview)
        db.commit()
        db.refresh(interview)

        return CandidateService._interview_to_dict(interview)

    @staticmethod
    def update_interview(
        db: Session,
        candidate_id: int,
        interview_id: int,
        interview_date: date | None = None,
        interview_time: str | None = None,
        comment: str | None = None,
    ) -> dict:
        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")

        row = (
            db.query(Interview)
            .filter(Interview.id == interview_id, Interview.candidate_id == candidate_id)
            .first()
        )
        if not row:
            raise LookupError(f"Interview {interview_id} not found for candidate {candidate_id}")

        if interview_date is not None:
            row.interview_date = interview_date
        if interview_time is not None:
            row.interview_time = interview_time
        if comment is not None:
            text = str(comment).strip()
            if not text:
                raise ValueError("Comment cannot be empty")
            row.comment = text

        db.commit()
        db.refresh(row)
        return CandidateService._interview_to_dict(row)

    @staticmethod
    def update_comment(db: Session, candidate_id: int, comment_id: int, comment: str) -> dict:
        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")

        row = (
            db.query(Interview)
            .filter(Interview.id == comment_id, Interview.candidate_id == candidate_id)
            .first()
        )
        if not row:
            raise LookupError(f"Comment {comment_id} not found for candidate {candidate_id}")

        text = str(comment or "").strip()
        if not text:
            raise ValueError("Comment cannot be empty")

        row.comment = text
        db.commit()
        db.refresh(row)
        return CandidateService._comment_to_dict(row)

    @staticmethod
    def _comment_to_dict(comment: Interview) -> dict:
        return {
            "id": comment.id,
            "comment": comment.comment,
            "created_at": comment.created_at.isoformat() if getattr(comment, "created_at", None) else None,
            "updated_at": comment.updated_at.isoformat() if getattr(comment, "updated_at", None) else None,
        }

    @staticmethod
    def _interview_to_dict(interview: Interview) -> dict:
        return {
            "id": interview.id,
            "round": interview.round,
            "interview_date": interview.interview_date.isoformat() if getattr(interview, "interview_date", None) else None,
            "interview_time": interview.interview_time,
            "comment": interview.comment,
            "created_at": interview.created_at.isoformat() if getattr(interview, "created_at", None) else None,
            "updated_at": interview.updated_at.isoformat() if getattr(interview, "updated_at", None) else None,
        }

    @staticmethod
    def _to_float(value: Decimal | float | int | None) -> float | None:
        if value is None:
            return None
        return float(value)

    @staticmethod
    def update_notes(db: Session, candidate_id: int, notes: str | None) -> dict:
        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")
        # Coerce empty/whitespace to None
        if notes is not None and notes.strip() == "":
            notes = None
        candidate.notes = notes
        db.commit()
        db.refresh(candidate)
        return CandidateService._to_dict(candidate)

    @staticmethod
    def update_skill_preference(
        db: Session,
        candidate_id: int,
        skill_name: str,
        preference: str,
    ) -> dict:
        link = (
            db.query(CandidateSkill)
            .join(CandidateSkill.skill)
            .filter(
                CandidateSkill.candidate_id == candidate_id,
                func.lower(Skill.name) == skill_name.lower(),
            )
            .first()
        )
        if not link:
            raise LookupError(
                f"Skill '{skill_name}' not found for candidate {candidate_id}"
            )
        link.preference = preference
        db.commit()
        db.refresh(link)
        return {
            "name": link.skill.name,
            "context": link.context,
            "experience_months": link.experience_months,
            "experience_years": (
                round(link.experience_months / 12, 2)
                if link.experience_months is not None
                else None
            ),
            "preference": link.preference.value if link.preference else "unknown",
        }

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
                "preference": link.preference.value if link.preference else "unknown",
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
                CandidateService._PREFERENCE_ORDER.get(
                    link.preference.value if link.preference else "unknown", 1
                ),
                link.experience_months is None,
                -(link.experience_months or 0),
                link.skill.name.lower(),
                link.id or 0,
            ),
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

        # Determine the most-recent interview (for backward-compatible fields)
        most_recent_interview = None
        if candidate.interviews:
            most_recent_interview = sorted(
                candidate.interviews,
                key=lambda ii: (getattr(ii, "created_at", None), getattr(ii, "id", 0)),
                reverse=True,
            )[0]

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
            "matched_skills": matched_skills,
            "missing_skills": missing_skills,
            # Backwards-compatible single interview fields: expose the most
            # recently created interview's date/time if present.
            "interview_date": most_recent_interview.interview_date.isoformat() if getattr(most_recent_interview, "interview_date", None) else None,
            "interview_time": most_recent_interview.interview_time if getattr(most_recent_interview, "interview_time", None) else None,
            # Full list of interviews (new): include round/date/time/comment metadata
            "interviews": [
                {
                    "id": i.id,
                    "round": i.round,
                    "interview_date": i.interview_date.isoformat() if getattr(i, "interview_date", None) else None,
                    "interview_time": i.interview_time,
                    "comment": i.comment,
                    "created_at": i.created_at.isoformat() if getattr(i, "created_at", None) else None,
                    "updated_at": i.updated_at.isoformat() if getattr(i, "updated_at", None) else None,
                }
                for i in sorted((candidate.interviews or []), key=lambda ii: (getattr(ii, "created_at", None), getattr(ii, "id", 0)), reverse=True)
            ],
            "created_at": candidate.created_at.isoformat() if candidate.created_at else None,
            "structured_profile": candidate.structured_profile,
            "notes": candidate.notes,
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
