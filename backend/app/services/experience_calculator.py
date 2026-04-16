from __future__ import annotations

import re
from datetime import date, datetime
from math import floor

PRESENT_MARKERS = {
    "present",
    "current",
    "now",
    "ongoing",
    "till date",
    "to date",
    "today",
}

MONTH_ALIASES = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

DATE_FORMATS = (
    "%b %Y",
    "%B %Y",
    "%m/%Y",
    "%m-%Y",
    "%Y/%m",
    "%Y-%m",
    "%Y/%m/%d",
    "%Y-%m-%d",
    "%Y",
)


def normalize_skill_names(value: object) -> list[str]:
    if value is None:
        return []

    raw_values: list[str] = []
    if isinstance(value, list):
        raw_values = [str(item) for item in value]
    elif isinstance(value, str):
        raw_values = [value]
    else:
        raw_values = [str(value)]

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in raw_values:
        for part in raw.split(","):
            skill = part.strip().lower()
            if skill and skill not in seen:
                seen.add(skill)
                normalized.append(skill)

    return normalized


def normalize_role_name(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def parse_resume_date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None

    lowered = re.sub(r"\s+", " ", text.lower()).strip()
    if lowered in PRESENT_MARKERS:
        today = date.today()
        return date(today.year, today.month, 1)

    cleaned = (
        text.replace(".", " ")
        .replace(",", " ")
        .replace("|", " ")
        .replace("--", "-")
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.strptime(cleaned, fmt)
            return date(parsed.year, parsed.month, 1)
        except ValueError:
            continue

    # Try ISO date/datetime parsing as a last resort (e.g. 2020-05-01, 2020-05-01T00:00:00)
    try:
        parsed = datetime.fromisoformat(cleaned)
        return date(parsed.year, parsed.month, 1)
    except Exception:
        pass

    lowered_clean = cleaned.lower()

    month_year_match = re.match(
        r"^(?P<month>[a-zA-Z]+)\s+(?P<year>\d{4})$",
        lowered_clean,
    )
    if month_year_match:
        month_token = month_year_match.group("month")
        month = MONTH_ALIASES.get(month_token)
        year = int(month_year_match.group("year"))
        if month is not None:
            return date(year, month, 1)

    year_month_match = re.match(
        r"^(?P<year>\d{4})\s+(?P<month>[a-zA-Z]+)$",
        lowered_clean,
    )
    if year_month_match:
        month_token = year_month_match.group("month")
        month = MONTH_ALIASES.get(month_token)
        year = int(year_month_match.group("year"))
        if month is not None:
            return date(year, month, 1)

    numeric_month_year = re.match(
        r"^(?P<month>\d{1,2})[/-](?P<year>\d{4})$",
        lowered_clean,
    )
    if numeric_month_year:
        month = int(numeric_month_year.group("month"))
        year = int(numeric_month_year.group("year"))
        if 1 <= month <= 12:
            return date(year, month, 1)

    numeric_year_month = re.match(
        r"^(?P<year>\d{4})[/-](?P<month>\d{1,2})$",
        lowered_clean,
    )
    if numeric_year_month:
        month = int(numeric_year_month.group("month"))
        year = int(numeric_year_month.group("year"))
        if 1 <= month <= 12:
            return date(year, month, 1)

    year_only = re.match(r"^(?P<year>\d{4})$", lowered_clean)
    if year_only:
        year = int(year_only.group("year"))
        return date(year, 1, 1)

    return None


def _is_present_marker(value: str | None) -> bool:
    text = (value or "").strip().lower()
    return text in PRESENT_MARKERS


def _to_month_index(value: date) -> int:
    return value.year * 12 + (value.month - 1)


def _merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not intervals:
        return []

    sorted_intervals = sorted(intervals, key=lambda interval: interval[0])
    merged: list[tuple[int, int]] = [sorted_intervals[0]]

    for start, end in sorted_intervals[1:]:
        current_start, current_end = merged[-1]
        if start <= current_end + 1:
            merged[-1] = (current_start, max(current_end, end))
        else:
            merged.append((start, end))

    return merged


def _interval_months(intervals: list[tuple[int, int]]) -> int:
    return sum((end - start + 1) for start, end in intervals)


def build_experience_interval(start_date: str | None, end_date: str | None) -> tuple[int, int] | None:
    start = parse_resume_date(start_date)
    end = parse_resume_date(end_date)

    if end is None and _is_present_marker(end_date):
        today = date.today()
        end = date(today.year, today.month, 1)

    if start is None or end is None:
        return None

    start_idx = _to_month_index(start)
    end_idx = _to_month_index(end)

    if end_idx < start_idx:
        start_idx, end_idx = end_idx, start_idx

    return start_idx, end_idx


def calculate_total_experience_years(experiences: list[dict]) -> int | None:
    intervals: list[tuple[int, int]] = []
    for experience in experiences:
        interval = build_experience_interval(
            start_date=experience.get("start_date"),
            end_date=experience.get("end_date"),
        )
        if interval is not None:
            intervals.append(interval)

    merged = _merge_intervals(intervals)
    total_months = _interval_months(merged)
    if total_months <= 0:
        return None

    return floor(total_months / 12)


def calculate_skill_experience_months(experiences: list[dict]) -> dict[str, int]:
    skill_intervals: dict[str, list[tuple[int, int]]] = {}

    for experience in experiences:
        interval = build_experience_interval(
            start_date=experience.get("start_date"),
            end_date=experience.get("end_date"),
        )
        if interval is None:
            continue

        for skill in normalize_skill_names(experience.get("skills_used")):
            skill_intervals.setdefault(skill, []).append(interval)

    result: dict[str, int] = {}
    for skill, intervals in skill_intervals.items():
        result[skill] = _interval_months(_merge_intervals(intervals))

    return result


def calculate_role_experience_months(experiences: list[dict]) -> dict[str, int]:
    role_intervals: dict[str, list[tuple[int, int]]] = {}

    for experience in experiences:
        role = normalize_role_name(experience.get("role"))
        if not role:
            continue

        interval = build_experience_interval(
            start_date=experience.get("start_date"),
            end_date=experience.get("end_date"),
        )
        if interval is None:
            continue

        role_intervals.setdefault(role, []).append(interval)

    result: dict[str, int] = {}
    for role, intervals in role_intervals.items():
        result[role] = _interval_months(_merge_intervals(intervals))

    return result
