#!/usr/bin/env tsx
/**
 * Sequential scraper — avoids GitHub Search API rate limits.
 *
 * Discovery: HTML pages on github.com/search (no API count/search)
 * Enrichment: Core REST /repos + /releases (5k/hour with token)
 * Persist: Postgres via Prisma as soon as each repo is scraped
 *
 * Usage:
 *   pnpm scrape
 *   pnpm scrape -- --min-stars 500 --max-repos 100
 *   pnpm scrape -- --query downloader --max-repos 50
 *   pnpm scrape -- --query "topic:downloader" --min-stars 50
 */
import "dotenv/config"

import { searchReposHtml } from "./browser.js"
import {
  StreamingDiscovery,
  shardId,
  shardQuery,
  yearsAgo,
  type Shard,
} from "./discovery.js"
import { RateLimitError, fetchRepoAndReleases } from "./github.js"
import {
  alreadyScraped,
  markScrape,
  prisma,
  saveRepoFromRest,
} from "./store.js"

type Args = {
  query: string
  minStars: number
  maxRepos: number
  pushedAfter: string
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback
  }
  return {
    query: get("--query", get("-q", "")),
    minStars: Number(get("--min-stars", "100")),
    maxRepos: Number(get("--max-repos", "0")),
    pushedAfter: get("--pushed-after", yearsAgo(5)),
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
    } else {
      stats.skipped_no_assets += 1
      console.log(`skip ${fullName}: no desktop assets`)
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err
    stats.errors += 1
    const message = err instanceof Error ? err.message : String(err)
    await markScrape(fullName, "error", message.slice(0, 500))
    console.warn(`error ${fullName}: ${message}`)
  }
}

/** @returns true if the shard finished (done or split); false if stopped early */
async function streamShardHtml(
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

  for (let page = 1; page <= 100; page++) {
    if (args.maxRepos && stats.saved >= args.maxRepos) return false

    let hits
    try {
      hits = await searchReposHtml(query, page)
    } catch (err) {
      console.warn(`html page ${page} failed:`, err)
      await new Promise((r) => setTimeout(r, 10_000))
      hits = await searchReposHtml(query, page)
    }

    lastPageCount = hits.length
    if (!hits.length) {
      console.log(`page ${page}: empty — shard done`)
      reachedEnd = true
      break
    }

    console.log(`page ${page}: ${hits.length} repos`)
    for (const hit of hits) {
      if (args.maxRepos && stats.saved >= args.maxRepos) return false
      await processFullName(hit.fullName, stats)
    }

    if (page === 100) reachedEnd = true
  }

  if (!reachedEnd) return false

  // Full 100 pages with results → likely over the 1000-hit HTML/search cap.
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
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    console.warn("WARNING: no GITHUB_TOKEN — Core REST limits will be low")
  }

  const args = parseArgs(process.argv.slice(2))
  const stats = {
    discovered: 0,
    saved: 0,
    skipped_known: 0,
    skipped_no_releases: 0,
    skipped_no_assets: 0,
    errors: 0,
  }

  console.log(
    `scrape start (html+rest) query=${args.query ? JSON.stringify(args.query) : "(none)"} minStars=${args.minStars} pushedAfter=${args.pushedAfter}`
  )

  const discovery = new StreamingDiscovery({
    minStars: args.minStars,
    pushedAfter: args.pushedAfter,
  })

  while (true) {
    if (args.maxRepos && stats.saved >= args.maxRepos) break
    const shard = discovery.nextShard()
    if (!shard) break

    try {
      const finished = await streamShardHtml(shard, args, stats, discovery)
      if (!finished) {
        // Stopped early (max-repos) — requeue remainder later if needed.
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
        console.warn(`REST rate limit — waiting ${Math.round(wait / 1000)}s`)
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
