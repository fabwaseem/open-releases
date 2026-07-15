from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .platforms import filter_desktop_assets, summarize_platforms


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def is_within_years(iso: str | None, years: float = 5.0) -> bool:
    dt = _parse_dt(iso)
    if not dt:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - dt).total_seconds() / 86400
    return age_days <= years * 365.25


def normalize_rest_repo(item: dict[str, Any]) -> dict[str, Any]:
    owner = item.get("owner") or {}
    return {
        "full_name": item.get("full_name"),
        "name": item.get("name"),
        "owner_login": (owner.get("login") if isinstance(owner, dict) else None)
        or (item.get("full_name") or "").split("/", 1)[0],
        "description": item.get("description"),
        "html_url": item.get("html_url"),
        "homepage": item.get("homepage") or None,
        "stars": item.get("stargazers_count"),
        "language": item.get("language"),
        "topics": item.get("topics") or [],
        "pushed_at": item.get("pushed_at"),
        "avatar_url": owner.get("avatar_url") if isinstance(owner, dict) else None,
    }


def normalize_graphql_repo(node: dict[str, Any]) -> dict[str, Any]:
    owner = node.get("owner") or {}
    topics = [
        (n.get("topic") or {}).get("name")
        for n in (node.get("repositoryTopics") or {}).get("nodes") or []
        if (n.get("topic") or {}).get("name")
    ]
    primary = node.get("primaryLanguage") or {}
    license_info = node.get("licenseInfo") or {}
    return {
        "full_name": node.get("nameWithOwner"),
        "name": node.get("name"),
        "owner_login": owner.get("login"),
        "description": node.get("description"),
        "html_url": node.get("url"),
        "homepage": node.get("homepageUrl") or None,
        "stars": node.get("stargazerCount"),
        "language": primary.get("name"),
        "topics": topics,
        "license": license_info.get("spdxId") or license_info.get("name"),
        "pushed_at": node.get("pushedAt"),
        "avatar_url": owner.get("avatarUrl"),
    }


def _extract_assets(release: dict[str, Any]) -> list[dict[str, Any]]:
    assets_raw = release.get("releaseAssets")
    if isinstance(assets_raw, dict):
        nodes = assets_raw.get("nodes") or []
    else:
        nodes = release.get("assets") or []

    out: list[dict[str, Any]] = []
    for asset in nodes:
        name = asset.get("name") or ""
        out.append(
            {
                "name": name,
                "size": asset.get("size"),
                "download_count": asset.get("downloadCount", asset.get("download_count")),
                "url": asset.get("downloadUrl")
                or asset.get("browser_download_url")
                or asset.get("url"),
            }
        )
    return out


def normalize_latest_release(release: dict[str, Any]) -> dict[str, Any] | None:
    """Keep only UI fields for the latest release + desktop app assets."""
    raw_assets = _extract_assets(release)
    assets = filter_desktop_assets(raw_assets)
    if not assets:
        return None

    platforms = summarize_platforms(assets)
    # Slim asset rows for the frontend download buttons.
    slim_assets = [
        {
            "name": a["name"],
            "platform": a["platform"],
            "size": a.get("size"),
            "download_count": a.get("download_count"),
            "url": a.get("url"),
        }
        for a in assets
    ]
    return {
        "tag": release.get("tagName") or release.get("tag_name"),
        "name": release.get("name"),
        "published_at": release.get("publishedAt") or release.get("published_at"),
        "url": release.get("url") or release.get("html_url"),
        "prerelease": bool(
            release.get("isPrerelease", release.get("prerelease", False))
        ),
        "assets": slim_assets,
        "platforms": platforms["platforms"],
        "has_windows": platforms["has_windows"],
        "has_macos": platforms["has_macos"],
        "has_linux": platforms["has_linux"],
    }


def pick_latest_usable_release(
    releases: list[dict[str, Any]],
    *,
    prefer_stable: bool = True,
) -> dict[str, Any] | None:
    """Pick newest release that has desktop installers; prefer non-prerelease."""
    normalized: list[tuple[str, dict[str, Any]]] = []
    for release in releases:
        if release.get("isDraft") or release.get("draft"):
            continue
        slim = normalize_latest_release(release)
        if not slim:
            continue
        key = slim.get("published_at") or ""
        normalized.append((key, slim))

    if not normalized:
        return None

    normalized.sort(key=lambda item: item[0], reverse=True)
    if prefer_stable:
        for _, slim in normalized:
            if not slim.get("prerelease"):
                return slim
    return normalized[0][1]


def build_repository_record(
    repo: dict[str, Any],
    releases: list[dict[str, Any]],
    *,
    releases_count: int | None = None,
    source: str = "api",
) -> dict[str, Any] | None:
    """
    UI-oriented repository catalog record.

    Returns None when there is no latest release with Windows/macOS/Linux apps.
    """
    latest = pick_latest_usable_release(releases, prefer_stable=True)
    if not latest:
        return None

    full_name = repo.get("full_name") or repo.get("nameWithOwner")
    owner_login = repo.get("owner_login") or (
        full_name.split("/", 1)[0] if full_name and "/" in full_name else None
    )

    return {
        "full_name": full_name,
        "name": repo.get("name") or (full_name.split("/", 1)[1] if full_name else None),
        "owner": owner_login,
        "description": repo.get("description"),
        "url": repo.get("html_url") or (f"https://github.com/{full_name}" if full_name else None),
        "homepage": repo.get("homepage") or None,
        "stars": repo.get("stars") or repo.get("stargazers_count") or 0,
        "language": repo.get("language"),
        "topics": repo.get("topics") or [],
        "license": repo.get("license"),
        "avatar_url": repo.get("avatar_url"),
        "pushed_at": repo.get("pushed_at"),
        "releases_count": releases_count,
        "platforms": latest["platforms"],
        "has_windows": latest["has_windows"],
        "has_macos": latest["has_macos"],
        "has_linux": latest["has_linux"],
        "latest_release": latest,
    }


# Lean GraphQL: only fields the UI needs + enough releases to find a stable build.
REPO_ENRICH_QUERY = """
query($owner: String!, $name: String!, $releasesFirst: Int!, $assetsFirst: Int!, $after: String) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    name
    nameWithOwner
    description
    url
    homepageUrl
    stargazerCount
    pushedAt
    primaryLanguage { name }
    repositoryTopics(first: 12) {
      nodes { topic { name } }
    }
    licenseInfo { spdxId name }
    owner {
      login
      ... on User { avatarUrl }
      ... on Organization { avatarUrl }
    }
    releases(first: $releasesFirst, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        tagName
        url
        publishedAt
        isPrerelease
        isDraft
        releaseAssets(first: $assetsFirst) {
          nodes {
            name
            size
            downloadCount
            downloadUrl
          }
        }
      }
    }
  }
}
"""

SEARCH_REPOS_GRAPHQL = """
query($query: String!, $cursor: String) {
  rateLimit { cost remaining resetAt }
  search(query: $query, type: REPOSITORY, first: 100, after: $cursor) {
    repositoryCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Repository {
        nameWithOwner
        name
        description
        url
        homepageUrl
        stargazerCount
        pushedAt
        primaryLanguage { name }
        repositoryTopics(first: 8) {
          nodes { topic { name } }
        }
        owner {
          login
          ... on User { avatarUrl }
          ... on Organization { avatarUrl }
        }
        releases(first: 3, orderBy: {field: CREATED_AT, direction: DESC}) {
          totalCount
          nodes {
            tagName
            publishedAt
            isPrerelease
            isDraft
            releaseAssets(first: 40) {
              nodes { name size downloadCount downloadUrl }
            }
          }
        }
      }
    }
  }
}
"""