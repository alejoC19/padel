from __future__ import annotations

import re
import unicodedata

from .config import ScoringConfig
from .models import JobListing, ScoreResult


def normalize(text: str) -> str:
    text = text.lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text).strip()


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    parts = [re.escape(part) for part in normalize(keyword).split(" ") if part]
    pattern = r"\s+".join(parts)
    return re.compile(rf"(?<!\w){pattern}(?!\w)")


def _find_matches(text: str, terms: dict[str, float]) -> tuple[float, list[str]]:
    score = 0.0
    matched = []
    for term, weight in terms.items():
        if _keyword_pattern(term).search(text):
            score += weight
            matched.append(term)
    return score, matched


def score_listing(listing: JobListing, config: ScoringConfig) -> list[ScoreResult]:
    text = normalize(f"{listing.title} {listing.description} {listing.location}")

    bonus_score, matched_bonus = _find_matches(text, config.bonus)
    penalty_score, matched_penalties = _find_matches(text, config.penalties)

    results = []
    for profile in config.profiles:
        keyword_score, matched_keywords = _find_matches(text, profile.keywords)
        results.append(
            ScoreResult(
                profile_key=profile.key,
                profile_name=profile.name,
                score=keyword_score + bonus_score + penalty_score,
                matched_keywords=matched_keywords,
                matched_bonus=matched_bonus,
                matched_penalties=matched_penalties,
            )
        )

    results.sort(key=lambda r: r.score, reverse=True)
    return results


def suggest_profile(listing: JobListing, config: ScoringConfig) -> ScoreResult:
    return score_listing(listing, config)[0]
