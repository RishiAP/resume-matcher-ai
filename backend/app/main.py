from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routers import candidates, matching, requirements, resume, rate_limit
from app.schemas import ErrorResponse, HealthResponse
from app.services.ai_service import AiRateLimitError

settings = get_settings()

app = FastAPI(title="Recruitment Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resume.router, prefix="/api/resume", tags=["Resume"])
app.include_router(candidates.router, prefix="/api/candidates", tags=["Candidates"])
app.include_router(requirements.router, prefix="/api/requirements", tags=["Requirements"])
app.include_router(matching.router, prefix="/api/matching", tags=["Matching"])
app.include_router(rate_limit.router, prefix="/api/rate-limit", tags=["Rate Limit"])


@app.exception_handler(LookupError)
async def lookup_error_handler(_: Request, exc: LookupError) -> JSONResponse:
    return JSONResponse(status_code=404, content=ErrorResponse(detail=str(exc)).model_dump())


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content=ErrorResponse(detail=str(exc)).model_dump())


@app.exception_handler(AiRateLimitError)
async def ai_rate_limit_error_handler(_: Request, exc: AiRateLimitError) -> JSONResponse:
    return JSONResponse(status_code=429, content=ErrorResponse(detail=str(exc)).model_dump())


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        ai_mode=settings.ai_mode,
        provider=settings.resolved_provider,
        llm_model=settings.resolved_llm_model,
        embed_mode=settings.resolved_embed_mode,
        embed_provider=settings.resolved_embed_provider,
        embed_model=settings.resolved_embed_model,
        embed_dimensions=settings.resolved_embed_dimensions,
    )
