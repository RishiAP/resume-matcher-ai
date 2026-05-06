from typing import Literal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    CandidateRead,
    CandidateUpdate,
    CandidateNotesUpdate,
    CandidateSkillRead,
    SkillPreferenceUpdate,
    InterviewRead,
    # request models
    InterviewCreate,
    InterviewUpdate,
)
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


@router.post("/{candidate_id}/interviews", response_model=InterviewRead)
def create_candidate_interview(
    candidate_id: int,
    payload: InterviewCreate,
    db: Session = Depends(get_db),
) -> InterviewRead:
    created = CandidateService.create_interview(
        db=db,
        candidate_id=candidate_id,
        interview_date=payload.interview_date,
        interview_time=payload.interview_time,
        comment=payload.comment,
    )
    return InterviewRead.model_validate(created)


@router.patch("/{candidate_id}/interviews/{interview_id}", response_model=InterviewRead)
def update_candidate_interview(
    candidate_id: int,
    interview_id: int,
    payload: InterviewUpdate,
    db: Session = Depends(get_db),
) -> InterviewRead:
    updated = CandidateService.update_interview(
        db=db,
        candidate_id=candidate_id,
        interview_id=interview_id,
        interview_date=payload.interview_date,
        interview_time=payload.interview_time,
        comment=payload.comment,
    )
    return InterviewRead.model_validate(updated)


@router.patch("/{candidate_id}/notes", response_model=CandidateRead)
def update_candidate_notes(
    candidate_id: int,
    payload: CandidateNotesUpdate,
    db: Session = Depends(get_db),
) -> CandidateRead:
    try:
        updated = CandidateService.update_notes(
            db=db,
            candidate_id=candidate_id,
            notes=payload.notes,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return CandidateRead.model_validate(updated)


@router.patch(
    "/{candidate_id}/skills/preference",
    response_model=CandidateSkillRead,
)
def update_skill_preference(
    candidate_id: int,
    skill_name: str,
    payload: SkillPreferenceUpdate,
    db: Session = Depends(get_db),
) -> CandidateSkillRead:
    try:
        updated = CandidateService.update_skill_preference(
            db=db,
            candidate_id=candidate_id,
            skill_name=skill_name,
            preference=payload.preference,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return CandidateSkillRead.model_validate(updated)
