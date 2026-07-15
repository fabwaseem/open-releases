from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _default_pushed_after() -> str:
    dt = datetime.now(timezone.utc) - timedelta(days=5 * 365)
    return dt.strftime("%Y-%m-%d")


@dataclass
class ScraperConfig:
    """Runtime configuration for the releases scraper."""

    token: str | None = None
    min_stars: int = 100
    pushed_after: str = field(default_factory=_default_pushed_after)
    # Fetch a small window so we can prefer a stable build with desktop installers.
    max_releases_per_repo: int = 5
    max_assets_per_release: int = 50
    require_assets: bool = True
    # Still fetch prereleases, but UI record prefers a stable one when possible.
    include_prereleases: bool = True
    require_desktop_apps: bool = True
    exclude_forks: bool = True
    exclude_archived: bool = True
    data_dir: Path = field(default_factory=lambda: Path("data"))
    output_file: str = "repositories.json"
    state_file: str = "scrape_state.json"
    user_agent: str = (
        "github-releases-directory/0.1 "
        "(+https://github.com/github-releases-directory; research scraper)"
    )
    # Search API: authenticated 30 req/min. Stay under that.
    search_sleep_seconds: float = 2.2
    # Core/GraphQL pacing when remaining budget is low.
    api_sleep_seconds: float = 0.2
    graphql_batch_size: int = 100
    # Soft cap for a single run; 0 = unlimited.
    max_repos: int = 0
    # Prefer GraphQL; fall back to browser/DOM on sustained rate limits.
    allow_browser_fallback: bool = True
    browser_sleep_seconds: float = 1.5
    request_timeout: float = 45.0
    max_retries: int = 8

    @classmethod
    def from_env(cls, **overrides: object) -> ScraperConfig:
        token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
        cfg = cls(token=token)
        for key, value in overrides.items():
            if hasattr(cfg, key) and value is not None:
                setattr(cfg, key, value)
        return cfg

    @property
    def output_path(self) -> Path:
        return self.data_dir / self.output_file

    @property
    def state_path(self) -> Path:
        return self.data_dir / self.state_file

    def base_search_qualifiers(self) -> str:
        parts = [
            f"stars:>={self.min_stars}",
            f"pushed:>={self.pushed_after}",
            "is:public",
            "mirror:false",
        ]
        if self.exclude_archived:
            parts.append("archived:false")
        if self.exclude_forks:
            parts.append("fork:false")
        return " ".join(parts)