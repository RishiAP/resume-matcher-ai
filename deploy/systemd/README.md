Deployment notes — systemd units

Files created:
- deploy/systemd/recruitment-backend.service
- deploy/systemd/recruitment-celery.service
- deploy/systemd/recruitment-frontend.service

Quick install (on server):

1. Copy the files to /etc/systemd/system/:

```bash
sudo cp deploy/systemd/recruitment-backend.service /etc/systemd/system/
sudo cp deploy/systemd/recruitment-celery.service /etc/systemd/system/
sudo cp deploy/systemd/recruitment-frontend.service /etc/systemd/system/
```

2. Edit service files if you need to change `User`, `Group`, or paths (WorkingDirectory/ExecStart).

3. Reload systemd, enable and start services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now recruitment-backend.service
sudo systemctl enable --now recruitment-celery.service
sudo systemctl enable --now recruitment-frontend.service
```

4. Check status and logs:

```bash
sudo systemctl status recruitment-backend.service
sudo journalctl -u recruitment-backend.service -f
```

Notes:
- The backend unit expects a Python virtualenv at `backend/.venv` and `uvicorn` installed there. If your virtualenv path differs, update `ExecStart`.
- The Celery unit sources `CELERY_WORKER_CONCURRENCY` and `CELERY_WORKER_PREFETCH_MULTIPLIER` from `backend/.env` if present. You can customize these or adjust ExecStart flags directly.
- The frontend unit expects you to build (`npm run build`) beforehand and have `npm` and Node available system-wide. Consider using `pm2` instead if you prefer its process management.
- Redis and Nginx are expected to be managed separately by the OS packages (systemd units are provided by apt). Ensure `redis.service` is installed/active if you use Celery with Redis broker.
