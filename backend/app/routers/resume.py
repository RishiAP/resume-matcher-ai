from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.database import get_db
from app.models import Requirement
from app.schemas import (
    BulkUploadEnqueueResponse,
    QueueJobsStatus,
    ResumeBulkUrlUploadRequest,
    ResumeUrlUploadRequest,
    UploadEnqueueResponse,
)
from app.services.resume_service import ResumeService
from app.tasks.resume_tasks import process_file_task, process_url_task

router = APIRouter()


def _queue_counts() -> QueueJobsStatus:
    inspector = celery_app.control.inspect(timeout=1.0)
    if inspector is None:
        return QueueJobsStatus(running=0, queued=0, workers_online=0)

    try:
        active = inspector.active() or {}
        reserved = inspector.reserved() or {}
        scheduled = inspector.scheduled() or {}
    except Exception:
        active = {}
        reserved = {}
        scheduled = {}

    running = sum(len(tasks) for tasks in active.values())
    queued = sum(len(tasks) for tasks in reserved.values()) + sum(
        len(tasks) for tasks in scheduled.values()
    )
    workers_online = len(set(active.keys()) | set(reserved.keys()) | set(scheduled.keys()))
    return QueueJobsStatus(running=running, queued=queued, workers_online=workers_online)


@router.post("/upload", response_model=UploadEnqueueResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_resume(
    file: UploadFile = File(...),
    requirement_id: int = Form(...),
    db: Session = Depends(get_db),
) -> UploadEnqueueResponse:
    if not file.filename:
        raise ValueError("Uploaded file must include a filename")

    contents = await file.read()
    if not contents:
        raise ValueError("Uploaded file is empty")

    if db.get(Requirement, requirement_id) is None:
        raise ValueError("Requirement not found for the provided requirement_id")

    file_path, _ = ResumeService.save_uploaded_file(contents, file.filename)
    process_file_task.delay(file_path, file.filename, file.content_type or "", requirement_id)
    return UploadEnqueueResponse(status="queued", accepted=1)


@router.post(
    "/upload/bulk",
    response_model=BulkUploadEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_resume_bulk(
    files: list[UploadFile] = File(...),
    requirement_id: int = Form(...),
    db: Session = Depends(get_db),
) -> BulkUploadEnqueueResponse:
    if not files:
        raise ValueError("At least one file is required")

    accepted = 0
    rejected = 0
    errors: list[str] = []

    if db.get(Requirement, requirement_id) is None:
        raise ValueError("Requirement not found for the provided requirement_id")

    for file in files:
        if not file.filename:
            rejected += 1
            errors.append("A file was skipped because filename is missing")
            continue

        contents = await file.read()
        if not contents:
            rejected += 1
            errors.append(f"{file.filename}: uploaded file is empty")
            continue

        file_path, _ = ResumeService.save_uploaded_file(contents, file.filename)
        process_file_task.delay(file_path, file.filename, file.content_type or "", requirement_id)
        accepted += 1

    return BulkUploadEnqueueResponse(
        status="queued",
        accepted=accepted,
        rejected=rejected,
        errors=errors,
    )


@router.post(
    "/upload/url",
    response_model=UploadEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_resume_by_url(
    data: ResumeUrlUploadRequest,
    db: Session = Depends(get_db),
) -> UploadEnqueueResponse:
    if db.get(Requirement, data.requirement_id) is None:
        raise ValueError("Requirement not found for the provided requirement_id")

    process_url_task.delay(str(data.url), data.requirement_id)
    return UploadEnqueueResponse(status="queued", accepted=1)


@router.post(
    "/upload/url/bulk",
    response_model=BulkUploadEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_resume_urls_bulk(
    data: ResumeBulkUrlUploadRequest,
    db: Session = Depends(get_db),
) -> BulkUploadEnqueueResponse:
    accepted = 0

    if db.get(Requirement, data.requirement_id) is None:
        raise ValueError("Requirement not found for the provided requirement_id")

    for url in data.urls:
        process_url_task.delay(str(url), data.requirement_id)
        accepted += 1

    return BulkUploadEnqueueResponse(status="queued", accepted=accepted, rejected=0, errors=[])


@router.get("/jobs", response_model=QueueJobsStatus)
def jobs_overview() -> QueueJobsStatus:
    return _queue_counts()
