#!/usr/bin/env tsx
/**
 * Sequential scraper — discovers repos, then enriches via Core REST.
 *
 * Discovery (default: API when GITHUB_TOKEN is set):
 *   - api  → REST /search/repositories (30 req/min, auth) — preferred
 *   - html → github.com/search pages (unauthenticated, easy to 429)
 * Enrichment: Core REST /repos + /releases (5k/hour with token)
 *
 * Note: GraphQL `search` shares the same 30/min Search rate limit as REST
 * search, so we use REST for discovery (simpler pagination).
 *
 * Usage:
 *   pnpm scrape
 *   pnpm scrape -- --min-stars 500 --max-repos 100
 *   pnpm scrape -- --query "stars:>100 language:C# archived:false"
 *   pnpm scrape -- --discovery html   # force browser pages
 *   pnpm scrape -- --discovery api    # force Search API (needs token)
 */
import "dotenv/config"

import { searchReposHtml } from "./browser.js"
import {
  StreamingDiscovery,
  parseSearchQuery,
  shardId,
  shardQuery,
  yearsAgo,
  type Shard,
} from "./discovery.js"
import {
  RateLimitError,
  fetchRepoAndReleases,
  hasGithubToken,
  searchReposApi,
} from "./github.js"
import {
  alreadyScraped,
  markScrape,
  prisma,
  saveRepoFromRest,
} from "./store.js"

type DiscoveryMode = "api" | "html"

type Args = {
  query: string
  minStars: number
  maxRepos: number
  pushedAfter: string
  discovery: DiscoveryMode
}

function hasFlag(argv: string[], flag: string) {
  return argv.includes(flag)
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback
  }

  const query = get("--query", get("-q", ""))
  const parsed = parseSearchQuery(query)
  const minStarsExplicit =
    hasFlag(argv, "--min-stars") || hasFlag(argv, "--minStars")

  let minStars = Number(get("--min-stars", "100"))
  if (!minStarsExplicit && parsed.minStars != null) {
    minStars = parsed.minStars
  } else if (minStarsExplicit && parsed.minStars != null) {
    minStars = Math.max(minStars, parsed.minStars)
  }

  const discoveryRaw = get("--discovery", "auto").toLowerCase()
  let discovery: DiscoveryMode
  if (discoveryRaw === "html") {
    discovery = "html"
  } else if (discoveryRaw === "api") {
    discovery = "api"
  } else {
    discovery = hasGithubToken() ? "api" : "html"
  }

  return {
    query,
    minStars,
    maxRepos: Number(get("--max-repos", "0")),
    pushedAfter: get("--pushed-after", yearsAgo(5)),
    discovery,
  }
}

async function processFullName(
  fullName: string,
  stats: Record<string, number>
) {
  const prior = await alreadyScraped(fullName)
  if (prior && prior.status !== "error" && prior.status !== "discovered") {
    stats.skipped_known += 1
    return
  }

  stats.discovered += 1
  await markScrape(fullName, "discovered")

  try {
    const data = await fetchRepoAndReleases(fullName)
    if (!data) {
      await markScrape(fullName, "error", "repo not found")
      stats.errors += 1
      return
    }

    const result = await saveRepoFromRest(
      data.repo,
      data.releases,
      data.activity
    )
    if (result.saved) {
      stats.saved += 1
      console.log(
        `saved ${fullName} score=${result.score.toFixed(1)} (${stats.saved})`
      )
    } else if (result.reason === "no_releases") {
      stats.skipped_no_releases += 1
      console.log(`skip ${fullName}: no releases`)
    } else if (result.reason === "non_app") {
      stats.skipped_non_app += 1
      console.log(`skip ${fullName}: non-app / cli-server`)
    } else {
      stats.skipped_no_assets += 1
      console.log(`skip ${fullName}: no installable assets`)
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err
    stats.errors += 1
    const message = err instanceof Error ? err.message : String(err)
    await markScrape(fullName, "error", message.slice(0, 500))
    console.warn(`error ${fullName}: ${message}`)
  }
}

async function searchPage(
  mode: DiscoveryMode,
  query: string,
  page: number
): Promise<{ hits: Array<{ fullName: string }>; totalCount?: number }> {
  if (mode === "api") {
    const { hits, totalCount } = await searchReposApi(query, page)
    return { hits, totalCount }
  }
  const hits = await searchReposHtml(query, page)
  return { hits }
}

/** @returns true if the shard finished (done or split); false if stopped early */
async function streamShard(
  shard: Shard,
  args: Args,
  stats: Record<string, number>,
  discovery: StreamingDiscovery
): Promise<boolean> {
  const query = shardQuery(
    shard,
    args.minStars,
    args.pushedAfter,
    args.query
  )
  console.log(`shard ${shardId(shard)}`)
  console.log(`  q: ${query}`)
  let lastPageCount = 0
  let reachedEnd = false
  // API: 100/page → 10 pages = 1000 cap. HTML: ~10/page → 100 pages.
  const maxPages = args.discovery === "api" ? 10 : 100

  for (let page = 1; page <= maxPages; page++) {
    if (args.maxRepos && stats.saved >= args.maxRepos) return false

    let result: { hits: Array<{ fullName: string }>; totalCount?: number }
    try {
      result = await searchPage(args.discovery, query, page)
    } catch (err) {
      if (err instanceof RateLimitError) throw err
      console.warn(`${args.discovery} page ${page} failed:`, err)
      await new Promise((r) => setTimeout(r, 10_000))
      result = await searchPage(args.discovery, query, page)
    }

    const { hits, totalCount } = result
    lastPageCount = hits.length
    if (!hits.length) {
      console.log(`page ${page}: empty — shard done`)
      reachedEnd = true
      break
    }

    const totalHint =
      totalCount != null ? ` (search total≈${totalCount})` : ""
    console.log(`page ${page}: ${hits.length} repos${totalHint}`)
    for (const hit of hits) {
      if (args.maxRepos && stats.saved >= args.maxRepos) return false
      await processFullName(hit.fullName, stats)
    }

    if (page === maxPages) reachedEnd = true
  }

  if (!reachedEnd) return false

  // Hit the ~1000-result search cap — split shard and continue.
  if (lastPageCount > 0) {
    console.log(`shard hit page cap — splitting ${shardId(shard)}`)
    discovery.requeueSplit(shard)
  }
  discovery.completed.add(shardId(shard))
  return true
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing")
  }
  if (!hasGithubToken()) {
    console.warn(
      "WARNING: no GITHUB_TOKEN — discovery falls back to HTML; Core REST limits will be low"
    )
  }

  const args = parseArgs(process.argv.slice(2))
  if (args.discovery === "api" && !hasGithubToken()) {
    throw new Error(
      "Discovery mode is api but GITHUB_TOKEN / GH_TOKEN is not set. Add a token or pass --discovery html."
    )
  }

  const stats = {
    discovered: 0,
    saved: 0,
    skipped_known: 0,
    skipped_no_releases: 0,
    skipped_no_assets: 0,
    skipped_non_app: 0,
    errors: 0,
  }

  console.log(
    `scrape start discovery=${args.discovery} query=${args.query ? JSON.stringify(args.query) : "(none)"} minStars=${args.minStars} pushedAfter=${args.pushedAfter}`
  )
  if (args.query) {
    const preview = shardQuery(
      {
        starsMin: args.minStars,
        starsMax: null,
        createdStart: "2024-01-01",
        createdEnd: "2024-12-31",
      },
      args.minStars,
      args.pushedAfter,
      args.query
    )
    console.log(`  sample shard q: ${preview}`)
  }

  const discovery = new StreamingDiscovery({
    minStars: args.minStars,
    pushedAfter: args.pushedAfter,
  })

  while (true) {
    if (args.maxRepos && stats.saved >= args.maxRepos) break
    const shard = discovery.nextShard()
    if (!shard) break

    try {
      const finished = await streamShard(shard, args, stats, discovery)
      if (!finished) {
        discovery.queue.unshift(shard)
        break
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        const wait = err.resetAt
          ? Math.min(
              Math.max(err.resetAt * 1000 - Date.now() + 1000, 5_000),
              120_000
            )
          : 60_000
        console.warn(`API rate limit — waiting ${Math.round(wait / 1000)}s`)
        await new Promise((r) => setTimeout(r, wait))
        discovery.queue.unshift(shard)
        continue
      }
      console.error(`shard failed ${shardId(shard)}`, err)
      discovery.queue.unshift(shard)
      await new Promise((r) => setTimeout(r, 15_000))
    }
  }

  console.log("done", stats)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
