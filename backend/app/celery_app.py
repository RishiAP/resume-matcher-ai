from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "resume_matcher",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks.resume_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    broker_connection_retry=settings.celery_broker_connection_retry,
    broker_connection_retry_on_startup=settings.celery_broker_connection_retry_on_startup,
    worker_concurrency=settings.celery_worker_concurrency,
    worker_prefetch_multiplier=settings.celery_worker_prefetch_multiplier,
)
