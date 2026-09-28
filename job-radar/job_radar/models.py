from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class JobListing:
    title: str
    company: str
    url: str
    description: str = ""
    location: str = ""
    salary_text: str | None = None
    source: str = ""


@dataclass
class ScoreResult:
    profile_key: str
    profile_name: str
    score: float
    matched_keywords: list[str] = field(default_factory=list)
    matched_bonus: list[str] = field(default_factory=list)
    matched_penalties: list[str] = field(default_factory=list)
