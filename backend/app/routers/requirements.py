from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    RequirementCreate,
    RequirementExtractRequest,
    RequirementExtractResponse,
    RequirementRead,
)
from app.services.requirement_service import RequirementService

router = APIRouter()


@router.get("", response_model=list[RequirementRead])
def list_requirements(db: Session = Depends(get_db)) -> list[RequirementRead]:
    rows = RequirementService.find_all(db)
    return [RequirementRead.model_validate(row) for row in rows]


@router.post("", response_model=RequirementRead)
def create_requirement(
    data: RequirementCreate,
    db: Session = Depends(get_db),
) -> RequirementRead:
    created = RequirementService.create(db, data.model_dump())
    return RequirementRead.model_validate(created)


@router.patch("/{requirement_id}", response_model=RequirementRead)
def update_requirement(
    requirement_id: int,
    data: RequirementCreate,
    db: Session = Depends(get_db),
) -> RequirementRead:
    try:
        updated = RequirementService.update(db, requirement_id, data.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return RequirementRead.model_validate(updated)


@router.post("/extract", response_model=RequirementExtractResponse)
def extract_requirement(data: RequirementExtractRequest) -> RequirementExtractResponse:
    extracted = RequirementService.extract_from_text(data.text)
    validated = RequirementCreate.model_validate(extracted)
    return RequirementExtractResponse(requirement=validated)
