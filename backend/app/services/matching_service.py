from decimal import Decimal
from typing import Literal

from sqlalchemy import func
from sqlalchemy import text
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Candidate,
    CandidateSkill,
    CandidateStatus,
    CandidateStatusEnum,
    MatchResult,
    Requirement,
    RequirementSkill,
)
from app.services.ai_service import AiService


class MatchingService:
    @staticmethod
    def _status_value(value: str | CandidateStatusEnum | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, CandidateStatusEnum):
            return value.value
        return str(value)

    @staticmethod
    def find_matches(
        db: Session,
        requirement_id: int,
        candidate_id: int | None = None,
        match_all: bool = False,
    ) -> list[dict]:
        requirement = (
            db.query(Requirement)
            .options(
                selectinload(Requirement.skill_requirements).selectinload(RequirementSkill.skill)
            )
            .filter(Requirement.id == requirement_id)
            .first()
        )
        if not requirement:
            raise LookupError(f"Requirement {requirement_id} not found")

        if candidate_id is not None:
            candidate = db.get(Candidate, candidate_id)
            if not candidate:
                raise LookupError(f"Candidate {candidate_id} not found")

            status_link = (
                db.query(CandidateStatus)
                .filter(
                    CandidateStatus.requirement_id == requirement_id,
                    CandidateStatus.candidate_id == candidate_id,
                )
                .first()
            )
            if (
                not status_link
                or MatchingService._status_value(status_link.status) != CandidateStatusEnum.NEW.value
            ):
                raise ValueError(
                    "Matching can only run for candidates whose status is 'new' for this requirement"
                )

        req_summary = MatchingService._build_req_summary(requirement)
        req_embedding = AiService.generate_embedding(req_summary or requirement.title)
        embedding_str = "[" + ",".join(str(value) for value in req_embedding) + "]"

        requirement.summary_text = req_summary
        requirement.embedding = req_embedding
        db.flush()

        required_skill_links = [
            link for link in (requirement.skill_requirements or []) if link.skill is not None
        ]
        required_skill_links.sort(key=lambda item: (item.skill.name.lower(), item.id or 0))
        required_skill_names = [link.skill.name for link in required_skill_links]

        if candidate_id is None:
            if match_all:
                # All candidates are eligible when match_all is requested
                eligible_candidate_ids = [row[0] for row in db.execute(text("SELECT id FROM candidate")).fetchall()]
            else:
                # Only candidates who have been linked to this requirement with status 'new'
                eligible_candidate_ids = [
                    row.id
                    for row in db.execute(
                        text(
                            """
                            SELECT c.id
                            FROM candidate c
                            JOIN candidate_status cs
                              ON cs.candidate_id = c.id
                             AND cs.requirement_id = :requirement_id
                             AND cs.status = 'new'
                            """
                        ),
                        {"requirement_id": requirement_id},
                    ).fetchall()
                ]
        else:
            eligible_candidate_ids = [candidate_id]

        if not eligible_candidate_ids:
            db.commit()
            return MatchingService.get_results(db, requirement_id)

        keyword_query = " ".join(required_skill_names).strip()
        kw_rows = []
        if keyword_query and candidate_id is None:
            if match_all:
                kw_rows = db.execute(
                    text(
                        """
                        SELECT c.id,
                            ROW_NUMBER() OVER (
                                ORDER BY ts_rank(
                                    (
                                        to_tsvector('english', COALESCE(c.summary_text, '')) ||
                                        to_tsvector('english', COALESCE(string_agg(s.name, ' '), ''))
                                    ),
                                    plainto_tsquery('english', :query)
                                ) DESC
                            ) AS kw_rank
                        FROM candidate c
                        LEFT JOIN candidate_skill cs ON cs.candidate_id = c.id
                        LEFT JOIN skill s ON s.id = cs.skill_id
                        GROUP BY c.id, c.summary_text
                        HAVING (
                            to_tsvector('english', COALESCE(c.summary_text, '')) ||
                            to_tsvector('english', COALESCE(string_agg(s.name, ' '), ''))
                        ) @@ plainto_tsquery('english', :query)
                        """
                    ),
                    {"query": keyword_query},
                ).fetchall()
            else:
                # Rank only candidates whose status for this requirement is 'new'
                kw_rows = db.execute(
                    text(
                        """
                        SELECT c.id,
                            ROW_NUMBER() OVER (
                                ORDER BY ts_rank(
                                    (
                                        to_tsvector('english', COALESCE(c.summary_text, '')) ||
                                        to_tsvector('english', COALESCE(string_agg(s.name, ' '), ''))
                                    ),
                                    plainto_tsquery('english', :query)
                                ) DESC
                            ) AS kw_rank
                        FROM candidate c
                        JOIN candidate_status cst
                          ON cst.candidate_id = c.id
                         AND cst.requirement_id = :requirement_id
                         AND cst.status = 'new'
                        LEFT JOIN candidate_skill cs ON cs.candidate_id = c.id
                        LEFT JOIN skill s ON s.id = cs.skill_id
                        GROUP BY c.id, c.summary_text
                        HAVING (
                            to_tsvector('english', COALESCE(c.summary_text, '')) ||
                            to_tsvector('english', COALESCE(string_agg(s.name, ' '), ''))
                        ) @@ plainto_tsquery('english', :query)
                        """
                    ),
                    {"query": keyword_query, "requirement_id": requirement_id},
                ).fetchall()

        vec_rows = []
        if candidate_id is None:
            if match_all:
                # Vector ranking among all candidates (with embeddings)
                vec_rows = db.execute(
                    text(
                        """
                        SELECT c.id,
                            ROW_NUMBER() OVER (
                                ORDER BY c.embedding <=> CAST(:emb AS vector)
                            ) AS vec_rank
                        FROM candidate c
                        WHERE c.embedding IS NOT NULL
                        ORDER BY c.embedding <=> CAST(:emb AS vector)
                        LIMIT 200
                        """
                    ),
                    {"emb": embedding_str},
                ).fetchall()
            else:
                # Vector ranking among candidates in 'new' status for this requirement
                vec_rows = db.execute(
                    text(
                        """
                        SELECT c.id,
                            ROW_NUMBER() OVER (
                                ORDER BY c.embedding <=> CAST(:emb AS vector)
                            ) AS vec_rank
                        FROM candidate c
                        JOIN candidate_status cst
                          ON cst.candidate_id = c.id
                         AND cst.requirement_id = :requirement_id
                         AND cst.status = 'new'
                        WHERE c.embedding IS NOT NULL
                        ORDER BY c.embedding <=> CAST(:emb AS vector)
                        LIMIT 200
                        """
                    ),
                    {"emb": embedding_str, "requirement_id": requirement_id},
                ).fetchall()

        rrf: dict[int, float] = {}
        for row in kw_rows:
            rrf[row.id] = rrf.get(row.id, 0.0) + 1 / (60 + row.kw_rank)
        for row in vec_rows:
            rrf[row.id] = rrf.get(row.id, 0.0) + 1 / (60 + row.vec_rank)

        rerank_candidate_ids = set(eligible_candidate_ids)
        if candidate_id is None:
            rerank_candidate_ids = set(
                sorted(rrf.keys(), key=lambda cid: rrf[cid], reverse=True)[:25]
            )

        candidates = (
            db.query(Candidate)
            .options(selectinload(Candidate.skill_links).selectinload(CandidateSkill.skill))
            .filter(Candidate.id.in_(eligible_candidate_ids))
            .all()
        )
        candidates.sort(key=lambda row: row.id)

        existing_results = (
            db.query(MatchResult)
            .filter(MatchResult.requirement_id == requirement_id)
            .filter(MatchResult.candidate_id.in_(eligible_candidate_ids))
            .all()
        )
        existing_result_map = {row.candidate_id: row for row in existing_results}

        req_dict = {
            "title": requirement.title,
            "skills": [
                {
                    "name": link.skill.name,
                    "min_experience_years": (
                        round(link.min_experience_months / 12, 2)
                        if link.min_experience_months is not None
                        else None
                    ),
                }
                for link in required_skill_links
            ],
            "min_experience": requirement.min_experience,
            "max_experience": requirement.max_experience,
            "location": requirement.location,
            "qualification": getattr(requirement, "qualification", None),
            "notes": requirement.notes,
        }

        for candidate in candidates:
            if candidate.id in rerank_candidate_ids:
                ranked = AiService.rerank_candidate(
                    requirement=req_dict,
                    candidate={
                        "skills": [
                            link.skill.name
                            for link in (candidate.skill_links or [])
                            if link.skill is not None
                        ],
                        "experience_years": candidate.experience_years,
                        "location": candidate.location,
                        "current_company": candidate.current_company,
                    },
                )
                ranked_score = MatchingService._to_float(ranked.get("score"))
                reason = str(ranked.get("reason") or "No reason provided")
            else:
                ranked_score = 0.0
                reason = "No significant requirement-skill overlap identified"

            existing = existing_result_map.get(candidate.id)
            if existing:
                existing.score = ranked_score
                existing.reason = reason
                existing.rrf_score = rrf.get(candidate.id, 0.0)
            else:
                db.add(
                    MatchResult(
                        requirement_id=requirement_id,
                        candidate_id=candidate.id,
                        score=ranked_score,
                        reason=reason,
                        rrf_score=rrf.get(candidate.id, 0.0),
                    )
                )

        db.commit()
        return MatchingService.get_results(db, requirement_id)

    @staticmethod
    def get_results(db: Session, requirement_id: int) -> list[dict]:
        requirement = db.get(Requirement, requirement_id)
        if not requirement:
            raise LookupError(f"Requirement {requirement_id} not found")

        rows = (
            db.query(MatchResult, Candidate)
            .options(selectinload(Candidate.skill_links).selectinload(CandidateSkill.skill))
            .join(Candidate, MatchResult.candidate_id == Candidate.id)
            .filter(MatchResult.requirement_id == requirement_id)
            .order_by(MatchResult.score.desc(), MatchResult.candidate_id.asc())
            .all()
        )

        status_map = {
            row.candidate_id: MatchingService._status_value(row.status)
            for row in db.query(CandidateStatus)
            .filter(CandidateStatus.requirement_id == requirement_id)
            .all()
        }

        return [
            {
                "candidate": {
                    "id": candidate.id,
                    "name": candidate.name,
                    "email": candidate.email,
                    "location": candidate.location,
                    "experience_years": candidate.experience_years,
                    "skills": [
                        link.skill.name
                        for link in (candidate.skill_links or [])
                        if link.skill is not None
                    ],
                    "current_company": candidate.current_company,
                    "resume_url": candidate.resume_url,
                },
                "requirement": {
                    "id": requirement.id,
                    "title": requirement.title,
                },
                "score": MatchingService._to_float(match.score),
                "reason": match.reason or "",
                # When a candidate has no CandidateStatus for this requirement, report
                # that they have not applied rather than defaulting to 'new'. This
                # keeps matching results consistent with listing behavior.
                "status": status_map.get(candidate.id, "not_applied"),
            }
            for match, candidate in rows
        ]

    @staticmethod
    def update_status(
        db: Session,
        requirement_id: int,
        candidate_id: int,
        status: Literal["new", "processing", "rejected", "hired"],
    ) -> dict:
        requirement = db.get(Requirement, requirement_id)
        if not requirement:
            raise LookupError(f"Requirement {requirement_id} not found")

        candidate = db.get(Candidate, candidate_id)
        if not candidate:
            raise LookupError(f"Candidate {candidate_id} not found")

        match_result = (
            db.query(MatchResult)
            .filter(
                MatchResult.requirement_id == requirement_id,
                MatchResult.candidate_id == candidate_id,
            )
            .first()
        )
        if not match_result:
            raise ValueError(
                "Status can only be set when a matching score exists for this candidate and requirement"
            )

        existing_status = (
            db.query(CandidateStatus)
            .filter(
                CandidateStatus.requirement_id == requirement_id,
                CandidateStatus.candidate_id == candidate_id,
            )
            .first()
        )

        if existing_status:
            existing_status.status = status
        else:
            db.add(
                CandidateStatus(
                    requirement_id=requirement_id,
                    candidate_id=candidate_id,
                    status=status,
                )
            )

        db.commit()
        return {
            "candidate_id": candidate_id,
            "requirement_id": requirement_id,
            "status": status,
        }

    @staticmethod
    def bulk_reject_zero_scores(db: Session, requirement_id: int) -> dict:
        requirement = db.get(Requirement, requirement_id)
        if not requirement:
            raise LookupError(f"Requirement {requirement_id} not found")

        candidate_ids = [
            row.candidate_id
            for row in db.query(MatchResult)
            .filter(MatchResult.requirement_id == requirement_id)
            .filter(func.coalesce(MatchResult.score, 0) <= 0)
            .all()
        ]

        updated = MatchingService._bulk_set_status(
            db=db,
            requirement_id=requirement_id,
            candidate_ids=candidate_ids,
            status="rejected",
        )
        return {
            "requirement_id": requirement_id,
            "updated_count": updated,
            "status": "rejected",
        }

    @staticmethod
    def bulk_set_status_below_threshold(
        db: Session,
        requirement_id: int,
        threshold: float,
        status: Literal["processing", "rejected", "hired"],
    ) -> dict:
        requirement = db.get(Requirement, requirement_id)
        if not requirement:
            raise LookupError(f"Requirement {requirement_id} not found")

        candidate_ids = [
            row.candidate_id
            for row in db.query(MatchResult)
            .filter(MatchResult.requirement_id == requirement_id)
            .filter(func.coalesce(MatchResult.score, 0) < threshold)
            .all()
        ]

        updated = MatchingService._bulk_set_status(
            db=db,
            requirement_id=requirement_id,
            candidate_ids=candidate_ids,
            status=status,
        )
        return {
            "requirement_id": requirement_id,
            "updated_count": updated,
            "status": status,
        }

    @staticmethod
    def get_requirement_overview(db: Session, requirement_id: int) -> dict:
        requirement = db.get(Requirement, requirement_id)
        if not requirement:
            raise LookupError(f"Requirement {requirement_id} not found")

        total_candidates = (
            db.query(func.count(MatchResult.id))
            .filter(MatchResult.requirement_id == requirement_id)
            .scalar()
            or 0
        )

        grouped_counts = {
            MatchingService._status_value(row.status) or "": row.count
            for row in db.query(
                CandidateStatus.status,
                func.count(CandidateStatus.id).label("count"),
            )
            .filter(CandidateStatus.requirement_id == requirement_id)
            .group_by(CandidateStatus.status)
            .all()
        }

        rejected = int(grouped_counts.get("rejected", 0))
        hired = int(grouped_counts.get("hired", 0))
        processing = int(grouped_counts.get("processing", 0))

        return {
            "requirement_id": requirement_id,
            "total_current_candidates": max(total_candidates - rejected - hired - processing, 0),
            "total_rejected_candidates": rejected,
            "total_hired_candidates": hired,
            "total_processing_candidates": processing,
        }

    @staticmethod
    def _bulk_set_status(
        db: Session,
        requirement_id: int,
        candidate_ids: list[int],
        status: Literal["processing", "rejected", "hired"],
    ) -> int:
        unique_candidate_ids = sorted(set(candidate_ids))
        if not unique_candidate_ids:
            return 0

        existing_rows = (
            db.query(CandidateStatus)
            .filter(CandidateStatus.requirement_id == requirement_id)
            .filter(CandidateStatus.candidate_id.in_(unique_candidate_ids))
            .all()
        )
        existing_map = {row.candidate_id: row for row in existing_rows}

        for cid in unique_candidate_ids:
            existing = existing_map.get(cid)
            if existing:
                existing.status = status
            else:
                db.add(
                    CandidateStatus(
                        requirement_id=requirement_id,
                        candidate_id=cid,
                        status=status,
                    )
                )

        db.commit()
        return len(unique_candidate_ids)

    @staticmethod
    def _to_float(value: Decimal | float | int | None) -> float:
        if value is None:
            return 0.0
        return float(value)

    @staticmethod
    def _build_req_summary(requirement: Requirement) -> str:
        parts: list[str] = []

        # Skills (highest priority)
        skill_parts: list[str] = []
        for link in sorted(
            [item for item in (requirement.skill_requirements or []) if item.skill is not None],
            key=lambda item: (item.skill.name.lower(), item.id or 0),
        ):
            if link.min_experience_months is not None:
                years = round(link.min_experience_months / 12, 2)
                skill_parts.append(f"{link.skill.name} ({years}+ years)")
            else:
                skill_parts.append(link.skill.name)

        if skill_parts:
            parts.append(f"skills (highest priority): {', '.join(skill_parts)}")

        # Role / title
        if requirement.title:
            parts.append(f"role: {requirement.title}")

        # Experience band
        min_exp = requirement.min_experience
        max_exp = requirement.max_experience
        if min_exp is not None and max_exp is not None:
            parts.append(f"experience: {min_exp}-{max_exp} years")
        elif min_exp is not None:
            parts.append(f"experience: at least {min_exp} years")
        elif max_exp is not None:
            parts.append(f"experience: up to {max_exp} years")

        # Qualification (lowest priority)
        if getattr(requirement, "qualification", None):
            parts.append(f"qualification (lowest priority): {requirement.qualification}")

        if requirement.location:
            parts.append(f"location: {requirement.location}")

        if requirement.notes:
            parts.append(f"notes: {requirement.notes}")

        return "; ".join(parts)
