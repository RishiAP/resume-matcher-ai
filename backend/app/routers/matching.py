from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    BulkStatusUpdateResponse,
    CandidateRequirementStatusRead,
    MatchResultRead,
    MatchStatusUpdateRequest,
    MatchThresholdStatusRequest,
    RequirementOverviewRead,
)
from app.services.matching_service import MatchingService

router = APIRouter()


@router.post("/{requirement_id}", response_model=list[MatchResultRead])
def run_matching(
    requirement_id: int,
    db: Session = Depends(get_db),
) -> list[MatchResultRead]:
    rows = MatchingService.find_matches(db, requirement_id)
    return [MatchResultRead.model_validate(row) for row in rows]


@router.post("/{requirement_id}/candidates/{candidate_id}", response_model=list[MatchResultRead])
def run_candidate_matching(
    requirement_id: int,
    candidate_id: int,
    db: Session = Depends(get_db),
) -> list[MatchResultRead]:
    rows = MatchingService.find_matches(db, requirement_id, candidate_id=candidate_id)
    return [MatchResultRead.model_validate(row) for row in rows]


@router.get("/{requirement_id}", response_model=list[MatchResultRead])
def get_results(
    requirement_id: int,
    db: Session = Depends(get_db),
) -> list[MatchResultRead]:
    rows = MatchingService.get_results(db, requirement_id)
    return [MatchResultRead.model_validate(row) for row in rows]


@router.patch(
    "/{requirement_id}/candidates/{candidate_id}/status",
    response_model=CandidateRequirementStatusRead,
)
def update_candidate_status(
    requirement_id: int,
    candidate_id: int,
    payload: MatchStatusUpdateRequest,
    db: Session = Depends(get_db),
) -> CandidateRequirementStatusRead:
    row = MatchingService.update_status(
        db,
        requirement_id=requirement_id,
        candidate_id=candidate_id,
        status=payload.status,
    )
    return CandidateRequirementStatusRead.model_validate(row)


@router.post("/{requirement_id}/bulk/reject-zero", response_model=BulkStatusUpdateResponse)
def reject_zero_scores(
    requirement_id: int,
    db: Session = Depends(get_db),
) -> BulkStatusUpdateResponse:
    row = MatchingService.bulk_reject_zero_scores(db, requirement_id=requirement_id)
    return BulkStatusUpdateResponse.model_validate(row)


@router.post("/{requirement_id}/bulk/threshold", response_model=BulkStatusUpdateResponse)
def apply_threshold_status(
    requirement_id: int,
    payload: MatchThresholdStatusRequest,
    db: Session = Depends(get_db),
) -> BulkStatusUpdateResponse:
    row = MatchingService.bulk_set_status_below_threshold(
        db,
        requirement_id=requirement_id,
        threshold=payload.threshold,
        status=payload.status,
    )
    return BulkStatusUpdateResponse.model_validate(row)


@router.get("/overview/{requirement_id}", response_model=RequirementOverviewRead)
def get_requirement_overview(
    requirement_id: int,
    db: Session = Depends(get_db),
) -> RequirementOverviewRead:
    row = MatchingService.get_requirement_overview(db, requirement_id=requirement_id)
    return RequirementOverviewRead.model_validate(row)
