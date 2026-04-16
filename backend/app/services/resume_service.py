import io
import re
import time
import uuid
from datetime import date
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

import pdfplumber
from docx import Document as DocxDocument
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models import (
    Candidate,
    CandidateEducation,
    CandidateExperience,
    CandidateProject,
    CandidateSkill,
    CandidateStatus,
    Skill,
)
from app.services.ai_service import AiRateLimitError, AiService
from app.services.experience_calculator import (
    parse_resume_date,
    calculate_skill_experience_months,
    calculate_total_experience_years,
    normalize_skill_names,
)

settings = get_settings()
MAX_REMOTE_FILE_BYTES = 15 * 1024 * 1024
REMOTE_FETCH_TIMEOUT_SECONDS = 30
STAGING_FOLDER_NAME = ".staging"


class ResumeService:
    _SKILL_CONTEXT_PRIORITY = {
        "mentioned": 1,
        "project": 2,
        "secondary": 3,
        "primary": 4,
    }

    _ALLOWED_SKILL_CONTEXTS = set(_SKILL_CONTEXT_PRIORITY.keys())

    @staticmethod
    def _upload_root() -> Path:
        upload_path = Path(settings.upload_path)
        upload_path.mkdir(parents=True, exist_ok=True)
        return upload_path

    @staticmethod
    def _staging_root() -> Path:
        staging_path = ResumeService._upload_root() / STAGING_FOLDER_NAME
        staging_path.mkdir(parents=True, exist_ok=True)
        return staging_path

    @staticmethod
    def save_uploaded_file(contents: bytes, filename: str) -> tuple[str, str]:
        if not contents:
            raise ValueError("Uploaded file is empty")

        staging_path = ResumeService._staging_root()

        safe_name = ResumeService._build_safe_filename(filename)
        file_path = staging_path / safe_name
        file_path.write_bytes(contents)
        return str(file_path), safe_name

    @staticmethod
    def process_saved_file(
        file_path: str,
        original_filename: str,
        content_type: str,
        requirement_id: int | None = None,
    ) -> int:
        path = Path(file_path)
        if not path.exists():
            raise ValueError("Uploaded file is no longer available. Please upload it again.")

        contents = path.read_bytes()
        try:
            candidate_id = ResumeService._process_contents(
                contents=contents,
                filename=original_filename or path.name,
                content_type=content_type,
                requirement_id=requirement_id,
            )
        except AiRateLimitError:
            # Keep staged file for Celery retry attempts.
            raise
        except Exception:
            ResumeService._safe_unlink(path)
            raise

        ResumeService._safe_unlink(path)
        return candidate_id

    @staticmethod
    def process_from_url(url: str, requirement_id: int | None = None) -> int:
        contents, filename, content_type = ResumeService._download_remote_file(url)
        file_path, _ = ResumeService.save_uploaded_file(contents, filename)
        staged_path = Path(file_path)
        try:
            return ResumeService._process_contents(
                contents=contents,
                filename=filename,
                content_type=content_type,
                requirement_id=requirement_id,
                source_url=url,
            )
        finally:
            ResumeService._safe_unlink(staged_path)

    @staticmethod
    def _process_contents(
        contents: bytes,
        filename: str,
        content_type: str,
        requirement_id: int | None = None,
        source_url: str | None = None,
    ) -> int:
        text = ResumeService._extract_text(contents, content_type, filename)
        if len(text.strip()) < 50:
            raise ValueError("Could not extract meaningful text from this file")

        parsed = AiService.parse_resume(text)
        extraction = ResumeService._normalize_extraction(parsed, resume_text=text)
        explicit_experience_years = extraction["candidate"].get("total_experience_years")
        experience_years = (
            explicit_experience_years
            if isinstance(explicit_experience_years, int)
            else calculate_total_experience_years(extraction["experiences"])
        )
        current_company = ResumeService._latest_company(extraction["experiences"])
        summary = ResumeService._build_summary(
            extraction=extraction,
            experience_years=experience_years,
            current_company=current_company,
        )
        embedding = AiService.generate_embedding(summary or text[:1500])

        db = SessionLocal()
        try:
            candidate_payload = extraction["candidate"]
            candidate_name = ResumeService._as_nullable_str(candidate_payload.get("name"))
            candidate_location = ResumeService._as_nullable_str(candidate_payload.get("location"))
            normalized_email = ResumeService._normalize_email(candidate_payload.get("email"))
            highest_degree, year_of_passing, gpa = ResumeService._education_summary(
                extraction["education"]
            )
            candidate: Candidate | None = None
            if normalized_email:
                candidate = (
                    db.query(Candidate)
                    .filter(func.lower(Candidate.email) == normalized_email)
                    .order_by(Candidate.id.asc())
                    .first()
                )
            else:
                normalized_name = candidate_name.lower() if candidate_name else None
                normalized_location = candidate_location.lower() if candidate_location else None
                normalized_degree = highest_degree.lower() if highest_degree else None

                # Use a strict composite identity only when all fields are present.
                # This avoids accidental merges for partially extracted profiles.
                if (
                    normalized_name
                    and normalized_location
                    and experience_years is not None
                    and normalized_degree
                    and year_of_passing is not None
                ):
                    candidate = (
                        db.query(Candidate)
                        .filter(
                            func.lower(Candidate.name) == normalized_name,
                            func.lower(Candidate.location) == normalized_location,
                            Candidate.experience_years == experience_years,
                            func.lower(Candidate.highest_degree) == normalized_degree,
                            Candidate.year_of_passing == year_of_passing,
                        )
                        .order_by(Candidate.id.asc())
                        .first()
                    )

            if candidate is None:
                candidate = Candidate()
                db.add(candidate)

            existing_resume_name = ResumeService._as_nullable_str(candidate.resume_url)

            candidate.name = candidate_name
            candidate.email = normalized_email or ResumeService._as_nullable_str(
                candidate_payload.get("email")
            )
            candidate.phone = ResumeService._as_nullable_str(candidate_payload.get("phone"))
            candidate.location = candidate_location
            candidate.current_company = current_company
            candidate.experience_years = experience_years

            candidate.highest_degree = highest_degree
            candidate.year_of_passing = year_of_passing
            candidate.gpa = gpa

            candidate.summary_text = summary
            candidate.embedding = embedding
            candidate.structured_profile = extraction

            db.flush()
            candidate.resume_url = ResumeService._persist_candidate_resume(
                candidate_id=int(candidate.id),
                original_filename=filename,
                contents=contents,
                existing_resume_name=existing_resume_name,
            )
            ResumeService._replace_relational_profile(
                db=db,
                candidate_id=int(candidate.id),
                extraction=extraction,
            )

            db.commit()
            db.refresh(candidate)

            # If a requirement is provided, ensure the candidate has a 'new' status link
            if requirement_id is not None:
                existing_status = (
                    db.query(CandidateStatus)
                    .filter(
                        CandidateStatus.requirement_id == requirement_id,
                        CandidateStatus.candidate_id == int(candidate.id),
                    )
                    .first()
                )
                if existing_status is None:
                    db.add(
                        CandidateStatus(
                            requirement_id=requirement_id,
                            candidate_id=int(candidate.id),
                            status="new",
                        )
                    )
                    db.commit()

            return int(candidate.id)
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _download_remote_file(url: str) -> tuple[bytes, str, str]:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Only HTTP/HTTPS resume URLs are supported")

        request = Request(url, headers={"User-Agent": "resume-matcher/1.0"})
        try:
            with urlopen(request, timeout=REMOTE_FETCH_TIMEOUT_SECONDS) as response:
                content_type = response.headers.get_content_type() or ""
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_REMOTE_FILE_BYTES:
                    raise ValueError(
                        f"Remote file exceeds {MAX_REMOTE_FILE_BYTES // (1024 * 1024)}MB limit"
                    )

                contents = response.read(MAX_REMOTE_FILE_BYTES + 1)
                if len(contents) > MAX_REMOTE_FILE_BYTES:
                    raise ValueError(
                        f"Remote file exceeds {MAX_REMOTE_FILE_BYTES // (1024 * 1024)}MB limit"
                    )

        except HTTPError as exc:
            raise ValueError(f"Could not download resume URL (HTTP {exc.code})") from exc
        except URLError as exc:
            raise ValueError("Could not download resume URL") from exc

        filename = Path(unquote(parsed.path)).name or f"remote-{uuid.uuid4().hex}"
        if "." not in filename:
            if "pdf" in content_type.lower():
                filename = f"{filename}.pdf"
            elif "word" in content_type.lower() or "docx" in content_type.lower():
                filename = f"{filename}.docx"

        if not contents:
            raise ValueError("Downloaded file is empty")

        return contents, filename, content_type

    @staticmethod
    def _build_safe_filename(filename: str) -> str:
        stem = Path(filename).stem.replace(" ", "-")
        suffix = Path(filename).suffix.lower()
        return f"{int(time.time())}-{uuid.uuid4().hex}-{stem}{suffix}"

    @staticmethod
    def _safe_unlink(path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            return

    @staticmethod
    def _build_candidate_resume_filename(
        candidate_id: int,
        original_filename: str,
        existing_resume_name: str | None,
    ) -> str:
        if existing_resume_name:
            existing_name = Path(existing_resume_name).name
            if existing_name:
                return existing_name

        suffix = Path(original_filename).suffix.lower() or ".pdf"
        return f"candidate-{candidate_id}{suffix}"

    @staticmethod
    def _persist_candidate_resume(
        *,
        candidate_id: int,
        original_filename: str,
        contents: bytes,
        existing_resume_name: str | None,
    ) -> str:
        if not contents:
            raise ValueError("Cannot persist an empty resume file")

        target_name = ResumeService._build_candidate_resume_filename(
            candidate_id=candidate_id,
            original_filename=original_filename,
            existing_resume_name=existing_resume_name,
        )
        target_path = ResumeService._upload_root() / target_name

        if target_path.exists():
            try:
                if target_path.read_bytes() == contents:
                    return target_name
            except OSError:
                pass

        target_path.write_bytes(contents)
        return target_name

    @staticmethod
    def _extract_text(contents: bytes, content_type: str, filename: str) -> str:
        ctype = (content_type or "").lower()
        suffix = Path(filename).suffix.lower()

        is_pdf = "pdf" in ctype or suffix == ".pdf"
        is_docx = "word" in ctype or "docx" in ctype or suffix == ".docx"

        if is_pdf:
            with pdfplumber.open(io.BytesIO(contents)) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)

        if is_docx:
            doc = DocxDocument(io.BytesIO(contents))
            return "\n".join(paragraph.text for paragraph in doc.paragraphs)

        raise ValueError(f"Unsupported file type: {content_type or suffix}")

    @staticmethod
    def _replace_relational_profile(db, candidate_id: int, extraction: dict) -> None:
        skill_months = calculate_skill_experience_months(extraction["experiences"])

        db.query(CandidateSkill).filter(CandidateSkill.candidate_id == candidate_id).delete(
            synchronize_session=False
        )
        db.query(CandidateExperience).filter(
            CandidateExperience.candidate_id == candidate_id
        ).delete(synchronize_session=False)
        db.query(CandidateProject).filter(CandidateProject.candidate_id == candidate_id).delete(
            synchronize_session=False
        )
        db.query(CandidateEducation).filter(
            CandidateEducation.candidate_id == candidate_id
        ).delete(synchronize_session=False)

        skill_cache: dict[str, Skill] = {}

        for skill in extraction["skills"]:
            skill_name = skill["name"]
            skill_record = ResumeService._get_or_create_skill(db, skill_name, skill_cache)
            db.add(
                CandidateSkill(
                    candidate_id=candidate_id,
                    skill_id=int(skill_record.id),
                    context=skill["context"],
                    experience_months=skill_months.get(skill_name),
                )
            )

        for index, experience in enumerate(extraction["experiences"]):
            db.add(
                CandidateExperience(
                    candidate_id=candidate_id,
                    role=experience["role"],
                    company=ResumeService._as_nullable_str(experience.get("company")),
                    start_date=ResumeService._as_nullable_date(experience.get("start_date")),
                    end_date=ResumeService._as_nullable_date(experience.get("end_date")),
                    skills_used=normalize_skill_names(experience.get("skills_used")),
                    sort_order=index,
                )
            )

        for index, project in enumerate(extraction["projects"]):
            db.add(
                CandidateProject(
                    candidate_id=candidate_id,
                    name=project["name"],
                    description=ResumeService._as_nullable_str(project.get("description")),
                    start_date=ResumeService._as_nullable_date(project.get("start_date")),
                    end_date=ResumeService._as_nullable_date(project.get("end_date")),
                    skills_used=normalize_skill_names(project.get("skills_used")),
                    sort_order=index,
                )
            )

        for index, education in enumerate(extraction["education"]):
            db.add(
                CandidateEducation(
                    candidate_id=candidate_id,
                    institute=education["institute"],
                    degree_name=education["degree_name"],
                    branch_name=ResumeService._as_nullable_str(education.get("branch_name")),
                    start_date=ResumeService._as_nullable_date(education.get("start_date")),
                    end_date=ResumeService._as_nullable_date(education.get("end_date")),
                    year_of_passing=ResumeService._as_nullable_int(
                        education.get("year_of_passing")
                    ),
                    gpa=ResumeService._as_nullable_float(education.get("gpa")),
                    sort_order=index,
                )
            )

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
    def _normalize_extraction(parsed: object, resume_text: str = "") -> dict:
        payload = parsed if isinstance(parsed, dict) else {}

        candidate_payload = payload.get("candidate")
        if not isinstance(candidate_payload, dict):
            candidate_payload = {}

        candidate = {
            "name": ResumeService._as_required_str(candidate_payload.get("name")),
            "email": ResumeService._as_required_str(candidate_payload.get("email")),
            "phone": ResumeService._as_required_str(candidate_payload.get("phone")),
            "location": ResumeService._extract_candidate_location(
                payload=payload,
                candidate_payload=candidate_payload,
                resume_text=resume_text,
            ),
            "total_experience_years": ResumeService._derive_total_experience_years(
                raw_total_experience=(
                    candidate_payload.get("total_experience_years")
                    or candidate_payload.get("total_experience")
                    or payload.get("total_experience_years")
                )
            ),
        }

        skill_contexts: dict[str, str] = {}

        raw_skills = payload.get("skills") if isinstance(payload.get("skills"), list) else []
        for raw_skill in raw_skills:
            name, context = ResumeService._normalize_skill_entry(raw_skill)
            if not name:
                continue
            ResumeService._upsert_skill_context(skill_contexts, name, context)

        experiences: list[dict] = []
        raw_experiences = (
            payload.get("experiences") if isinstance(payload.get("experiences"), list) else []
        )
        for raw_experience in raw_experiences:
            if not isinstance(raw_experience, dict):
                continue

            role = ResumeService._as_required_str(raw_experience.get("role"))
            if not role:
                continue

            skills_used = normalize_skill_names(raw_experience.get("skills_used"))
            for skill in skills_used:
                ResumeService._upsert_skill_context(skill_contexts, skill, "secondary")

            experiences.append(
                {
                    "role": role,
                    "company": ResumeService._as_required_str(raw_experience.get("company")),
                    "start_date": ResumeService._as_required_str(
                        raw_experience.get("start_date")
                    ),
                    "end_date": ResumeService._as_required_str(raw_experience.get("end_date")),
                    "skills_used": skills_used,
                }
            )

        projects: list[dict] = []
        raw_projects = (
            payload.get("projects") if isinstance(payload.get("projects"), list) else []
        )
        for raw_project in raw_projects:
            if not isinstance(raw_project, dict):
                continue

            name = ResumeService._as_required_str(raw_project.get("name"))
            description = ResumeService._as_required_str(raw_project.get("description"))
            skills_used = normalize_skill_names(raw_project.get("skills_used"))

            if not name and not description and not skills_used:
                continue

            for skill in skills_used:
                ResumeService._upsert_skill_context(skill_contexts, skill, "project")

            projects.append(
                {
                    "name": name,
                    "description": description,
                    "start_date": ResumeService._as_required_str(raw_project.get("start_date")),
                    "end_date": ResumeService._as_required_str(raw_project.get("end_date")),
                    "skills_used": skills_used,
                }
            )

        education_rows: list[dict] = []
        raw_education = payload.get("education") if isinstance(payload.get("education"), list) else []
        for raw_item in raw_education:
            if not isinstance(raw_item, dict):
                continue

            institute = ResumeService._as_required_str(raw_item.get("institute"))
            degree_name = ResumeService._as_required_str(raw_item.get("degree_name"))
            branch_name = ResumeService._as_required_str(raw_item.get("branch_name"))
            start_date = ResumeService._as_required_str(raw_item.get("start_date"))
            end_date = ResumeService._as_required_str(raw_item.get("end_date"))
            year_of_passing = ResumeService._derive_year_of_passing(
                raw_year=ResumeService._as_required_str(raw_item.get("year_of_passing")),
                start_date=start_date,
                end_date=end_date,
            )
            gpa = ResumeService._as_required_str(raw_item.get("gpa"))

            if not institute and not degree_name:
                continue

            education_rows.append(
                {
                    "institute": institute,
                    "degree_name": degree_name,
                    "branch_name": branch_name,
                    "start_date": start_date,
                    "end_date": end_date,
                    "year_of_passing": year_of_passing,
                    "gpa": gpa,
                }
            )

        skill_months = calculate_skill_experience_months(experiences)
        skills = [
            {"name": name, "context": context}
            for name, context in sorted(
                skill_contexts.items(),
                key=lambda item: (
                    -(skill_months.get(item[0], 0)),
                    -ResumeService._SKILL_CONTEXT_PRIORITY.get(item[1], 0),
                    item[0],
                ),
            )
        ]

        return {
            "candidate": candidate,
            "skills": skills,
            "experiences": experiences,
            "projects": projects,
            "education": education_rows,
        }

    @staticmethod
    def _normalize_skill_entry(raw_skill: object) -> tuple[str, str]:
        if isinstance(raw_skill, dict):
            name = ResumeService._normalize_skill_name(raw_skill.get("name"))
            context = ResumeService._normalize_skill_context(raw_skill.get("context"))
            return name, context

        if isinstance(raw_skill, str):
            return ResumeService._normalize_skill_name(raw_skill), "mentioned"

        return "", "mentioned"

    @staticmethod
    def _extract_candidate_location(
        payload: dict,
        candidate_payload: dict,
        resume_text: str = "",
    ) -> str:
        # Prefer a parsed/validated location from the AI output (candidate_payload)
        # so we avoid an extra validation call. If not available, fall back to
        # extracting a location directly from the resume text.
        parsed_location = ResumeService._clean_location_value(candidate_payload.get("location"))
        if parsed_location:
            return ResumeService._finalize_location_candidate(parsed_location, resume_text)

        explicit_location = ResumeService._extract_explicit_location_from_text(resume_text)
        if explicit_location:
            return ResumeService._finalize_location_candidate(explicit_location, resume_text)

        raw_location_candidates = [
            candidate_payload.get("location"),
            candidate_payload.get("current_location"),
            candidate_payload.get("city"),
            payload.get("location"),
            payload.get("candidate_location"),
        ]

        structured_candidates: list[str] = []

        for raw_candidate in raw_location_candidates:
            normalized_location = ResumeService._clean_location_value(raw_candidate)
            if normalized_location:
                structured_candidates.append(normalized_location)

        text_candidates = ResumeService._extract_location_candidates_from_text(resume_text)

        deduped_structured_candidates: list[str] = []
        deduped_text_candidates: list[str] = []
        seen_candidates: set[str] = set()
        normalized_candidate_name = ResumeService._normalize_location_text(
            candidate_payload.get("name")
        )

        for location_candidate in structured_candidates + text_candidates:
            candidate_key = ResumeService._normalize_location_text(location_candidate)
            if candidate_key in seen_candidates:
                continue
            if ResumeService._is_name_like_location_candidate(
                candidate_key,
                normalized_candidate_name,
            ):
                continue
            seen_candidates.add(candidate_key)

            if location_candidate in structured_candidates:
                deduped_structured_candidates.append(location_candidate)
            else:
                deduped_text_candidates.append(location_candidate)

        if not deduped_structured_candidates and not deduped_text_candidates:
            return ""

        if deduped_structured_candidates:
            preferred_structured_location = deduped_structured_candidates[0]
            fallback_candidates = (
                deduped_structured_candidates[1:] + deduped_text_candidates
            )
            richer_text_variant = ResumeService._find_richer_location_variant(
                base_location=preferred_structured_location,
                fallback_candidates=fallback_candidates,
                resume_text=resume_text,
            )
            if richer_text_variant:
                return ResumeService._finalize_location_candidate(
                    richer_text_variant,
                    resume_text,
                )
            return ResumeService._finalize_location_candidate(
                preferred_structured_location,
                resume_text,
            )

        deduped_candidates = deduped_text_candidates

        normalized_resume_text = ResumeService._normalize_location_text(resume_text)

        deduped_candidates.sort(
            key=lambda location: (
                ResumeService._location_occurrence_count(
                    location,
                    normalized_resume_text,
                ),
                ResumeService._location_position_score(location, resume_text),
                ResumeService._location_compactness_score(location),
                ResumeService._location_specificity_score(location),
            ),
            reverse=True,
        )

        return ResumeService._finalize_location_candidate(deduped_candidates[0], resume_text)

    @staticmethod
    def _finalize_location_candidate(location: str, resume_text: str) -> str:
        # Clean and return the provided location. Validation is handled by
        # the AI parser in the initial parse_resume call.
        cleaned = ResumeService._clean_location_value(location)
        if not cleaned:
            return ""

        return cleaned

    @staticmethod
    def _is_name_like_location_candidate(
        normalized_candidate_location: str,
        normalized_candidate_name: str,
    ) -> bool:
        if not normalized_candidate_location or not normalized_candidate_name:
            return False

        if normalized_candidate_location == normalized_candidate_name:
            return True

        name_words = normalized_candidate_name.split()
        location_words = normalized_candidate_location.split()
        if len(name_words) < 2:
            return False

        # Reject near-name strings from contact headers, e.g. "First Last" or
        # "First Last City" produced from noisy line splits.
        if location_words[: len(name_words)] == name_words and len(location_words) <= len(name_words) + 1:
            return True

        return False

    @staticmethod
    def _find_richer_location_variant(
        base_location: str,
        fallback_candidates: list[str],
        resume_text: str,
    ) -> str:
        base_normalized = ResumeService._normalize_location_text(base_location)
        if not base_normalized:
            return ""

        base_words = base_normalized.split()
        if len(base_words) > 2:
            return ""

        richer_candidates: list[str] = []
        for candidate in fallback_candidates:
            candidate_normalized = ResumeService._normalize_location_text(candidate)
            if not candidate_normalized or candidate_normalized == base_normalized:
                continue
            if not candidate_normalized.endswith(base_normalized):
                continue

            candidate_words = candidate_normalized.split()
            if len(candidate_words) <= len(base_words):
                continue
            if len(candidate_words) > 8:
                continue

            richer_candidates.append(candidate)

        if not richer_candidates:
            return ""

        normalized_resume_text = ResumeService._normalize_location_text(resume_text)
        richer_candidates.sort(
            key=lambda location: (
                ResumeService._location_occurrence_count(
                    location,
                    normalized_resume_text,
                ),
                ResumeService._location_position_score(location, resume_text),
                ResumeService._location_specificity_score(location),
                ResumeService._location_compactness_score(location),
            ),
            reverse=True,
        )
        return richer_candidates[0]

    @staticmethod
    def _extract_explicit_location_from_text(resume_text: str) -> str:
        if not resume_text:
            return ""

        for match in re.findall(
            r"(?im)^(?:current\s+location|location|address)\s*[:\-]\s*(.+)$",
            resume_text,
        ):
            cleaned = ResumeService._clean_location_value(match)
            if cleaned:
                return cleaned

        return ""

    @staticmethod
    def _clean_location_value(value: object) -> str:
        if isinstance(value, (dict, list, tuple, set)):
            return ""

        text = ResumeService._as_required_str(value)
        if not text:
            return ""

        text = re.sub(
            r"^(?:current\s+location|location|address)\s*[:\-]\s*",
            "",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(r"\s+", " ", text).strip(" ,;-")
        text = ResumeService._strip_company_prefix_from_location(text)

        if not text:
            return ""

        if text.casefold() in {"n/a", "na", "none", "not available", "unknown"}:
            return ""

        if not ResumeService._is_location_candidate_text(text):
            return ""

        return text

    @staticmethod
    def _strip_company_prefix_from_location(text: str) -> str:
        candidate = text.strip(" ,;-")
        if not candidate:
            return ""

        full_match = re.match(
            r"(?i)^(?:at\s+)?(?P<company>.+?)\s*(?:,|\||•|-)\s*(?P<location>[^,|•]+(?:\s*,\s*[^,|•]+)*)$",
            candidate,
        )
        if full_match:
            company_part = full_match.group("company").strip()
            location_part = full_match.group("location").strip(" ,;-")
            if (
                ResumeService._looks_like_company_segment(company_part)
                and ResumeService._is_location_candidate_text(location_part)
            ):
                return location_part

        for separator_pattern in (r"\s*,\s*", r"\s*\|\s*", r"\s*•\s*"):
            parts = [part.strip(" ,;-") for part in re.split(separator_pattern, candidate) if part.strip()]
            if len(parts) < 2:
                continue

            if ResumeService._looks_like_company_segment(parts[0]):
                location_part = ", ".join(parts[1:]).strip(" ,;-")
                if ResumeService._is_location_candidate_text(location_part):
                    return location_part

        return candidate

    @staticmethod
    def _looks_like_company_segment(text: str) -> bool:
        normalized = text.casefold().strip()
        if not normalized:
            return False

        corporate_markers = {
            "pvt",
            "ltd",
            "llc",
            "llp",
            "inc",
            "corp",
            "corporation",
            "company",
            "co",
            "private",
            "limited",
            "technologies",
            "technology",
            "solutions",
            "systems",
            "software",
            "services",
            "labs",
            "consulting",
        }

        tokens = [token.casefold() for token in re.findall(r"[A-Za-z][A-Za-z.&\-]*", text)]
        if not tokens:
            return False

        if any(token.strip(".") in corporate_markers for token in tokens):
            return True

        # Phrases like "at Company Name" in header blocks are likely organization text.
        return normalized.startswith("at ") and len(tokens) >= 2

    @staticmethod
    def _is_location_candidate_text(text: str) -> bool:
        if not text:
            return False

        # Location should be place text, not timeline/date text.
        if ResumeService._looks_like_date_timeline(text):
            return False

        normalized = text.casefold()
        if re.search(r"(?i)\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b", normalized):
            return False

        tokens = re.findall(r"[A-Za-z][A-Za-z.'\-]*", text)
        if len(tokens) < 2:
            return False

        if len(tokens) > 10:
            return False

        # Reject common section-heading style strings.
        if len(tokens) <= 3 and not any(separator in text for separator in {",", "|", "/", "-"}):
            heading_terms = {
                "skills",
                "experience",
                "education",
                "projects",
                "summary",
                "profile",
                "technical",
                "objective",
                "certifications",
                "languages",
                "hobbies",
                "achievements",
            }
            if any(token.casefold() in heading_terms for token in tokens):
                return False

        non_location_terms = {
            "bachelor",
            "master",
            "degree",
            "btech",
            "mtech",
            "phd",
            "skills",
            "experience",
            "project",
            "projects",
            "internship",
            "objective",
            "certification",
            "curriculum",
            "branch",
        }
        if any(token.casefold() in non_location_terms for token in tokens):
            return False

        # Avoid selecting full institute/organization names as candidate location.
        if len(tokens) >= 5 and re.search(
            r"\b(?:university|college|institute|school|department|faculty|campus)\b",
            normalized,
        ):
            return False

        return True

    @staticmethod
    def _extract_location_candidates_from_text(resume_text: str) -> list[str]:
        if not resume_text:
            return []

        candidates: list[str] = []
        normalized_resume_text = ResumeService._normalize_location_text(resume_text)

        for match in re.findall(
            r"(?im)^(?:current\s+location|location|address)\s*[:\-]\s*(.+)$",
            resume_text,
        ):
            cleaned = ResumeService._clean_location_value(match)
            if cleaned:
                candidates.append(cleaned)

        for match in re.findall(
            r"(?i)\b(?:based\s+in|located\s+in)\s+([A-Za-z][A-Za-z ,./\-]{2,})",
            resume_text,
        ):
            cleaned = ResumeService._clean_location_value(match)
            if cleaned:
                candidates.append(cleaned)

        for line_index, raw_line in enumerate(resume_text.splitlines()[:160]):
            line = raw_line.strip()
            if len(line) < 6 or len(line) > 100:
                continue

            lowered = line.casefold()
            if "@" in line or "http" in lowered or "linkedin" in lowered or "github" in lowered:
                continue
            if re.search(r"\b(?:phone|mobile|contact)\b", lowered):
                continue
            if ResumeService._looks_like_date_timeline(line):
                continue

            line_tokens = re.findall(r"[A-Za-z][A-Za-z.'\-]*", line)
            if len(line_tokens) < 2:
                continue

            # Avoid treating short section headings as locations unless the phrase
            # is repeated in the resume. Keep short candidates from the top contact
            # block even when they appear once.
            if len(line_tokens) < 3 and not any(
                separator in line for separator in {",", "|", "/", "-"}
            ):
                cleaned_short_candidate = ResumeService._clean_location_value(line)
                if not cleaned_short_candidate:
                    continue
                if (
                    line_index > 25
                    and
                    ResumeService._location_occurrence_count(
                        cleaned_short_candidate,
                        normalized_resume_text,
                    )
                    < 2
                ):
                    continue

            line_fragments = [line]
            if "|" in line or "•" in line:
                for fragment in re.split(r"\s*(?:\||•)\s*", line):
                    cleaned_fragment = fragment.strip()
                    if cleaned_fragment:
                        line_fragments.append(cleaned_fragment)

            for fragment in line_fragments:
                if ":" in fragment and not re.match(
                    r"(?i)^(?:current\s+location|location|address)\s*[:\-]",
                    fragment,
                ):
                    continue

                cleaned = ResumeService._clean_location_value(fragment)
                if cleaned:
                    candidates.append(cleaned)

        return candidates

    @staticmethod
    def _looks_like_date_timeline(text: str) -> bool:
        normalized = text.casefold()

        year_pattern = r"\b(?:19\d{2}|20\d{2}|21\d{2})\b"
        month_pattern = r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b"

        if re.search(month_pattern, normalized) and re.search(year_pattern, normalized):
            return True

        if re.search(
            rf"{year_pattern}\s*(?:-|–|—|to)\s*(?:{year_pattern}|present|current)",
            normalized,
        ):
            return True

        if re.search(r"\b(?:from|to|till|until)\b", normalized) and re.search(
            year_pattern,
            normalized,
        ):
            return True

        return False

    @staticmethod
    def _location_specificity_score(location: str) -> int:
        normalized = location.casefold().strip()
        if not normalized:
            return 0

        parts = [part.strip() for part in re.split(r"[,/|\-]+", normalized) if part.strip()]
        words = re.findall(r"[a-z]+", normalized)

        score = min(len(parts), 4) * 18 + min(len(words), 7) * 8

        # Penalize very long phrases to avoid selecting institution or section text as location.
        if len(words) > 7:
            score -= (len(words) - 7) * 12

        return max(score, 0)

    @staticmethod
    def _location_compactness_score(location: str) -> int:
        word_count = len(re.findall(r"[A-Za-z]+", location))
        if word_count <= 0:
            return 0

        # Prefer medium-length location strings (typically 3-5 tokens), not very short headers.
        return max(0, 20 - abs(word_count - 4) * 4)

    @staticmethod
    def _normalize_location_text(text: str) -> str:
        normalized = re.sub(r"[^A-Za-z0-9]+", " ", text.casefold())
        return re.sub(r"\s+", " ", normalized).strip()

    @staticmethod
    def _location_occurrence_count(location: str, normalized_resume_text: str) -> int:
        normalized_location = ResumeService._normalize_location_text(location)
        if not normalized_location:
            return 0
        if not normalized_resume_text:
            return 1

        pattern = rf"(?<!\w){re.escape(normalized_location)}(?!\w)"
        count = len(re.findall(pattern, normalized_resume_text))
        return count if count > 0 else 1

    @staticmethod
    def _location_position_score(location: str, resume_text: str) -> int:
        normalized_location = ResumeService._normalize_location_text(location)
        if not normalized_location or not resume_text:
            return 0

        lines = resume_text.splitlines()
        normalized_lines = [ResumeService._normalize_location_text(line) for line in lines]

        for index, normalized_line in enumerate(normalized_lines):
            if not normalized_line:
                continue
            if re.search(rf"(?<!\w){re.escape(normalized_location)}(?!\w)", normalized_line):
                return max(0, 500 - index)

        return 0

    @staticmethod
    def _normalize_skill_name(value: object) -> str:
        if value is None:
            return ""
        return str(value).strip().lower()

    @staticmethod
    def _normalize_skill_context(value: object) -> str:
        context = str(value or "").strip().lower()
        if context not in ResumeService._ALLOWED_SKILL_CONTEXTS:
            return "mentioned"
        return context

    @staticmethod
    def _upsert_skill_context(skill_contexts: dict[str, str], skill: str, context: str) -> None:
        existing = skill_contexts.get(skill)
        if existing is None:
            skill_contexts[skill] = context
            return

        if ResumeService._SKILL_CONTEXT_PRIORITY[context] > ResumeService._SKILL_CONTEXT_PRIORITY[
            existing
        ]:
            skill_contexts[skill] = context

    @staticmethod
    def _latest_company(experiences: list[dict]) -> str | None:
        for experience in experiences:
            company = ResumeService._as_nullable_str(experience.get("company"))
            if company:
                return company
        return None

    @staticmethod
    def _build_summary(
        extraction: dict,
        experience_years: int | None,
        current_company: str | None,
    ) -> str:
        parts: list[str] = []

        if experience_years is not None:
            parts.append(f"{experience_years} years experience")

        highlighted_skills = [
            skill["name"]
            for skill in extraction["skills"]
            if skill["context"] in {"primary", "secondary"}
        ]
        if highlighted_skills:
            parts.append(f"skills: {', '.join(highlighted_skills[:10])}")

        if current_company:
            parts.append(f"latest company: {current_company}")

        role_samples: list[str] = []
        seen_roles: set[str] = set()
        for experience in extraction["experiences"]:
            role = ResumeService._as_nullable_str(experience.get("role"))
            if role and role.lower() not in seen_roles:
                seen_roles.add(role.lower())
                role_samples.append(role)
            if len(role_samples) == 3:
                break

        if role_samples:
            parts.append(f"roles: {', '.join(role_samples)}")

        top_education = extraction["education"][0] if extraction["education"] else None
        if isinstance(top_education, dict):
            degree = ResumeService._as_nullable_str(top_education.get("degree_name"))
            institute = ResumeService._as_nullable_str(top_education.get("institute"))
            if degree and institute:
                parts.append(f"education: {degree} at {institute}")
            elif degree:
                parts.append(f"education: {degree}")

        return ", ".join(parts)

    @staticmethod
    def _education_summary(education_rows: list[dict]) -> tuple[str | None, int | None, float | None]:
        # Prefer educations that have an explicit end date (not open-ended like "present").
        # Include future end_dates (expected to be completed). Choose the one with the latest end_date.
        candidates: list[tuple[date, dict]] = []
        for row in education_rows:
            end_raw = ResumeService._as_nullable_str(row.get("end_date"))
            if not end_raw:
                continue
            # Exclude open-ended dates such as "present", "current", "ongoing"
            if ResumeService._looks_like_open_ended_date(end_raw):
                continue
            parsed = ResumeService._as_nullable_date(end_raw)
            if parsed is None:
                continue
            candidates.append((parsed, row))

        if candidates:
            # pick row with max end_date
            candidates.sort(key=lambda t: t[0], reverse=True)
            chosen_row = candidates[0][1]
            degree = ResumeService._as_nullable_str(chosen_row.get("degree_name"))
            year = ResumeService._as_nullable_int(chosen_row.get("year_of_passing"))
            if year is None:
                year = candidates[0][0].year
            gpa = ResumeService._as_nullable_float(chosen_row.get("gpa"))
            return degree, year, gpa

        # Fallback: return first non-empty degree/year/gpa as before
        for row in education_rows:
            degree = ResumeService._as_nullable_str(row.get("degree_name"))
            year = ResumeService._as_nullable_int(row.get("year_of_passing"))
            gpa = ResumeService._as_nullable_float(row.get("gpa"))
            if degree or year is not None or gpa is not None:
                return degree, year, gpa
        return None, None, None

    @staticmethod
    def _derive_year_of_passing(raw_year: str, start_date: str, end_date: str) -> str:
        normalized_raw_year = ResumeService._as_required_str(raw_year)
        if re.fullmatch(r"\d{4}", normalized_raw_year):
            return normalized_raw_year

        # Do not infer year_of_passing from `start_date` alone. Require an
        # explicit `end_date` (which may be in the future for expected completion).
        end_text = ResumeService._as_required_str(end_date)
        if not end_text:
            return ""

        # Exclude open-ended values like "present" even when end_date is present.
        if ResumeService._looks_like_open_ended_date(end_text):
            return ""

        year_candidates = ResumeService._extract_year_candidates_from_text(
            f"{end_text} {ResumeService._as_required_str(start_date)}"
        )
        if not year_candidates:
            return ""

        return str(max(year_candidates))

    @staticmethod
    def _looks_like_open_ended_date(text: str) -> bool:
        normalized = text.casefold()
        return bool(re.search(r"\b(?:present|current|ongoing|till\s+date|to\s+date)\b", normalized))

    @staticmethod
    def _extract_year_candidates_from_text(text: str) -> list[int]:
        current_year = time.localtime().tm_year
        extracted_years = [int(year) for year in re.findall(r"\b(19\d{2}|20\d{2}|21\d{2})\b", text)]
        return [
            year
            for year in extracted_years
            if 1950 <= year <= current_year + 6
        ]

    @staticmethod
    def _as_required_str(value: object) -> str:
        if value is None:
            return ""
        return str(value).strip()

    @staticmethod
    def _as_nullable_str(value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _as_nullable_int(value: object) -> int | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        try:
            return int(float(text))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _as_nullable_float(value: object) -> float | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        try:
            return float(text)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _as_nullable_date(value: object) -> date | None:
        if value is None:
            return None
        if isinstance(value, date):
            return value

        text = ResumeService._as_required_str(value)
        if not text:
            return None

        return parse_resume_date(text)

    @staticmethod
    def _derive_total_experience_years(
        raw_total_experience: object,
    ) -> int | None:
        direct_years = ResumeService._as_nullable_int(raw_total_experience)
        if direct_years is not None and direct_years >= 0:
            return direct_years

        total_text = ResumeService._as_required_str(raw_total_experience)
        if not total_text:
            return None

        years_months = re.search(
            r"(?i)(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\D*(\d+)\s*(?:months?|mos?)",
            total_text,
        )
        if years_months:
            years = float(years_months.group(1))
            months = int(years_months.group(2))
            return max(0, int(years + (months / 12.0)))

        years_only = re.search(r"(?i)(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)", total_text)
        if years_only:
            return max(0, int(float(years_only.group(1))))

        months_only = re.search(r"(?i)(\d+)\s*(?:months?|mos?)", total_text)
        if months_only:
            return max(0, int(int(months_only.group(1)) / 12))

        # Keep explicit value precedence: when no explicit value is parseable,
        # caller should fall back to derived date ranges.
        return None

    @staticmethod
    def _normalize_email(value: object) -> str | None:
        text = ResumeService._as_nullable_str(value)
        if not text:
            return None
        return text.lower()
