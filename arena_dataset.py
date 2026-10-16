"""Load Arena JSONL trajectories as (obs, legal, action, reward, next_obs, done)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    rows = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def episodes(path: str | Path) -> Iterator[dict[str, Any]]:
    current: dict[str, Any] | None = None
    for row in read_jsonl(path):
        if row.get("type") == "episode":
            if current:
                yield current
            current = {**row, "steps": []}
        elif row.get("type") == "step" and current is not None:
            current["steps"].append(row)
    if current:
        yield current


def transitions(path: str | Path) -> Iterator[tuple[Any, list[str], str, float, Any, bool]]:
    for ep in episodes(path):
        steps = ep["steps"]
        for i, step in enumerate(steps):
            nxt = steps[i + 1]["observation"] if i + 1 < len(steps) else None
            yield (
                step["observation"],
                step["legal_actions"],
                step["action"],
                float(step["reward"]),
                nxt,
                bool(step["terminal"]),
            )


def replay(path: str | Path) -> None:
    """Assert every episode records a consistent action list length."""
    for ep in episodes(path):
        assert ep["length"] == len(ep["steps"]), ep["match_id"]
