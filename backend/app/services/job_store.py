from threading import Lock
from typing import Any

_job_store: dict[str, dict[str, Any]] = {}
_batch_store: dict[str, dict[str, Any]] = {}
_job_store_lock = Lock()


def set_job(job_id: str, payload: dict[str, Any]) -> None:
    with _job_store_lock:
        existing = _job_store.get(job_id, {})
        _job_store[job_id] = {**existing, **payload, "job_id": job_id}


def get_job(job_id: str) -> dict[str, Any] | None:
    with _job_store_lock:
        payload = _job_store.get(job_id)
        return dict(payload) if payload else None


def list_jobs(limit: int | None = None) -> list[dict[str, Any]]:
    with _job_store_lock:
        jobs = [dict(payload) for payload in _job_store.values()]

    jobs.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    if limit is None:
        return jobs
    return jobs[:limit]


def set_batch(batch_id: str, payload: dict[str, Any]) -> None:
    with _job_store_lock:
        existing = _batch_store.get(batch_id, {"batch_id": batch_id, "job_ids": []})
        existing_job_ids = list(existing.get("job_ids", []))
        merged = {**existing, **payload, "batch_id": batch_id}
        merged["job_ids"] = existing_job_ids
        _batch_store[batch_id] = merged


def add_job_to_batch(batch_id: str, job_id: str) -> None:
    with _job_store_lock:
        batch = _batch_store.get(batch_id, {"batch_id": batch_id, "job_ids": []})
        job_ids = list(batch.get("job_ids", []))
        if job_id not in job_ids:
            job_ids.append(job_id)
        batch["job_ids"] = job_ids
        _batch_store[batch_id] = batch


def get_batch(batch_id: str) -> dict[str, Any] | None:
    with _job_store_lock:
        payload = _batch_store.get(batch_id)
        if not payload:
            return None
        copied = dict(payload)
        copied["job_ids"] = list(payload.get("job_ids", []))
        return copied


def get_batch_jobs(batch_id: str) -> list[dict[str, Any]]:
    with _job_store_lock:
        batch = _batch_store.get(batch_id)
        if not batch:
            return []

        jobs: list[dict[str, Any]] = []
        for job_id in batch.get("job_ids", []):
            payload = _job_store.get(job_id)
            if payload:
                jobs.append(dict(payload))

    jobs.sort(key=lambda item: item.get("created_at", ""))
    return jobs
