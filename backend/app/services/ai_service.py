import json
import math
import re
import time
from json import JSONDecodeError
from typing import TYPE_CHECKING

from openai import OpenAI, OpenAIError

from app.config import get_settings
from app.services.token_tracker import adaptive_rate_limiter

settings = get_settings()

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer


class AiRateLimitError(RuntimeError):
    def __init__(self, message: str, retry_after_seconds: int | None = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class AiService:
    """Provider-agnostic AI service using resolved settings."""

    _llm_client = OpenAI(
        base_url=settings.resolved_llm_base_url,
        api_key=settings.resolved_llm_key,
    )
    _embed_client = (
        OpenAI(
            base_url=settings.resolved_embed_base_url,
            api_key=settings.resolved_embed_key,
        )
        if settings.resolved_embed_mode == "api"
        else None
    )
    _local_embedder: "SentenceTransformer | None" = None

    @classmethod
    def parse_resume(cls, text: str) -> dict:
        system_prompt = """Extract resume → STRICT JSON only.

Rules:
- Missing → "" or []
- No guessing
- Keep roles, companies, dates exactly

Location: real place only (city/state/country), no org names, else ""
Email/Phone: exact
Skills: lowercase, deduplicated, context = primary|secondary|project|mentioned
Experiences: separate, no merge, skills_used only if explicit
Projects: only if clear

Education:
- Split strictly
- "B.Tech in CS" → degree_name="B.Tech", branch_name="CS"
- degree_name must NOT contain specialization or words like "in/of"
- branch_name must NOT contain degree words
- year_of_passing only if explicit (dont calculate from dates) else ""

Total Experience:
- Use only if explicitly mentioned in resume
- Do NOT calculate from dates
- If not explicitly mentioned → ""

Schema:
{
  "candidate": {"name": "", "email": "", "phone": "", "location": "", "total_experience_years": ""},
  "skills": [{"name": "", "context": "primary|secondary|project|mentioned"}],
  "experiences": [{"role": "", "company": "", "start_date": "", "end_date": "", "skills_used": []}],
  "projects": [{"name": "", "description": "", "start_date": "", "end_date": "", "skills_used": []}],
  "education": [{"institute": "", "degree_name": "", "branch_name": "", "start_date": "", "end_date": "", "year_of_passing": "", "gpa": ""}]
}"""

        user_prompt = f"""Parse the resume below and return strict JSON.

Resume text:
{text}"""

        response = cls._create_chat_completion(
            model=settings.resolved_llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            **cls._json_mode(),
        )

        raw = response.choices[0].message.content or "{}"
        return cls._safe_parse(raw)

#     @classmethod
#     def validate_location_candidate(cls, location: str, resume_text: str) -> str:
#         prompt = f"""Validate location. Return JSON: {{"location": "", "is_valid": true}}
# Rules: Real geographic places only. Remove org names. If ambiguous → empty.

# Candidate: {location}
# Resume: {resume_text[:4000]}"""

#         response = cls._create_chat_completion(
#             model=settings.resolved_llm_model,
#             messages=[
#                 {
#                     "role": "system",
#                     "content": "You validate resume locations and return only valid JSON.",
#                 },
#                 {"role": "user", "content": prompt},
#             ],
#             temperature=0.0,
#             **cls._json_mode(),
#         )

#         raw = response.choices[0].message.content or "{}"
#         parsed = cls._safe_parse(raw)
#         is_valid = bool(parsed.get("is_valid"))
#         location_text = str(parsed.get("location") or "").strip()

#         if not is_valid:
#             return ""

#         return location_text

    @classmethod
    def extract_requirement(cls, text: str) -> dict:
        system_prompt = """Extract job req to JSON.
Schema:
{
    "title": "",
    "skills": [{"name": "", "min_experience_years": null}],
    "min_experience": null,
    "max_experience": null,
    "location": "",
    "min_ctc": null,
    "max_ctc": null,
    "notes": "",
    "qualification": ""
}
Rules: null for unknown. skills lowercase, deduplicated. min_exp_years only if explicit. notes: 3-6 sentences. qualification: 1-2 phrases."""

        user_prompt = f"""Extract requirement data from this text and return strict JSON only.

Requirement text:
{text}
"""

        response = cls._create_chat_completion(
            model=settings.resolved_llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.0,
            **cls._json_mode(),
        )

        raw = response.choices[0].message.content or "{}"
        return cls._safe_parse(raw)

    @classmethod
    def rerank_candidate(cls, requirement: dict, candidate: dict) -> dict:
        requirement_skills = requirement.get("skills") or []

        skill_requirements_text: list[str] = []
        for item in requirement_skills:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue

            min_years = item.get("min_experience_years")
            if isinstance(min_years, (int, float)):
                skill_requirements_text.append(f"{name} ({min_years}+ years preferred)")
            else:
                skill_requirements_text.append(name)

        if not skill_requirements_text:
            fallback_skills = requirement.get("required_skills") or []
            for skill in fallback_skills:
                text = str(skill).strip()
                if text:
                    skill_requirements_text.append(text)

        req_title = str(requirement.get("title") or "").strip()
        req_min_exp = requirement.get("min_experience")
        req_max_exp = requirement.get("max_experience")
        req_location = requirement.get("location") or "any"
        req_qualification = str(requirement.get("qualification") or "").strip()
        req_notes = str(requirement.get("notes") or "").strip()

        prompt = f"""Rate fit. Return JSON: {{"score": 0-100, "reason": "one sentence"}}
Priority: 1) Skills 2) Role 3) Exp 4) Qual
Job: {req_title} Skills: {", ".join(skill_requirements_text)} Exp: {req_min_exp}-{req_max_exp}
Candidate: Skills: {", ".join(candidate.get("skills") or [])} Exp: {candidate.get("experience_years")}"""

        response = cls._create_chat_completion(
            model=settings.resolved_llm_model,
            messages=[
                {
                    "role": "system",
                    "content": "You are a recruitment assistant. Return only valid JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            **cls._json_mode(),
        )

        raw = response.choices[0].message.content or "{}"
        parsed = cls._safe_parse(raw)

        score = parsed.get("score", 0)
        try:
            score_value = float(score)
        except (TypeError, ValueError):
            score_value = 0.0

        return {
            "score": max(0.0, min(100.0, score_value)),
            "reason": str(parsed.get("reason", "")),
        }

    @classmethod
    def generate_embedding(cls, text: str) -> list[float]:
        payload = text.strip() or "No content"

        if settings.resolved_embed_mode == "local":
            embedder = cls._get_local_embedder()
            vector = embedder.encode(payload, normalize_embeddings=False)
            embedding = [float(value) for value in vector]
        else:
            if cls._embed_client is None:
                raise ValueError("Embedding client is not initialized for EMBED_MODE=api")
            
            # Estimate tokens for embedding request
            estimated_tokens = adaptive_rate_limiter.estimate_tokens(payload) // 2  # Embeddings use fewer tokens
            
            # Check adaptive rate limits
            proceed, wait_seconds = adaptive_rate_limiter.check_and_record(estimated_tokens)
            
            if not proceed:
                if wait_seconds:
                    raise AiRateLimitError(
                        f"Embedding rate limit exceeded. Try again in {wait_seconds:.0f} seconds.",
                        retry_after_seconds=wait_seconds,
                    )
                else:
                    raise AiRateLimitError(
                        "Daily embedding limit exceeded. Try again tomorrow.",
                        retry_after_seconds=86400,
                    )
            
            # Add adaptive delay
            recommended_delay = adaptive_rate_limiter.get_recommended_delay()
            time.sleep(min(3.0, recommended_delay))  # Cap at 3 seconds for embeddings
            
            response = cls._embed_client.embeddings.create(
                model=settings.resolved_embed_model,
                input=payload,
            )
            embedding = [float(value) for value in response.data[0].embedding]

        expected_dims = settings.resolved_embed_dimensions
        if len(embedding) != expected_dims:
            raise ValueError(
                f"Embedding dimension mismatch: expected {expected_dims}, got {len(embedding)}"
            )

        return embedding

    @classmethod
    def _get_local_embedder(cls) -> "SentenceTransformer":
        if cls._local_embedder is not None:
            return cls._local_embedder

        try:
            from sentence_transformers import SentenceTransformer
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "sentence-transformers is required for EMBED_MODE=local. "
                "Install backend dependencies from pyproject.toml before generating embeddings."
            ) from exc

        model_name = settings.resolved_embed_model
        if "/" not in model_name and not model_name.startswith("."):
            model_name = f"sentence-transformers/{model_name}"

        cls._local_embedder = SentenceTransformer(
            model_name,
            device=settings.local_embed_device,
        )
        return cls._local_embedder

    @classmethod
    def _json_mode(cls) -> dict:
        provider = settings.resolved_provider
        if provider == "ollama":
            return {"extra_body": {"format": "json"}}
        if provider == "gemini":
            return {"extra_body": {"response_mime_type": "application/json"}}
        return {"response_format": {"type": "json_object"}}
    @classmethod
    def _create_chat_completion(cls, **kwargs):
        # Estimate tokens for this request
        messages = kwargs.get('messages', [])
        estimated_tokens = 0
        for msg in messages:
            if isinstance(msg, dict) and 'content' in msg:
                estimated_tokens += adaptive_rate_limiter.estimate_tokens(msg['content'])
        
        # Check adaptive rate limits
        proceed, wait_seconds = adaptive_rate_limiter.check_and_record(estimated_tokens)
        
        if not proceed:
            if wait_seconds:
                raise AiRateLimitError(
                    f"Rate limit exceeded. Try again in {wait_seconds:.0f} seconds.",
                    retry_after_seconds=wait_seconds,
                )
            else:
                raise AiRateLimitError(
                    "Daily rate limit exceeded. Try again tomorrow.",
                    retry_after_seconds=86400,
                )
        
        # Add adaptive delay based on current usage
        recommended_delay = adaptive_rate_limiter.get_recommended_delay()
        time.sleep(min(5.0, recommended_delay))  # Cap at 5 seconds
        
        try:
            return cls._llm_client.chat.completions.create(**kwargs)
        except OpenAIError as exc:
            cls._raise_rate_limit_error_if_needed(exc)
            raise

    @classmethod
    def _raise_rate_limit_error_if_needed(cls, exc: OpenAIError) -> None:
        message = str(exc)
        lowered = message.lower()
        is_rate_limited = (
            "rate_limit_exceeded" in lowered
            or "error code: 429" in lowered
            or "too many requests" in lowered
        )
        if not is_rate_limited:
            return

        retry_after = cls._extract_retry_after_seconds(message)
        if retry_after is None:
            response = getattr(exc, "response", None)
            headers = getattr(response, "headers", None)
            if headers is not None:
                retry_after_header = headers.get("retry-after") or headers.get("Retry-After")
                if retry_after_header:
                    try:
                        retry_after = max(1, int(float(retry_after_header)))
                    except (TypeError, ValueError):
                        retry_after = None

        if retry_after is not None:
            raise AiRateLimitError(
                f"AI provider rate limit reached. Retry in approximately {retry_after} seconds.",
                retry_after_seconds=retry_after,
            ) from exc

        raise AiRateLimitError(
            "AI provider rate limit reached. Please retry after a short wait.",
            retry_after_seconds=None,
        ) from exc

    @staticmethod
    def _extract_retry_after_seconds(message: str) -> int | None:
        retry_in_pattern = re.search(
            r"try\s+again\s+in\s*(?:(?P<minutes>\d+)m)?\s*(?P<seconds>\d+(?:\.\d+)?)s",
            message,
            flags=re.IGNORECASE,
        )
        if retry_in_pattern:
            minutes = int(retry_in_pattern.group("minutes") or 0)
            seconds = float(retry_in_pattern.group("seconds") or 0)
            return max(1, int(math.ceil(minutes * 60 + seconds)))

        seconds_pattern = re.search(
            r"retry\s+after\s+(?P<seconds>\d+(?:\.\d+)?)\s*seconds?",
            message,
            flags=re.IGNORECASE,
        )
        if seconds_pattern:
            return max(1, int(math.ceil(float(seconds_pattern.group("seconds")))))

        return None

    @staticmethod
    def _safe_parse(raw: str) -> dict:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            parts = cleaned.split("```")
            cleaned = parts[1] if len(parts) > 1 else parts[0]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]

        cleaned = cleaned.strip()
        try:
            return json.loads(cleaned)
        except JSONDecodeError:
            match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
            if not match:
                raise ValueError("AI response is not valid JSON")
            return json.loads(match.group(0))
