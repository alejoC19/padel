from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"


@dataclass
class ProfileConfig:
    key: str
    name: str
    keywords: dict[str, float] = field(default_factory=dict)


@dataclass
class ScoringConfig:
    profiles: list[ProfileConfig]
    bonus: dict[str, float]
    penalties: dict[str, float]

    @classmethod
    def from_dict(cls, data: dict) -> ScoringConfig:
        profiles = [
            ProfileConfig(key=key, name=value.get("name", key), keywords=value.get("keywords", {}))
            for key, value in data.get("profiles", {}).items()
        ]
        return cls(
            profiles=profiles,
            bonus=data.get("bonus", {}),
            penalties=data.get("penalties", {}),
        )


def load_config(path: Path | str = DEFAULT_CONFIG_PATH) -> ScoringConfig:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return ScoringConfig.from_dict(data)
