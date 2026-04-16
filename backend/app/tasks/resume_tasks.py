from celery.exceptions import MaxRetriesExceededError

from app.celery_app import celery_app
from app.config import get_settings
from app.services.ai_service import AiRateLimitError
from app.services.resume_service import ResumeService

settings = get_settings()


def _rate_limit_countdown_seconds(exc: AiRateLimitError) -> int:
    delay = exc.retry_after_seconds or settings.celery_ai_rate_limit_retry_delay_seconds
    return max(1, min(delay, settings.celery_ai_rate_limit_retry_delay_max_seconds))


@celery_app.task(
    name="resume.process_file",
    bind=True
)
def process_file_task(
    self,
    file_path: str,
    original_filename: str,
    content_type: str,
    requirement_id: int | None = None,
) -> dict:
    try:
        candidate_id = ResumeService.process_saved_file(
            file_path=file_path,
            original_filename=original_filename,
            content_type=content_type,
            requirement_id=requirement_id,
        )
        return {"status": "completed", "candidate_id": candidate_id}
    except AiRateLimitError as exc:
        countdown_seconds = _rate_limit_countdown_seconds(exc)
        try:
            raise self.retry(
                exc=exc,
                countdown=countdown_seconds,
                max_retries=settings.celery_ai_rate_limit_max_retries,
            )
        except MaxRetriesExceededError as retry_exc:
            raise ValueError(
                "Resume processing failed after retry attempts because AI provider rate limit "
                "was still active. Please retry later or increase provider quota."
            ) from retry_exc


@celery_app.task(
    name="resume.process_url",
    bind=True
)
def process_url_task(self, url: str, requirement_id: int | None = None) -> dict:
    try:
        candidate_id = ResumeService.process_from_url(url, requirement_id=requirement_id)
        return {"status": "completed", "candidate_id": candidate_id}
    except AiRateLimitError as exc:
        countdown_seconds = _rate_limit_countdown_seconds(exc)
        try:
            raise self.retry(
                exc=exc,
                countdown=countdown_seconds,
                max_retries=settings.celery_ai_rate_limit_max_retries,
            )
        except MaxRetriesExceededError as retry_exc:
            raise ValueError(
                "Resume URL processing failed after retry attempts because AI provider rate "
                "limit was still active. Please retry later or increase provider quota."
            ) from retry_exc
