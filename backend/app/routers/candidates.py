from typing import Literal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import CandidateRead, CandidateUpdate, HRCommentRead, HRCommentWrite
from app.services.candidate_service import CandidateService

router = APIRouter()


@router.get("", response_model=list[CandidateRead])
def list_candidates(
    skills: Annotated[list[str] | None, Query()] = None,
    min_exp: int | None = None,
    max_exp: int | None = None,
    location: str | None = None,
    skill_experience: Annotated[list[str] | None, Query()] = None,
    role_experience: Annotated[list[str] | None, Query()] = None,
    skill_match_mode: Literal["all", "any"] = "all",
    comment_order: Literal["desc", "asc"] = "desc",
    requirement_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[CandidateRead]:
    rows = CandidateService.find_all(
        db,
        skills,
        min_exp,
        max_exp,
        location,
        skill_experience,
        role_experience,
        skill_match_mode,
        comment_order,
        requirement_id,
    )
    return [CandidateRead.model_validate(row) for row in rows]


@router.patch("/{candidate_id}", response_model=CandidateRead)
def update_candidate(
    candidate_id: int,
    updates: CandidateUpdate,
    db: Session = Depends(get_db),
) -> CandidateRead:
    updated = CandidateService.update(
        db=db,
        candidate_id=candidate_id,
        updates=updates.model_dump(exclude_unset=True),
    )
    return CandidateRead.model_validate(updated)


@router.post("/{candidate_id}/comments", response_model=HRCommentRead)
def add_candidate_comment(
    candidate_id: int,
    payload: HRCommentWrite,
    db: Session = Depends(get_db),
) -> HRCommentRead:
    created = CandidateService.add_comment(
        db=db,
        candidate_id=candidate_id,
        comment=payload.comment,
    )
    return HRCommentRead.model_validate(created)


@router.patch("/{candidate_id}/comments/{comment_id}", response_model=HRCommentRead)
def update_candidate_comment(
    candidate_id: int,
    comment_id: int,
    payload: HRCommentWrite,
    db: Session = Depends(get_db),
) -> HRCommentRead:
    updated = CandidateService.update_comment(
        db=db,
        candidate_id=candidate_id,
        comment_id=comment_id,
        comment=payload.comment,
    )
    return HRCommentRead.model_validate(updated)
