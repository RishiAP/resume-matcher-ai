from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_PATH = BACKEND_ROOT / "docs" / "openapi.json"


def _prepare_runtime() -> None:
    os.chdir(BACKEND_ROOT)
    backend_root_str = str(BACKEND_ROOT)
    if backend_root_str not in sys.path:
        sys.path.insert(0, backend_root_str)


def _resolve_output_path() -> Path:
    output_override = os.getenv("OPENAPI_OUTPUT")
    output_path = Path(output_override) if output_override else DEFAULT_OUTPUT_PATH
    if not output_path.is_absolute():
        output_path = (Path.cwd() / output_path).resolve()
    return output_path


def generate_openapi() -> None:
    """Generate OpenAPI JSON for backend docs usage."""
    _prepare_runtime()
    from app.main import app

    output_path = _resolve_output_path()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
    print(f"OpenAPI schema written to {output_path}")


if __name__ == "__main__":
    generate_openapi()
