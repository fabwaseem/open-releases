from __future__ import annotations

import logging
import re
import time
from typing import Any
from urllib.parse import quote, quote_plus, unquote, urljoin

import httpx
from bs4 import BeautifulSoup, Tag

from .config import ScraperConfig

log = logging.getLogger(__name__)

SEARCH_URL = "https://github.com/search"
_TAG_HREF = re.compile(r"/releases/tag/([^?#]+)")


class BrowserScraper:
    """
    DOM-based fallback when the Search API is rate-limited.

    Parses public GitHub HTML pages (no headless browser required).
    GitHub markup changes occasionally — treat this as a best-effort path.
    """

    def __init__(self, config: ScraperConfig) -> None:
        self.config = config
        headers = {
            "User-Agent": config.user_agent,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        }
        self._http = httpx.Client(
            headers=headers,
            timeout=config.request_timeout,
            follow_redirects=True,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> BrowserScraper:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _get(self, url: str) -> httpx.Response:
        time.sleep(self.config.browser_sleep_seconds)
        response = self._http.get(url)
        if response.status_code in {403, 429}:
            retry_after = float(response.headers.get("Retry-After", "30"))
            log.warning(
                "Browser scrape blocked (%s). Sleeping %.0fs",
                response.status_code,
                retry_after,
            )
            time.sleep(retry_after)
            response = self._http.get(url)
        return response

    def _get_soup(self, url: str) -> BeautifulSoup:
        response = self._get(url)
        response.raise_for_status()
        return BeautifulSoup(response.text, "lxml")

    def search_repositories(self, query: str, page: int = 1) -> list[dict[str, Any]]:
        """Return lightweight repo dicts from github.com/search HTML."""
        url = (
            f"{SEARCH_URL}?q={quote_plus(query)}"
            f"&type=repositories&s=stars&o=desc&p={page}"
        )
        soup = self._get_soup(url)
        results: list[dict[str, Any]] = []

        # Modern search results: anchors under repository result cards.
        for link in soup.select('a[data-hydro-click*="search-results"], a.Link__StyledLink'):
            href = link.get("href") or ""
            text = link.get_text(" ", strip=True)
            if not re.fullmatch(r"/[^/]+/[^/]+", href):
                continue
            full_name = href.strip("/")
            if "/" not in full_name or full_name in {r["full_name"] for r in results}:
                continue
            results.append(
                {
                    "full_name": full_name,
                    "html_url": urljoin("https://github.com", href),
                    "name": full_name.split("/", 1)[1],
                    "owner": {"login": full_name.split("/", 1)[0]},
                    "description": text if text and text != full_name else None,
                    "source": "browser_search",
                }
            )

        # Fallback selectors used by classic search markup.
        if not results:
            for item in soup.select(".repo-list-item, [data-testid='results-list'] > div"):
                a = item.select_one("a[href^='/']")
                if not a:
                    continue
                href = a.get("href") or ""
                if not re.fullmatch(r"/[^/]+/[^/]+", href):
                    continue
                full_name = href.strip("/")
                desc_el = item.select_one("p, [class*='Description']")
                stars_el = item.find(string=re.compile(r"stars?", re.I))
                results.append(
                    {
                        "full_name": full_name,
                        "html_url": urljoin("https://github.com", href),
                        "name": full_name.split("/", 1)[1],
                        "owner": {"login": full_name.split("/", 1)[0]},
                        "description": desc_el.get_text(" ", strip=True) if desc_el else None,
                        "stargazers_count": _parse_compact_number(
                            stars_el.parent.get_text(" ", strip=True) if stars_el and stars_el.parent else ""
                        ),
                        "source": "browser_search",
                    }
                )

        # Last resort: any /owner/repo links in the main content.
        if not results:
            for a in soup.select("main a[href]"):
                href = a.get("href") or ""
                if re.fullmatch(r"/[^/]+/[^/]+", href):
                    full_name = href.strip("/")
                    if full_name not in {r["full_name"] for r in results}:
                        results.append(
                            {
                                "full_name": full_name,
                                "html_url": urljoin("https://github.com", href),
                                "name": full_name.split("/", 1)[1],
                                "owner": {"login": full_name.split("/", 1)[0]},
                                "source": "browser_search",
                            }
                        )
        return results

    def scrape_releases(self, full_name: str, max_releases: int = 20) -> dict[str, Any]:
        """Parse /releases and /releases/expanded_assets pages for a repo."""
        owner, repo = full_name.split("/", 1)
        url = f"https://github.com/{owner}/{repo}/releases"
        soup = self._get_soup(url)

        releases: list[dict[str, Any]] = []
        seen_tags: set[str] = set()

        # Each release has a primary title link: /owner/repo/releases/tag/<tag>
        for tag_link in soup.select("a[href*='/releases/tag/']"):
            href = tag_link.get("href") or ""
            m = _TAG_HREF.search(href)
            if not m:
                continue
            tag_name = unquote(m.group(1))
            if tag_name in seen_tags:
                continue
            # Skip footer/ aside clones that aren't release titles.
            classes = " ".join(tag_link.get("class") or [])
            if "Link--primary" not in classes and "f1" not in classes:
                # Still accept if it's the only clear tag link nearby.
                parent_text = tag_link.parent.get_text(" ", strip=True) if tag_link.parent else ""
                if parent_text and parent_text != tag_link.get_text(strip=True):
                    # Prefer title links; continue scanning.
                    pass

            seen_tags.add(tag_name)
            block = _release_block(tag_link)
            title = tag_link.get_text(strip=True) or tag_name
            body_el = block.select_one(".markdown-body") if block else None
            date_el = block.select_one("relative-time") if block else None

            assets = _assets_from_element(block) if block else []
            fragment_url = _expanded_assets_url(block, owner, repo, tag_name) if block else None
            if not assets:
                assets = self._scrape_expanded_assets_url(
                    fragment_url
                    or f"https://github.com/{owner}/{repo}/releases/expanded_assets/{quote(tag_name, safe='')}"
                )

            releases.append(
                {
                    "tag_name": tag_name,
                    "name": title,
                    "html_url": urljoin("https://github.com", href),
                    "published_at": date_el.get("datetime") if date_el else None,
                    "body": body_el.get_text("\n", strip=True)[:5000] if body_el else None,
                    "prerelease": bool(
                        block
                        and block.find(string=re.compile(r"Pre-release|Release Candidate|Beta", re.I))
                    ),
                    "draft": False,
                    "assets": assets,
                    "assets_count": len(assets),
                    "source": "browser_dom",
                }
            )
            if len(releases) >= max_releases:
                break

        return {
            "full_name": full_name,
            "releases_count": len(releases),
            "releases": releases,
            "latest_release": releases[0] if releases else None,
            "source": "browser_dom",
        }

    def _scrape_expanded_assets_url(self, url: str) -> list[dict[str, Any]]:
        try:
            response = self._get(url)
            if response.status_code == 404:
                return []
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "lxml")
        except Exception as exc:  # noqa: BLE001
            log.debug("expanded_assets failed for %s: %s", url, exc)
            return []
        return _assets_from_element(soup)


def _release_block(tag_link: Tag) -> Tag | None:
    node: Tag | None = tag_link
    for _ in range(12):
        if node is None:
            break
        if node.name in {"section", "div"} and (
            node.get("data-test-selector") == "release"
            or (node.select_one("include-fragment[src*='expanded_assets']") is not None)
            or (node.select_one("a[href*='/releases/download/']") is not None)
            or (node.select_one(".markdown-body") is not None and node.select_one("relative-time"))
        ):
            return node
        node = node.parent if isinstance(node.parent, Tag) else None
    # Fallback: walk up a few levels for a wide container.
    node = tag_link
    for _ in range(6):
        if node is None:
            break
        if node.name in {"section", "div"}:
            return node
        node = node.parent if isinstance(node.parent, Tag) else None
    return None


def _expanded_assets_url(
    block: Tag, owner: str, repo: str, tag_name: str
) -> str | None:
    frag = block.select_one(
        "include-fragment[src*='expanded_assets'], include-fragment[data-deferred-src*='expanded_assets']"
    )
    if frag:
        src = frag.get("src") or frag.get("data-deferred-src")
        if src:
            return urljoin("https://github.com", src)
    return f"https://github.com/{owner}/{repo}/releases/expanded_assets/{quote(tag_name, safe='')}"


def _assets_from_element(root: Tag | BeautifulSoup | None) -> list[dict[str, Any]]:
    if root is None:
        return []
    assets: list[dict[str, Any]] = []
    seen: set[str] = set()
    for asset_a in root.select("a[href*='/releases/download/']"):
        href = asset_a.get("href") or ""
        if href in seen:
            continue
        seen.add(href)
        name = asset_a.get_text(strip=True) or unquote(href.rstrip("/").split("/")[-1])
        row = asset_a.find_parent("div") or asset_a.parent
        size_text = ""
        downloads = None
        if row:
            text = row.get_text(" ", strip=True)
            m = re.search(r"(\d+(?:\.\d+)?\s*(?:KB|MB|GB|B))\b", text, re.I)
            if m:
                size_text = m.group(1)
            dm = re.search(r"([\d,]+)\s+downloads?", text, re.I)
            if dm:
                downloads = int(dm.group(1).replace(",", ""))
        assets.append(
            {
                "name": name,
                "browser_download_url": urljoin("https://github.com", href),
                "size_label": size_text,
                "size": _parse_size_bytes(size_text),
                "download_count": downloads,
                "content_type": None,
            }
        )
    return assets


def _parse_compact_number(text: str) -> int | None:
    m = re.search(r"([\d,.]+)\s*([kKmMbB])?", text.replace(",", ""))
    if not m:
        return None
    value = float(m.group(1))
    suffix = (m.group(2) or "").lower()
    if suffix == "k":
        value *= 1_000
    elif suffix == "m":
        value *= 1_000_000
    elif suffix == "b":
        value *= 1_000_000_000
    return int(value)


def _parse_size_bytes(text: str) -> int | None:
    m = re.search(r"([\d.]+)\s*(B|KB|MB|GB|TB)", text, re.I)
    if not m:
        return None
    value = float(m.group(1))
    unit = m.group(2).upper()
    mult = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}
    return int(value * mult[unit])