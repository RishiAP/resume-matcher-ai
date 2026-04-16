import math
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models import Requirement, RequirementSkill, Skill
from app.services.ai_service import AiService


class RequirementService:
    @staticmethod
    def _to_optional_text(value: object) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    @staticmethod
    def _to_optional_months(years: object) -> int | None:
        if years is None or years == "":
            return None
        try:
            numeric = float(str(years))
        except (TypeError, ValueError):
            return None
        if numeric < 0:
            return None
        return math.ceil(numeric * 12)

    @staticmethod
    def _to_optional_int(value: object) -> int | None:
        if value is None or value == "":
            return None
        try:
            numeric = float(str(value))
        except (TypeError, ValueError):
            return None
        if numeric < 0:
            return None
        return int(round(numeric))

    @staticmethod
    def _to_optional_float(value: object) -> float | None:
        if value is None or value == "":
            return None
        try:
            numeric = float(str(value))
        except (TypeError, ValueError):
            return None
        if numeric < 0:
            return None
        return numeric

    @staticmethod
    def _normalize_extracted_skills(payload: dict) -> list[dict]:
        rows: dict[str, float | None] = {}

        for item in payload.get("skills") or []:
            if isinstance(item, str):
                name = item.strip().lower()
                min_years = None
            elif isinstance(item, dict):
                name = str(item.get("name") or "").strip().lower()
                min_years = RequirementService._to_optional_float(
                    item.get("min_experience_years")
                )
            else:
                continue

            if not name:
                continue

            existing = rows.get(name)
            if existing is None:
                rows[name] = min_years
            elif min_years is not None:
                rows[name] = max(existing or 0.0, min_years)

        for name in payload.get("required_skills") or []:
            skill_name = str(name).strip().lower()
            if skill_name and skill_name not in rows:
                rows[skill_name] = None

        return [
            {
                "name": skill_name,
                "min_experience_years": min_years,
            }
            for skill_name, min_years in sorted(rows.items(), key=lambda item: item[0])
        ]

    @staticmethod
    def extract_from_text(text: str) -> dict:
        extracted = AiService.extract_requirement(text)
        normalized_skills = RequirementService._normalize_extracted_skills(extracted)

        min_experience = RequirementService._to_optional_int(extracted.get("min_experience"))
        max_experience = RequirementService._to_optional_int(extracted.get("max_experience"))
        if (
            min_experience is not None
            and max_experience is not None
            and min_experience > max_experience
        ):
            min_experience, max_experience = max_experience, min_experience

        min_ctc = RequirementService._to_optional_float(extracted.get("min_ctc"))
        max_ctc = RequirementService._to_optional_float(extracted.get("max_ctc"))
        if min_ctc is not None and max_ctc is not None and min_ctc > max_ctc:
            min_ctc, max_ctc = max_ctc, min_ctc

        title = str(extracted.get("title") or "").strip() or "New Role Requirement"

        return {
            "title": title,
            "skills": normalized_skills,
            "required_skills": [item["name"] for item in normalized_skills],
            "min_experience": min_experience,
            "max_experience": max_experience,
            "location": str(extracted.get("location") or "").strip() or None,
            "min_ctc": min_ctc,
            "max_ctc": max_ctc,
            "notes": str(extracted.get("notes") or "").strip() or None,
            "qualification": str(extracted.get("qualification") or "").strip() or None,
        }

    @staticmethod
    def _normalize_skill_rows(data: dict) -> list[dict]:
        rows: dict[str, int | None] = {}

        raw_skills = data.get("skills") or []
        for item in raw_skills:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip().lower()
            if not name:
                continue

            months = RequirementService._to_optional_months(item.get("min_experience_years"))
            existing = rows.get(name)
            if existing is None:
                rows[name] = months
            elif months is not None:
                rows[name] = max(existing or 0, months)

        # Backward compatibility for any old payloads.
        for raw_skill in data.get("required_skills") or []:
            name = str(raw_skill).strip().lower()
            if name and name not in rows:
                rows[name] = None

        return [
            {"name": name, "min_experience_months": months}
            for name, months in sorted(rows.items(), key=lambda item: item[0])
        ]

    @staticmethod
    def _get_or_create_skill(db: Session, skill_name: str, cache: dict[str, Skill]) -> Skill:
        cached = cache.get(skill_name)
        if cached is not None:
            return cached

        skill = (
            db.query(Skill)
            .filter(func.lower(Skill.name) == skill_name)
            .order_by(Skill.id.asc())
            .first()
        )
        if skill is None:
            skill = Skill(name=skill_name)
            db.add(skill)
            db.flush()

        cache[skill_name] = skill
        return skill

    @staticmethod
    def find_all(db: Session) -> list[dict]:
        rows = (
            db.query(Requirement)
            .options(
                selectinload(Requirement.skill_requirements).selectinload(RequirementSkill.skill)
            )
            .order_by(Requirement.created_at.desc(), Requirement.id.desc())
            .all()
        )
        return [RequirementService._to_dict(row) for row in rows]

    @staticmethod
    def create(db: Session, data: dict) -> dict:
        normalized_skill_rows = RequirementService._normalize_skill_rows(data)

        req = Requirement(
            title=data["title"],
            min_experience=data.get("min_experience"),
            max_experience=data.get("max_experience"),
            location=RequirementService._to_optional_text(data.get("location")),
            min_ctc=data.get("min_ctc"),
            max_ctc=data.get("max_ctc"),
            qualification=RequirementService._to_optional_text(data.get("qualification")),
            notes=RequirementService._to_optional_text(data.get("notes")),
            summary_text=RequirementService._build_summary(
                {
                    **data,
                    "required_skills": [item["name"] for item in normalized_skill_rows],
                }
            ),
        )
        db.add(req)
        db.flush()

        skill_cache: dict[str, Skill] = {}
        for item in normalized_skill_rows:
            skill = RequirementService._get_or_create_skill(db, item["name"], skill_cache)
            db.add(
                RequirementSkill(
                    requirement_id=int(req.id),
                    skill_id=int(skill.id),
                    min_experience_months=item["min_experience_months"],
                )
            )

        db.commit()
        db.refresh(req)

        req = (
            db.query(Requirement)
            .options(
                selectinload(Requirement.skill_requirements).selectinload(RequirementSkill.skill)
            )
            .filter(Requirement.id == req.id)
            .first()
        )
        if req is None:
            raise LookupError("Requirement could not be loaded after creation")

        return RequirementService._to_dict(req)

    @staticmethod
    def update(db: Session, requirement_id: int, data: dict) -> dict:
        req = (
            db.query(Requirement)
            .options(
                selectinload(Requirement.skill_requirements).selectinload(RequirementSkill.skill)
            )
            .filter(Requirement.id == requirement_id)
            .first()
        )
        if req is None:
            raise LookupError(f"Requirement {requirement_id} not found")

        normalized_skill_rows = RequirementService._normalize_skill_rows(data)

        req.title = data["title"]
        req.min_experience = data.get("min_experience")
        req.max_experience = data.get("max_experience")
        req.location = RequirementService._to_optional_text(data.get("location"))
        req.min_ctc = data.get("min_ctc")
        req.max_ctc = data.get("max_ctc")
        req.qualification = RequirementService._to_optional_text(data.get("qualification"))
        req.notes = RequirementService._to_optional_text(data.get("notes"))
        req.summary_text = RequirementService._build_summary(
            {
                **data,
                "required_skills": [item["name"] for item in normalized_skill_rows],
            }
        )

        req.skill_requirements.clear()
        db.flush()

        skill_cache: dict[str, Skill] = {}
        for item in normalized_skill_rows:
            skill = RequirementService._get_or_create_skill(db, item["name"], skill_cache)
            req.skill_requirements.append(
                RequirementSkill(
                    requirement_id=int(req.id),
                    skill_id=int(skill.id),
                    min_experience_months=item["min_experience_months"],
                )
            )

        db.commit()

        refreshed = (
            db.query(Requirement)
            .options(
                selectinload(Requirement.skill_requirements).selectinload(RequirementSkill.skill)
            )
            .filter(Requirement.id == requirement_id)
            .first()
        )
        if refreshed is None:
            raise LookupError(f"Requirement {requirement_id} could not be loaded after update")

        return RequirementService._to_dict(refreshed)

    @staticmethod
    def _to_float(value: Decimal | float | int | None) -> float | None:
        if value is None:
            return None
        return float(value)

    @staticmethod
    def _to_dict(requirement: Requirement) -> dict:
        skills = sorted(
            requirement.skill_requirements or [],
            key=lambda item: (item.skill.name.lower() if item.skill else "", item.id or 0),
        )

        return {
            "id": requirement.id,
            "title": requirement.title,
            "skills": [
                {
                    "name": link.skill.name if link.skill else "",
                    "min_experience_months": link.min_experience_months,
                    "min_experience_years": (
                        round(link.min_experience_months / 12, 2)
                        if link.min_experience_months is not None
                        else None
                    ),
                }
                for link in skills
                if link.skill is not None
            ],
            "required_skills": [
                link.skill.name
                for link in skills
                if link.skill is not None
            ],
            "min_experience": requirement.min_experience,
            "max_experience": requirement.max_experience,
            "location": requirement.location,
            "min_ctc": RequirementService._to_float(requirement.min_ctc),
            "max_ctc": RequirementService._to_float(requirement.max_ctc),
            "notes": requirement.notes,
            "qualification": requirement.qualification,
            "summary_text": requirement.summary_text,
            "created_at": requirement.created_at.isoformat() if requirement.created_at else None,
        }

    @staticmethod
    def _build_summary(data: dict) -> str:
        parts: list[str] = []
        skills = data.get("required_skills") or []
        title = data.get("title")
        min_exp = data.get("min_experience")
        max_exp = data.get("max_experience")
        qualification = data.get("qualification")
        location = data.get("location")
        notes = data.get("notes")

        if skills:
            parts.append(f"skills (highest priority): {', '.join(skills)}")

        if title:
            parts.append(f"role: {title}")

        if min_exp is not None and max_exp is not None:
            parts.append(f"experience: {min_exp}-{max_exp} years")
        elif min_exp is not None:
            parts.append(f"experience: at least {min_exp} years")
        elif max_exp is not None:
            parts.append(f"experience: up to {max_exp} years")

        if qualification:
            parts.append(f"qualification (lowest priority): {qualification}")

        if location:
            parts.append(f"location: {location}")

        if notes:
            parts.append(f"notes: {notes}")

        return "; ".join(parts)
