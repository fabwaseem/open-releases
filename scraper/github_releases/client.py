from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from .config import ScraperConfig

log = logging.getLogger(__name__)

GRAPHQL_URL = "https://api.github.com/graphql"
REST_URL = "https://api.github.com"


class RateLimitError(RuntimeError):
    def __init__(self, message: str, reset_at: float | None = None) -> None:
        super().__init__(message)
        self.reset_at = reset_at


class GitHubClient:
    """Authenticated GitHub GraphQL + REST client with rate-limit awareness."""

    def __init__(self, config: ScraperConfig) -> None:
        self.config = config
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": config.user_agent,
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if config.token:
            headers["Authorization"] = f"Bearer {config.token}"
        else:
            log.warning(
                "No GITHUB_TOKEN set — unauthenticated limits are very low "
                "(10 search req/min, 60 core/hr). Browser fallback will be used more."
            )
        self._http = httpx.Client(
            headers=headers,
            timeout=config.request_timeout,
            follow_redirects=True,
        )
        self._search_last_call = 0.0

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> GitHubClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _pace_search(self) -> None:
        elapsed = time.monotonic() - self._search_last_call
        wait_for = self.config.search_sleep_seconds - elapsed
        if wait_for > 0:
            time.sleep(wait_for)
        self._search_last_call = time.monotonic()

    def _sleep_for_reset(self, kind: str, remaining: int, reset_at: float) -> None:
        sleep_for = max(0.0, reset_at - time.time()) + 1.0
        # Without a token, GraphQL often reports remaining=0 with a long reset.
        # Do not block the process — raise so browser/DOM fallback can run.
        if not self.config.token and sleep_for > 15:
            raise RateLimitError(
                f"{kind} rate limited (unauthenticated, remaining={remaining})",
                reset_at=reset_at,
            )
        # Cap authenticated waits; caller retries via tenacity / shard fallback.
        if sleep_for > 120:
            log.warning(
                "%s rate limit remaining=%s; reset in %.0fs — raising for fallback",
                kind,
                remaining,
                sleep_for,
            )
            raise RateLimitError(f"{kind} rate limited", reset_at=reset_at)
        log.warning(
            "%s rate limit nearly exhausted (remaining=%s). Sleeping %.1fs",
            kind,
            remaining,
            sleep_for,
        )
        time.sleep(sleep_for)

    def _handle_rate_headers(self, response: httpx.Response, kind: str) -> None:
        remaining = response.headers.get("X-RateLimit-Remaining")
        reset = response.headers.get("X-RateLimit-Reset")
        if remaining is not None and reset is not None:
            rem = int(remaining)
            reset_at = float(reset)
            if rem <= 1 and response.status_code in {200, 403, 429}:
                # Only sleep/raise when we are actually constrained on this call.
                if response.status_code != 200 or rem == 0:
                    self._sleep_for_reset(kind, rem, reset_at)

        if response.status_code == 403 and "rate limit" in response.text.lower():
            reset_at = float(reset) if reset else None
            raise RateLimitError(f"{kind} rate limited", reset_at=reset_at)

        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            sleep_for = min(float(retry_after) if retry_after else 60.0, 90.0)
            if not self.config.token:
                raise RateLimitError("HTTP 429 (unauthenticated)")
            log.warning("HTTP 429 — sleeping %.1fs", sleep_for)
            time.sleep(sleep_for)
            raise RateLimitError("HTTP 429")

    def graphql(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        attempts = self.config.max_retries if self.config.token else 2
        last_exc: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                return self._graphql_once(query, variables)
            except httpx.TransportError as exc:
                last_exc = exc
                time.sleep(min(2**attempt, 20))
            except RateLimitError as exc:
                last_exc = exc
                if not self.config.token:
                    raise
                time.sleep(min(2**attempt, 30))
        assert last_exc is not None
        raise last_exc

    def _graphql_once(
        self, query: str, variables: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        time.sleep(self.config.api_sleep_seconds)
        response = self._http.post(
            GRAPHQL_URL,
            json={"query": query, "variables": variables or {}},
        )
        self._handle_rate_headers(response, "graphql")
        if response.status_code >= 400:
            raise RuntimeError(f"GraphQL HTTP {response.status_code}: {response.text[:500]}")
        payload = response.json()
        if payload.get("errors"):
            messages = "; ".join(e.get("message", str(e)) for e in payload["errors"])
            if "rate limit" in messages.lower() or "API rate limit" in messages:
                raise RateLimitError(messages)
            if not payload.get("data"):
                raise RuntimeError(f"GraphQL errors: {messages}")
            log.warning("GraphQL partial errors: %s", messages)
        return payload["data"]

    @retry(
        retry=retry_if_exception_type((httpx.TransportError, RateLimitError)),
        wait=wait_exponential_jitter(initial=2, max=90),
        stop=stop_after_attempt(8),
        reraise=True,
    )
    def rest_get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        is_search = path.startswith("/search/")
        if is_search:
            self._pace_search()
        else:
            time.sleep(self.config.api_sleep_seconds)

        response = self._http.get(f"{REST_URL}{path}", params=params)
        self._handle_rate_headers(response, "search" if is_search else "rest")
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise RuntimeError(f"REST HTTP {response.status_code}: {response.text[:500]}")
        return response.json()

    def search_repositories_count(self, query: str) -> int:
        data = self.rest_get(
            "/search/repositories",
            params={"q": query, "per_page": 1},
        )
        return int(data.get("total_count") or 0) if data else 0

    def search_repositories_page(
        self,
        query: str,
        page: int = 1,
        per_page: int = 100,
        sort: str = "stars",
        order: str = "desc",
    ) -> dict[str, Any]:
        data = self.rest_get(
            "/search/repositories",
            params={
                "q": query,
                "page": page,
                "per_page": per_page,
                "sort": sort,
                "order": order,
            },
        )
        return data or {"total_count": 0, "items": []}

    def get_rate_limit(self) -> dict[str, Any]:
        return self.rest_get("/rate_limit") or {}