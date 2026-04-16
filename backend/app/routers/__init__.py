"""API router modules."""

from .candidates import router as candidates_router
from .matching import router as matching_router
from .requirements import router as requirements_router
from .resume import router as resume_router
from .rate_limit import router as rate_limit_router

__all__ = [
    "candidates_router",
    "matching_router",
    "requirements_router",
    "resume_router",
    "rate_limit_router",
]
