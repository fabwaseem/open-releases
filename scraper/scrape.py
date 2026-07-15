#!/usr/bin/env python3
"""
GitHub Releases Directory — repository scraper (step 1).

Discovers public repos with >= N stars, activity in the last ~5 years, and
downloadable GitHub Releases. Writes a rich JSON catalog you can build a
directory website on top of.

Strategy
--------
Streams page-by-page (no upfront full crawl):
1. Count one shard → if >1000 split → else fetch 1 search page.
2. Process that page's repos immediately and save to disk.
3. Continue; resume from scrape_state.json / repositories.jsonl on crash.
4. GraphQL primary; HTML/DOM fallback when rate-limited.

Setup
-----
  cd scraper
  python -m venv .venv
  .venv\\Scripts\\activate          # Windows
  pip install -r requirements.txt
  copy .env.example .env           # then set GITHUB_TOKEN

Examples
--------
  # Smoke test: plan shards only
  python scrape.py --plan-only

  # Small real scrape (first 50 matching repos)
  python scrape.py --max-repos 50 --min-stars 5000

  # Full scrape (hours/days — resume anytime)
  python scrape.py --min-stars 100

  # Faster planning (skip recursive count splits; denser shards)
  python scrape.py --coarse-shards --min-stars 100
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

# Allow `python scrape.py` from the scraper/ directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from github_releases.config import ScraperConfig  # noqa: E402
from github_releases.pipeline import ReleasesPipeline  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Scrape GitHub repositories that publish downloadable Releases.",
    )
    p.add_argument("--min-stars", type=int, default=100, help="Minimum stars (default: 100)")
    p.add_argument(
        "--pushed-after",
        type=str,
        default=None,
        help="Only repos pushed after YYYY-MM-DD (default: ~5 years ago)",
    )
    p.add_argument(
        "--max-repos",
        type=int,
        default=0,
        help="Stop after saving N repos (0 = unlimited)",
    )
    p.add_argument(
        "--max-releases",
        type=int,
        default=5,
        help="Release window to scan while picking latest desktop build (default: 5)",
    )
    p.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "data",
        help="Directory for repositories.json + scrape_state.json",
    )
    p.add_argument(
        "--plan-only",
        action="store_true",
        help="Build/search shard plan only; do not enrich repos",
    )
    p.add_argument(
        "--coarse-shards",
        action="store_true",
        help="Use year×star grid without recursive count planning (saves search quota)",
    )
    p.add_argument(
        "--include-no-assets",
        action="store_true",
        help="Keep repos that have Releases but zero downloadable assets",
    )
    p.add_argument(
        "--include-forks",
        action="store_true",
        help="Include forked repositories",
    )
    p.add_argument(
        "--include-archived",
        action="store_true",
        help="Include archived repositories",
    )
    p.add_argument(
        "--no-browser-fallback",
        action="store_true",
        help="Disable HTML/DOM scraping fallback when API is rate-limited",
    )
    p.add_argument(
        "--seed",
        action="append",
        default=[],
        metavar="OWNER/REPO",
        help="Skip discovery; enrich these repos (repeatable). Great for smoke tests.",
    )
    p.add_argument(
        "--seed-file",
        type=Path,
        default=None,
        help="Text file with one owner/repo per line",
    )
    p.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Debug logging",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    load_dotenv(Path(__file__).resolve().parent / ".env")
    load_dotenv()

    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    overrides: dict = {
        "min_stars": args.min_stars,
        "max_repos": args.max_repos,
        "max_releases_per_repo": args.max_releases,
        "data_dir": args.data_dir,
        "require_assets": not args.include_no_assets,
        "exclude_forks": not args.include_forks,
        "exclude_archived": not args.include_archived,
        "allow_browser_fallback": not args.no_browser_fallback,
    }
    if args.pushed_after:
        overrides["pushed_after"] = args.pushed_after

    config = ScraperConfig.from_env(**overrides)

    if not config.token:
        print(
            "WARNING: GITHUB_TOKEN not set. Create scraper/.env from .env.example.\n"
            "Unauthenticated mode is extremely rate-limited; expect mostly browser fallback.",
            file=sys.stderr,
        )

    seeds = list(args.seed or [])
    if args.seed_file and args.seed_file.exists():
        seeds.extend(
            line.strip()
            for line in args.seed_file.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        )

    with ReleasesPipeline(config) as pipeline:
        if seeds:
            pipeline.run_seeds(seeds)
        else:
            pipeline.run(plan_only=args.plan_only, use_coarse_shards=args.coarse_shards)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())