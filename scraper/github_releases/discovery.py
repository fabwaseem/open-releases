from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any, Iterator

from .client import GitHubClient, RateLimitError
from .config import ScraperConfig

log = logging.getLogger(__name__)

MAX_RESULTS_PER_QUERY = 1000
SAFE_PAGE_CAP = 10  # 100 results/page → 1000


@dataclass(frozen=True)
class Shard:
    """A search query slice; split until count <= 1000, then page through it."""

    stars_min: int
    stars_max: int | None
    created_start: date
    created_end: date

    @property
    def id(self) -> str:
        hi = self.stars_max if self.stars_max is not None else "*"
        return (
            f"stars:{self.stars_min}..{hi}"
            f"|created:{self.created_start.isoformat()}..{self.created_end.isoformat()}"
        )

    def query(self, base_qualifiers: str) -> str:
        if self.stars_max is None:
            stars_part = f"stars:>={self.stars_min}"
        elif self.stars_min == self.stars_max:
            stars_part = f"stars:{self.stars_min}"
        else:
            stars_part = f"stars:{self.stars_min}..{self.stars_max}"
        created_part = (
            f"created:{self.created_start.isoformat()}..{self.created_end.isoformat()}"
        )
        parts = [p for p in base_qualifiers.split() if not p.startswith("stars:")]
        return " ".join(parts + [stars_part, created_part])

    def to_dict(self) -> dict[str, Any]:
        return {
            "stars_min": self.stars_min,
            "stars_max": self.stars_max,
            "created_start": self.created_start.isoformat(),
            "created_end": self.created_end.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Shard:
        return cls(
            stars_min=int(data["stars_min"]),
            stars_max=None if data.get("stars_max") is None else int(data["stars_max"]),
            created_start=date.fromisoformat(data["created_start"]),
            created_end=date.fromisoformat(data["created_end"]),
        )


def root_shard(config: ScraperConfig) -> Shard:
    return Shard(
        stars_min=config.min_stars,
        stars_max=None,
        created_start=date(2008, 1, 1),
        created_end=date.today(),
    )


def split_shard(shard: Shard) -> list[Shard]:
    """Split one oversized shard into two smaller pieces."""
    days = (shard.created_end - shard.created_start).days
    if days >= 1:
        mid = shard.created_start + timedelta(days=days // 2)
        left = Shard(shard.stars_min, shard.stars_max, shard.created_start, mid)
        right_start = mid + timedelta(days=1)
        if right_start <= shard.created_end:
            right = Shard(
                shard.stars_min, shard.stars_max, right_start, shard.created_end
            )
            return [left, right]

    if shard.stars_max is None:
        hi_probe = max(shard.stars_min * 2, shard.stars_min + 1000)
        return [
            Shard(shard.stars_min, hi_probe, shard.created_start, shard.created_end),
            Shard(hi_probe + 1, None, shard.created_start, shard.created_end),
        ]

    if shard.stars_max > shard.stars_min:
        mid = (shard.stars_min + shard.stars_max) // 2
        return [
            Shard(shard.stars_min, mid, shard.created_start, shard.created_end),
            Shard(mid + 1, shard.stars_max, shard.created_start, shard.created_end),
        ]

    # Cannot split further — caller should process with a 1000-result cap.
    return []


class StreamingDiscovery:
    """
    Online shard walker: count → split OR process immediately.

    Never plans the full search space up front. Queue state is persisted so
    a crash can resume without re-counting finished work.
    """

    def __init__(
        self,
        client: GitHubClient,
        config: ScraperConfig,
        *,
        queue: list[Shard] | None = None,
        completed: set[str] | None = None,
    ) -> None:
        self.client = client
        self.config = config
        self.queue: list[Shard] = list(queue) if queue else [root_shard(config)]
        self.completed: set[str] = set(completed or [])

    def export_queue(self) -> list[dict[str, Any]]:
        return [s.to_dict() for s in self.queue]

    def count(self, shard: Shard) -> int:
        q = shard.query(self.config.base_search_qualifiers())
        try:
            return self.client.search_repositories_count(q)
        except RateLimitError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("Count failed for %s: %s — treating as oversized", shard.id, exc)
            return MAX_RESULTS_PER_QUERY + 1

    def next_processable_shard(self) -> Shard | None:
        """
        Pop/split until a shard with 0 < count <= 1000 is ready.

        Empty shards are marked completed. Oversized shards are replaced by
        their children in the queue (left first).
        """
        while self.queue:
            shard = self.queue.pop(0)
            if shard.id in self.completed:
                continue

            count = self.count(shard)
            log.info("Inspect %s → %s repos (queue=%s)", shard.id, count, len(self.queue))

            if count == 0:
                self.completed.add(shard.id)
                continue

            if count <= MAX_RESULTS_PER_QUERY:
                return shard

            children = split_shard(shard)
            if not children:
                log.warning(
                    "Cannot shrink %s further (count=%s); processing capped at 1000",
                    shard.id,
                    count,
                )
                return shard

            # Process the earlier/left half first.
            self.queue[0:0] = children

        return None


def iter_shard_graphql_pages(
    client: GitHubClient,
    shard: Shard,
    base_qualifiers: str,
    *,
    start_cursor: str | None = None,
) -> Iterator[tuple[list[dict], str | None, bool]]:
    """
    Yield (nodes, next_cursor, has_more) one GraphQL search page at a time.

    Does not retain previous pages.
    """
    query = shard.query(base_qualifiers)
    cursor = start_cursor
    from .transform import SEARCH_REPOS_GRAPHQL

    for _ in range(SAFE_PAGE_CAP):
        data = client.graphql(
            SEARCH_REPOS_GRAPHQL,
            {"query": query, "cursor": cursor},
        )
        search = data["search"]
        nodes = [n for n in (search.get("nodes") or []) if n]
        page_info = search.get("pageInfo") or {}
        has_more = bool(page_info.get("hasNextPage"))
        next_cursor = page_info.get("endCursor")
        yield nodes, next_cursor, has_more
        if not has_more:
            break
        cursor = next_cursor


def iter_shard_rest_pages(
    client: GitHubClient,
    shard: Shard,
    base_qualifiers: str,
    *,
    start_page: int = 1,
) -> Iterator[tuple[list[dict], int, bool]]:
    """Yield (items, next_page, has_more) one REST search page at a time."""
    query = shard.query(base_qualifiers)
    page = max(1, start_page)
    while page <= SAFE_PAGE_CAP:
        data = client.search_repositories_page(query, page=page, per_page=100)
        items = data.get("items") or []
        has_more = len(items) == 100 and page < SAFE_PAGE_CAP
        yield items, page + 1, has_more
        if not items or len(items) < 100:
            break
        page += 1


def coarse_queue(config: ScraperConfig) -> list[Shard]:
    """Optional coarser starting queue (year slices) — still processed online."""
    shards: list[Shard] = []
    start = date(2008, 1, 1)
    end = date.today()
    cursor = start
    while cursor <= end:
        year_end = min(date(cursor.year, 12, 31), end)
        shards.append(
            Shard(config.min_stars, None, cursor, year_end)
        )
        cursor = year_end + timedelta(days=1)
    return shards
