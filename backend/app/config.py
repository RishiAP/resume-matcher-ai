from __future__ import annotations

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Database
    database_url: str = Field(alias="DATABASE_URL")

    # Storage + CORS
    upload_path: str = Field(default="/var/www/uploads", alias="UPLOAD_PATH")
    allowed_origins: str = Field(default="http://localhost:3000", alias="ALLOWED_ORIGINS")

    # Queueing
    celery_broker_url: str = Field(default="redis://localhost:6379/0", alias="CELERY_BROKER_URL")
    celery_result_backend: str = Field(
        default="redis://localhost:6379/1",
        alias="CELERY_RESULT_BACKEND",
    )
    celery_broker_connection_retry: bool = Field(
        default=True,
        alias="CELERY_BROKER_CONNECTION_RETRY",
    )
    celery_broker_connection_retry_on_startup: bool = Field(
        default=True,
        alias="CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP",
    )
    celery_worker_concurrency: int = Field(
        default=1,
        ge=1,
        alias="CELERY_WORKER_CONCURRENCY",
    )
    celery_worker_prefetch_multiplier: int = Field(
        default=1,
        ge=1,
        alias="CELERY_WORKER_PREFETCH_MULTIPLIER",
    )
    celery_ai_rate_limit_max_retries: int = Field(
        default=3,
        ge=0,
        alias="CELERY_AI_RATE_LIMIT_MAX_RETRIES",
    )
    celery_ai_rate_limit_retry_delay_seconds: int = Field(
        default=300,
        ge=1,
        alias="CELERY_AI_RATE_LIMIT_RETRY_DELAY_SECONDS",
    )
    celery_ai_rate_limit_retry_delay_max_seconds: int = Field(
        default=1800,
        ge=1,
        alias="CELERY_AI_RATE_LIMIT_RETRY_DELAY_MAX_SECONDS",
    )
    
    # Token rate limiting
    token_limit_per_minute: int = Field(
        default=10000,
        ge=1,
        alias="TOKEN_LIMIT_PER_MINUTE",
    )
    token_limit_per_day: int = Field(
        default=100000,
        ge=1,
        alias="TOKEN_LIMIT_PER_DAY",
    )
    request_limit_per_minute: int = Field(
        default=3,
        ge=1,
        alias="REQUEST_LIMIT_PER_MINUTE",
    )
    request_limit_per_day: int = Field(
        default=100,
        ge=1,
        alias="REQUEST_LIMIT_PER_DAY",
    )

    # Authentication / tokens
    secret_key: str = Field(default="please-set-a-secret-key", alias="SECRET_KEY")
    access_token_expire_minutes: int = Field(
        default=15,
        ge=1,
        alias="ACCESS_TOKEN_EXPIRE_MINUTES",
    )
    refresh_token_expire_days: int = Field(
        default=30,
        ge=1,
        alias="REFRESH_TOKEN_EXPIRE_DAYS",
    )
    refresh_token_cookie_name: str = Field(
        default="refresh_token",
        alias="REFRESH_TOKEN_COOKIE_NAME",
    )
    refresh_token_cookie_secure: bool = Field(
        default=False,
        alias="REFRESH_TOKEN_COOKIE_SECURE",
    )
    refresh_token_cookie_samesite: str = Field(
        default="lax",
        alias="REFRESH_TOKEN_COOKIE_SAMESITE",
    )

    # AI provider toggle
    ai_mode: str = Field(default="local", alias="AI_MODE")

    # Local LLM mode (Ollama)
    ollama_base_url: str = Field(default="http://localhost:11434/v1", alias="OLLAMA_BASE_URL")
    ollama_llm_model: str = Field(default="llama3.1:8b", alias="OLLAMA_LLM_MODEL")

    # API LLM mode
    ai_api_base_url: str = Field(default="", alias="AI_API_BASE_URL")
    ai_api_llm_model: str = Field(default="", alias="AI_API_LLM_MODEL")
    ai_api_key: str = Field(default="", alias="AI_API_KEY")

    # Embedding toggle (independent from AI_MODE)
    embed_mode: str = Field(default="local", alias="EMBED_MODE")
    embed_dimensions: int = Field(default=384, alias="EMBED_DIMENSIONS")

    # Local embeddings (Hugging Face)
    local_embed_model: str = Field(
        default="all-MiniLM-L6-v2",
        alias="LOCAL_EMBED_MODEL",
    )
    local_embed_device: str = Field(default="cpu", alias="LOCAL_EMBED_DEVICE")

    # API embeddings
    ai_api_embed_base_url: str = Field(default="http://localhost:11434/v1", alias="AI_API_EMBED_BASE_URL")
    ai_api_embed_model: str = Field(default="nomic-embed-text", alias="AI_API_EMBED_MODEL")
    ai_api_embed_key: str = Field(default="", alias="AI_API_EMBED_KEY")

    # Resolved values used by services
    resolved_llm_base_url: str = ""
    resolved_llm_model: str = ""
    resolved_llm_key: str = ""
    resolved_embed_base_url: str = ""
    resolved_embed_model: str = ""
    resolved_embed_key: str = ""
    resolved_embed_dimensions: int = 384
    resolved_embed_mode: str = "local"
    resolved_embed_provider: str = "huggingface"
    resolved_provider: str = ""

    @model_validator(mode="after")
    def resolve_ai_config(self) -> "Settings":
        mode = self.ai_mode.strip().lower()
        if mode not in {"local", "api"}:
            raise ValueError("AI_MODE must be 'local' or 'api'")
        self.ai_mode = mode

        if mode == "local":
            self.resolved_llm_base_url = self.ollama_base_url
            self.resolved_llm_model = self.ollama_llm_model
            self.resolved_llm_key = "ollama"
            self.resolved_provider = "ollama"
        else:
            if not self.ai_api_base_url or not self.ai_api_llm_model or not self.ai_api_key:
                raise ValueError(
                    "AI_MODE=api requires AI_API_BASE_URL, AI_API_LLM_MODEL, and AI_API_KEY"
                )
            self.resolved_llm_base_url = self.ai_api_base_url
            self.resolved_llm_model = self.ai_api_llm_model
            self.resolved_llm_key = self.ai_api_key
            self.resolved_provider = self._provider_from_url(self.ai_api_base_url, default="openai")

        embed_mode = self.embed_mode.strip().lower()
        if embed_mode not in {"local", "api"}:
            raise ValueError("EMBED_MODE must be 'local' or 'api'")
        self.embed_mode = embed_mode
        self.resolved_embed_mode = embed_mode

        if embed_mode == "local":
            self.resolved_embed_base_url = ""
            self.resolved_embed_model = self.local_embed_model
            self.resolved_embed_key = ""
            self.resolved_embed_dimensions = self.embed_dimensions
            self.resolved_embed_provider = "huggingface"
            return self

        if not self.ai_api_embed_base_url or not self.ai_api_embed_model:
            raise ValueError(
                "EMBED_MODE=api requires AI_API_EMBED_BASE_URL and AI_API_EMBED_MODEL"
            )

        self.resolved_embed_base_url = self.ai_api_embed_base_url
        self.resolved_embed_model = self.ai_api_embed_model
        self.resolved_embed_key = self.ai_api_embed_key
        self.resolved_embed_dimensions = self.embed_dimensions
        self.resolved_embed_provider = self._provider_from_url(
            self.ai_api_embed_base_url,
            default="openai",
        )

        return self

    @staticmethod
    def _provider_from_url(url: str, default: str) -> str:
        lowered = url.lower()
        if "groq" in lowered:
            return "groq"
        if "googleapis" in lowered or "gemini" in lowered:
            return "gemini"
        if "ollama" in lowered or "11434" in lowered:
            return "ollama"
        if "openai" in lowered:
            return "openai"
        return default

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
