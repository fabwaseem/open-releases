from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class JsonStore:
    """
    Crash-safe store that streams repos to disk.

    - `repositories.jsonl`: append-only (one repo per line) — source of truth
    - `repositories.json`: compact catalog rewritten after each page
    - In memory we keep only full_name → record for the catalog; page buffers
      are never retained beyond the current page.
    """

    def __init__(self, output_path: Path, state_path: Path) -> None:
        self.output_path = output_path
        self.state_path = state_path
        self.jsonl_path = output_path.with_suffix(".jsonl")
        self.output_path.parent.mkdir(parents=True, exist_ok=True)

        self._repos: dict[str, dict[str, Any]] = {}
        self._seen: set[str] = set()
        self._state: dict[str, Any] = {
            "version": 2,
            "started_at": None,
            "updated_at": None,
            "completed_shards": [],
            "shard_queue": [],
            "current": None,  # {shard, cursor|page, mode}
            "stats": {
                "discovered": 0,
                "with_releases": 0,
                "skipped_no_releases": 0,
                "skipped_no_assets": 0,
                "errors": 0,
                "browser_fallback_uses": 0,
                "pages_processed": 0,
            },
            "last_query": None,
        }
        self._load()

    def _load(self) -> None:
        # Prefer jsonl (streamed). Fall back to JSON catalog.
        if self.jsonl_path.exists():
            with self.jsonl_path.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    key = item.get("full_name")
                    if key:
                        self._repos[key] = item
                        self._seen.add(key)
        elif self.output_path.exists():
            raw = json.loads(self.output_path.read_text(encoding="utf-8"))
            for item in raw.get("repositories") or []:
                key = item.get("full_name")
                if key:
                    self._repos[key] = item
                    self._seen.add(key)

        if self.state_path.exists():
            loaded = json.loads(self.state_path.read_text(encoding="utf-8"))
            self._state.update(loaded)

        if not self._state.get("started_at"):
            self._state["started_at"] = _utcnow()

    @property
    def repos(self) -> dict[str, dict[str, Any]]:
        return self._repos

    @property
    def state(self) -> dict[str, Any]:
        return self._state

    def has_repo(self, full_name: str) -> bool:
        return full_name in self._seen

    def shard_done(self, shard_id: str) -> bool:
        return shard_id in set(self._state.get("completed_shards") or [])

    def mark_shard_done(self, shard_id: str) -> None:
        done = set(self._state.get("completed_shards") or [])
        done.add(shard_id)
        self._state["completed_shards"] = sorted(done)
        current = self._state.get("current") or {}
        if current.get("shard_id") == shard_id:
            self._state["current"] = None

    def bump(self, key: str, n: int = 1) -> None:
        stats = self._state.setdefault("stats", {})
        stats[key] = int(stats.get(key, 0)) + n

    def upsert_repo(self, repo: dict[str, Any]) -> None:
        full_name = repo["full_name"]
        is_new = full_name not in self._seen
        repo["scraped_at"] = _utcnow()
        self._repos[full_name] = repo
        self._seen.add(full_name)
        # Stream to jsonl immediately so a crash mid-page still keeps this repo.
        with self.jsonl_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(repo, ensure_ascii=False) + "\n")
        if is_new:
            self.bump("with_releases")

    def set_progress(
        self,
        *,
        queue: list[dict[str, Any]],
        current: dict[str, Any] | None,
    ) -> None:
        self._state["shard_queue"] = queue
        self._state["current"] = current

    def save(self) -> None:
        """Rewrite compact catalog + state (call after each page)."""
        self._state["updated_at"] = _utcnow()
        payload = {
            "meta": {
                "generated_at": _utcnow(),
                "repository_count": len(self._repos),
                "schema_version": 2,
                "scrape_stats": self._state.get("stats", {}),
                "started_at": self._state.get("started_at"),
            },
            "repositories": sorted(
                self._repos.values(),
                key=lambda r: (
                    -(r.get("stars") or r.get("stargazers_count") or 0),
                    r.get("full_name") or "",
                ),
            ),
        }
        self._atomic_write(self.output_path, payload)
        self._atomic_write(self.state_path, self._state)

    @staticmethod
    def _atomic_write(path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
            suffix=".tmp",
        ) as tmp:
            json.dump(data, tmp, ensure_ascii=False, indent=2)
            tmp.write("\n")
            tmp_path = Path(tmp.name)
        tmp_path.replace(path)
