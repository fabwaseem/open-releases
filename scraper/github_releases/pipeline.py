from __future__ import annotations

import logging
import time
from typing import Any

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

from .browser import BrowserScraper
from .client import GitHubClient, RateLimitError
from .config import ScraperConfig
from .discovery import (
    Shard,
    StreamingDiscovery,
    coarse_queue,
    iter_shard_graphql_pages,
    iter_shard_rest_pages,
)
from .storage import JsonStore
from .transform import (
    REPO_ENRICH_QUERY,
    build_repository_record,
    is_within_years,
    normalize_graphql_repo,
    normalize_rest_repo,
)

log = logging.getLogger(__name__)
console = Console()


class ReleasesPipeline:
    def __init__(self, config: ScraperConfig) -> None:
        self.config = config
        self.store = JsonStore(config.output_path, config.state_path)
        self.client = GitHubClient(config)
        self.browser: BrowserScraper | None = None
        if config.allow_browser_fallback:
            self.browser = BrowserScraper(config)

    def close(self) -> None:
        self.client.close()
        if self.browser:
            self.browser.close()

    def __enter__(self) -> ReleasesPipeline:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def run_seeds(self, full_names: list[str]) -> None:
        console.print(
            f"[bold]Seed enrich[/bold] count={len(full_names)} "
            f"output={self.config.output_path.resolve()}"
        )
        for full_name in full_names:
            full_name = full_name.strip().strip("/")
            if not full_name or "/" not in full_name:
                continue
            if self.store.has_repo(full_name):
                console.print(f"  skip existing {full_name}")
                continue
            self.store.bump("discovered")
            try:
                self._enrich_and_maybe_store(full_name, base={"full_name": full_name})
            except Exception as exc:  # noqa: BLE001
                log.warning("Seed failed %s: %s", full_name, exc)
                if self.browser:
                    self._enrich_browser(full_name, base={"full_name": full_name})
                else:
                    self.store.bump("errors")
            self.store.save()
        console.print(
            f"[bold green]Done.[/bold green] saved={len(self.store.repos)} "
            f"stats={self.store.state.get('stats', {})}"
        )

    def run(self, *, plan_only: bool = False, use_coarse_shards: bool = False) -> None:
        console.print(
            f"[bold]GitHub Releases Scraper[/bold] (stream: page → process → save)\n"
            f"  min_stars={self.config.min_stars}  pushed_after={self.config.pushed_after}\n"
            f"  output={self.config.output_path.resolve()}\n"
            f"  token={'yes' if self.config.token else 'NO (slow / browser heavy)'}\n"
            f"  already_saved={len(self.store.repos)}"
        )

        discovery = self._build_discovery(use_coarse_shards=use_coarse_shards)
        self._persist_discovery(discovery)

        if plan_only:
            console.print(
                f"[green]Queue ready: {len(discovery.queue)} shard(s) waiting. "
                "Exiting (--plan-only).[/green]"
            )
            return

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("streaming", total=None)

            # Resume mid-shard if we crashed after a saved page.
            current = self.store.state.get("current")
            if current and current.get("shard"):
                shard = Shard.from_dict(current["shard"])
                progress.update(task, description=f"resume {shard.id}")
                self._stream_shard(shard, resume=current)
                discovery.completed.add(shard.id)
                self.store.mark_shard_done(shard.id)
                self._persist_discovery(discovery)
                self.store.save()

            while True:
                if self.config.max_repos and len(self.store.repos) >= self.config.max_repos:
                    console.print("[yellow]Reached --max-repos cap; stopping.[/yellow]")
                    break

                shard = discovery.next_processable_shard()
                self._persist_discovery(discovery)
                if shard is None:
                    break

                progress.update(
                    task,
                    description=(
                        f"{shard.id} | saved={len(self.store.repos)} "
                        f"queue={len(discovery.queue)}"
                    ),
                )
                try:
                    self._stream_shard(shard, resume=None)
                    discovery.completed.add(shard.id)
                    self.store.mark_shard_done(shard.id)
                    self._persist_discovery(discovery)
                    self.store.save()
                except RateLimitError as exc:
                    console.print(f"[yellow]Rate limited on {shard.id}: {exc}[/yellow]")
                    if self.config.allow_browser_fallback and self.browser:
                        self._process_shard_browser(shard)
                        discovery.completed.add(shard.id)
                        self.store.mark_shard_done(shard.id)
                        self._persist_discovery(discovery)
                        self.store.save()
                    else:
                        self._persist_discovery(discovery)
                        self.store.save()
                        raise
                except Exception as exc:  # noqa: BLE001
                    log.exception("Shard failed: %s", shard.id)
                    self.store.bump("errors")
                    self.store.state["last_error"] = {"shard": shard.id, "error": str(exc)}
                    # Put shard back so it can be retried later.
                    discovery.queue.insert(0, shard)
                    self._persist_discovery(discovery)
                    self.store.save()

        self.store.save()
        console.print(
            f"[bold green]Done.[/bold green] saved={len(self.store.repos)} "
            f"stats={self.store.state.get('stats', {})}"
        )

    def _build_discovery(self, *, use_coarse_shards: bool) -> StreamingDiscovery:
        completed = set(self.store.state.get("completed_shards") or [])
        saved_queue = self.store.state.get("shard_queue") or []
        if saved_queue:
            queue = [Shard.from_dict(item) for item in saved_queue]
            console.print(f"Resuming shard queue ({len(queue)} waiting)")
        elif use_coarse_shards:
            queue = coarse_queue(self.config)
            console.print(f"Starting coarse year queue ({len(queue)} years)")
        else:
            queue = None  # root shard
            console.print("Starting from root shard — split & process online")
        return StreamingDiscovery(
            self.client,
            self.config,
            queue=queue,
            completed=completed,
        )

    def _persist_discovery(self, discovery: StreamingDiscovery) -> None:
        self.store.set_progress(
            queue=discovery.export_queue(),
            current=self.store.state.get("current"),
        )

    def _stream_shard(self, shard: Shard, resume: dict[str, Any] | None) -> None:
        """Fetch one page, process repos, save — never buffers the whole shard."""
        mode = (resume or {}).get("mode") or "graphql"
        if mode == "rest":
            self._stream_shard_rest(shard, start_page=int((resume or {}).get("page") or 1))
            return
        try:
            self._stream_shard_graphql(
                shard, start_cursor=(resume or {}).get("cursor")
            )
        except RateLimitError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("GraphQL page stream failed for %s (%s); REST", shard.id, exc)
            self._stream_shard_rest(shard, start_page=1)

    def _stream_shard_graphql(
        self, shard: Shard, start_cursor: str | None = None
    ) -> None:
        for nodes, next_cursor, has_more in iter_shard_graphql_pages(
            self.client,
            shard,
            self.config.base_search_qualifiers(),
            start_cursor=start_cursor,
        ):
            for node in nodes:
                if not node.get("nameWithOwner"):
                    continue
                self._ingest_search_node(node)
                if self.config.max_repos and len(self.store.repos) >= self.config.max_repos:
                    self.store.set_progress(
                        queue=self.store.state.get("shard_queue") or [],
                        current={
                            "shard": shard.to_dict(),
                            "shard_id": shard.id,
                            "mode": "graphql",
                            "cursor": next_cursor,
                        },
                    )
                    self.store.save()
                    return

            self.store.bump("pages_processed")
            self.store.set_progress(
                queue=self.store.state.get("shard_queue") or [],
                current={
                    "shard": shard.to_dict(),
                    "shard_id": shard.id,
                    "mode": "graphql",
                    "cursor": next_cursor if has_more else None,
                }
                if has_more
                else None,
            )
            self.store.save()
            console.print(
                f"  page saved · shard={shard.id} · repos={len(self.store.repos)} "
                f"· has_more={has_more}"
            )
            if not has_more:
                break
            # Drop page nodes from scope; next iteration fetches fresh.
            nodes = []

    def _stream_shard_rest(self, shard: Shard, start_page: int = 1) -> None:
        for items, next_page, has_more in iter_shard_rest_pages(
            self.client,
            shard,
            self.config.base_search_qualifiers(),
            start_page=start_page,
        ):
            for item in items:
                full_name = item.get("full_name")
                if not full_name or self.store.has_repo(full_name):
                    continue
                self.store.bump("discovered")
                self._enrich_and_maybe_store(full_name, base=normalize_rest_repo(item))
                if self.config.max_repos and len(self.store.repos) >= self.config.max_repos:
                    self.store.set_progress(
                        queue=self.store.state.get("shard_queue") or [],
                        current={
                            "shard": shard.to_dict(),
                            "shard_id": shard.id,
                            "mode": "rest",
                            "page": next_page,
                        },
                    )
                    self.store.save()
                    return

            self.store.bump("pages_processed")
            self.store.set_progress(
                queue=self.store.state.get("shard_queue") or [],
                current={
                    "shard": shard.to_dict(),
                    "shard_id": shard.id,
                    "mode": "rest",
                    "page": next_page,
                }
                if has_more
                else None,
            )
            self.store.save()
            console.print(
                f"  page saved · shard={shard.id} · repos={len(self.store.repos)} "
                f"· next_page={next_page if has_more else 'done'}"
            )
            items = []

    def _process_shard_browser(self, shard: Shard) -> None:
        assert self.browser is not None
        self.store.bump("browser_fallback_uses")
        query = shard.query(self.config.base_search_qualifiers())
        for page in range(1, 11):
            try:
                results = self.browser.search_repositories(query, page=page)
            except Exception as exc:  # noqa: BLE001
                log.warning("Browser search failed page=%s: %s", page, exc)
                break
            if not results:
                break
            for item in results:
                full_name = item["full_name"]
                if self.store.has_repo(full_name):
                    continue
                self.store.bump("discovered")
                try:
                    self._enrich_and_maybe_store(full_name, base=normalize_rest_repo(item))
                except Exception:  # noqa: BLE001
                    self._enrich_browser(full_name, base=normalize_rest_repo(item))
                if self.config.max_repos and len(self.store.repos) >= self.config.max_repos:
                    self.store.save()
                    return
            self.store.bump("pages_processed")
            self.store.save()
            console.print(
                f"  browser page {page} saved · repos={len(self.store.repos)}"
            )

    def _ingest_search_node(self, node: dict[str, Any]) -> None:
        full_name = node["nameWithOwner"]
        if self.store.has_repo(full_name):
            return
        self.store.bump("discovered")

        releases_conn = node.get("releases") or {}
        total = int(releases_conn.get("totalCount") or 0)
        if total <= 0:
            self.store.bump("skipped_no_releases")
            return

        # Fast path: search payload already includes recent releases/assets.
        preview = releases_conn.get("nodes") or []
        if preview:
            record = build_repository_record(
                normalize_graphql_repo(node),
                preview,
                releases_count=total,
                source="graphql_search",
            )
            if record and (
                is_within_years(node.get("pushedAt"), 5)
                or is_within_years(
                    (record.get("latest_release") or {}).get("published_at"), 5
                )
            ):
                self.store.upsert_repo(record)
                return

        self._enrich_and_maybe_store(full_name, base=normalize_graphql_repo(node))

    def _enrich_and_maybe_store(
        self,
        full_name: str,
        base: dict[str, Any] | None = None,
    ) -> None:
        owner, name = full_name.split("/", 1)
        try:
            releases, total, repo_node = self._fetch_releases(owner, name)
        except RateLimitError:
            if self.browser:
                self._enrich_browser(full_name, base=base)
                return
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("Enrich failed for %s: %s", full_name, exc)
            if self.browser:
                self._enrich_browser(full_name, base=base)
                return
            self.store.bump("errors")
            return

        if total <= 0 and not releases:
            self.store.bump("skipped_no_releases")
            return

        repo = normalize_graphql_repo(repo_node) if repo_node else (base or {"full_name": full_name})
        record = build_repository_record(
            repo,
            releases,
            releases_count=total,
            source="graphql",
        )
        if not record:
            self.store.bump("skipped_no_assets")
            return

        if not is_within_years(repo.get("pushed_at"), 5) and not is_within_years(
            (record.get("latest_release") or {}).get("published_at"), 5
        ):
            self.store.bump("skipped_no_releases")
            return

        self.store.upsert_repo(record)

    def _fetch_releases(
        self, owner: str, name: str
    ) -> tuple[list[dict[str, Any]], int, dict[str, Any] | None]:
        data = self.client.graphql(
            REPO_ENRICH_QUERY,
            {
                "owner": owner,
                "name": name,
                "releasesFirst": self.config.max_releases_per_repo,
                "assetsFirst": self.config.max_assets_per_release,
                "after": None,
            },
        )
        repo_node = data.get("repository")
        if not repo_node:
            return [], 0, None
        conn = repo_node.get("releases") or {}
        total = int(conn.get("totalCount") or 0)
        releases = [
            node
            for node in (conn.get("nodes") or [])
            if not node.get("isDraft")
            and (self.config.include_prereleases or not node.get("isPrerelease"))
        ]
        return releases, total, repo_node

    def _enrich_browser(self, full_name: str, base: dict[str, Any] | None = None) -> None:
        assert self.browser is not None
        self.store.bump("browser_fallback_uses")
        try:
            scraped = self.browser.scrape_releases(
                full_name, max_releases=self.config.max_releases_per_repo
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Browser enrich failed for %s: %s", full_name, exc)
            self.store.bump("errors")
            return

        releases = scraped.get("releases") or []
        if not releases:
            self.store.bump("skipped_no_releases")
            return

        repo = base or {
            "full_name": full_name,
            "name": full_name.split("/", 1)[1],
            "html_url": f"https://github.com/{full_name}",
        }
        record = build_repository_record(
            repo,
            releases,
            releases_count=scraped.get("releases_count"),
            source="browser_dom",
        )
        if not record:
            self.store.bump("skipped_no_assets")
            return

        self.store.upsert_repo(record)
        time.sleep(self.config.browser_sleep_seconds)
