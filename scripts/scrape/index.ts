#!/usr/bin/env tsx
/**
 * Sequential scraper — discovers repos, then enriches via Core REST.
 *
 * Discovery (default: API when GITHUB_TOKEN is set):
 *   - api  → REST /search/repositories (30 req/min, auth) — preferred
 *   - html → github.com/search pages (unauthenticated, easy to 429)
 * Enrichment: Core REST /repos + /releases (5k/hour with token)
 *
 * Discovery sweeps are resumable: shard progress is persisted per
 * sweep (see state.ts) and a revalidation pass re-checks stale
 * skipped/error ledger rows before the shard loop starts.
 *
 * Update mode (--update): skip discovery; refresh existing catalog rows
 * with latest GitHub details + recalculated activity scores. Phase 1
 * is a cheap release-watch (conditional request per repo, stalest
 * releaseCheckedAt first) that only pays for a full refresh when the
 * latest release actually changed; Phase 2 full-refreshes the stalest
 * scored repos with whatever --max-repos budget remains. A
 * revalidation pass runs between the phases — tombstoned repos have
 * no Repository row, so the watch phases can never resurrect them.
 * Repos that lost installers / look non-app are removed from the
 * catalog.
 *
 * Usage:
 *   pnpm scrape
 *   pnpm scrape -- --min-stars 500 --max-repos 100
 *   pnpm scrape -- --query "stars:>100 language:C# archived:false"
 *   pnpm scrape -- --discovery html   # force browser pages
 *   pnpm scrape -- --discovery api    # force Search API (needs token)
 *   pnpm scrape:update
 *   pnpm scrape -- --update --max-repos 200
 *   pnpm scrape -- --update --stale-days 7
 *   pnpm scrape -- --update --no-watch --no-revalidate
 */
import "dotenv/config"

import { appendFileSync } from "node:fs"

import { searchReposHtml } from "./browser.js"
import {
  StreamingDiscovery,
  coarseYearShards,
  isRevalidationEligible,
  parseSearchQuery,
  shardId,
  shardQuery,
  splitShard,
  yearsAgo,
  type Shard,
} from "./discovery.js"
import {
  RateLimitError,
  checkLatestRelease,
  fetchRepoAndReleases,
  hasGithubToken,
  searchReposApi,
} from "./github.js"
import {
  clearDiscoveryProgress,
  finishScrapeRun,
  initDiscoveryProgress,
  loadDiscoveryProgress,
  persistShardCompleted,
  persistShardFailed,
  persistShardSplit,
  startScrapeRun,
  sweepKeyFor,
} from "./state.js"
import {
  markScrape,
  prisma,
  removeCatalogRepo,
  saveRepoFromRest,
  scrapeRecordState,
  touchReleaseChecked,
  touchScrapedAt,
} from "./store.js"

type DiscoveryMode = "api" | "html"

type Args = {
  query: string
  minStars: number
  maxRepos: number
  pushedAfter: string
  discovery: DiscoveryMode
  /** Refresh existing catalog repos instead of discovering new ones. */
  update: boolean
  /** Only refresh repos scored/scraped at least this many days ago (0 = all). */
  staleDays: number
  /** Days before skipped_no_releases/skipped_no_assets/error rows are re-checked. */
  revalidateDays: number
  /** Days before skipped_non_app rows are re-checked. */
  revalidateNonAppDays: number
  /** Max ledger rows re-checked per run. */
  revalidateMax: number
  /** Max catalog repos probed by the update-mode release-watch. */
  watchMax: number
  /** Skip the update-mode release-watch phase. */
  noWatch: boolean
  /** Skip the revalidation pass. */
  noRevalidate: boolean
}

type Stats = {
  discovered: number
  saved: number
  skipped_known: number
  skipped_no_releases: number
  skipped_no_assets: number
  skipped_non_app: number
  removed: number
  errors: number
  revalidated: number
  resurrected: number
  watch_checked: number
  watch_unchanged: number
  watch_changed: number
  watch_deferred: number
}

/** Set by SIGINT/SIGTERM — loops check it and break cleanly. */
let stopping = false

function log(scope: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${scope}] ${msg}`)
}

process.on("SIGINT", () => {
  stopping = true
  log("shutdown", "SIGINT received — stopping after the current repo/shard")
})
process.on("SIGTERM", () => {
  stopping = true
  log("shutdown", "SIGTERM received — stopping after the current repo/shard")
})

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
    update: hasFlag(argv, "--update") || hasFlag(argv, "--refresh"),
    staleDays: Math.max(0, Number(get("--stale-days", "0"))),
    revalidateDays: Math.max(0, Number(get("--revalidate-days", "7"))),
    revalidateNonAppDays: Math.max(
      0,
      Number(get("--revalidate-nonapp-days", "28"))
    ),
    revalidateMax: Math.max(0, Number(get("--revalidate-max", "150"))),
    watchMax: Math.max(0, Number(get("--watch-max", "1500"))),
    noWatch: hasFlag(argv, "--no-watch"),
    noRevalidate: hasFlag(argv, "--no-revalidate"),
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

/** How long to wait for a GitHub rate-limit window to reset. */
function rateLimitWaitMs(err: RateLimitError): number {
  if (err.resetAt && Number.isFinite(err.resetAt)) {
    // Honor GitHub's reset timestamp; cap at 1h so a bad clock can't hang forever.
    return Math.min(
      Math.max(err.resetAt * 1000 - Date.now() + 2_000, 5_000),
      3_600_000
    )
  }
  // Transient 5xx / missing reset header
  if (/transient/i.test(err.message)) {
    return 3_000 + Math.floor(Math.random() * 3_000)
  }
  return 60_000
}

/** Wait out rate limits and retry until success (or attempts exhausted). */
async function withRateLimitRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 30
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof RateLimitError)) throw err
      attempt += 1
      if (attempt > maxAttempts) {
        console.error(
          `API rate limit (${label}) — giving up after ${maxAttempts} retries`
        )
        throw err
      }
      const wait = rateLimitWaitMs(err)
      console.warn(
        `API rate limit (${label}) — waiting ${Math.round(wait / 1000)}s then retry (${attempt}/${maxAttempts})`
      )
      await sleep(wait)
    }
  }
}

async function processFullName(
  fullName: string,
  stats: Stats,
  opts: {
    forceUpdate?: boolean
    recheck?: boolean
    revalidateDays?: number
    revalidateNonAppDays?: number
  } = {}
) {
  const forceUpdate = Boolean(opts.forceUpdate)
  const recheck = Boolean(opts.recheck)
  const revalidateDays = opts.revalidateDays ?? 7
  const revalidateNonAppDays = opts.revalidateNonAppDays ?? 28

  try {
    if (!forceUpdate && !recheck) {
      // Pre-check lives inside the try: a ledger hiccup for one repo
      // must be isolated to that repo, never abort the caller's loop.
      const prior = await scrapeRecordState(fullName)
      if (prior) {
        const status = prior.status
        if (
          status === "saved" ||
          status === "hidden" ||
          status === "skipped_inactive"
        ) {
          stats.skipped_known += 1
          return
        }
        if (
          status === "skipped_no_releases" ||
          status === "skipped_no_assets" ||
          status === "skipped_non_app" ||
          status === "error" ||
          status === "discovered"
        ) {
          const eligible = isRevalidationEligible(
            status,
            prior.lastSeenAt,
            new Date(),
            { revalidateDays, nonAppDays: revalidateNonAppDays }
          )
          if (!eligible) {
            stats.skipped_known += 1
            return
          }
          // Eligible — fall through and re-check this repo.
        } else {
          stats.skipped_known += 1
          return
        }
      }
      stats.discovered += 1
      await markScrape(fullName, "discovered")
    }
    // recheck: skip the pre-check entirely (the revalidation pass
    // already decided this row is due).
    // forceUpdate: no pre-check, no discovered bookkeeping.

    const data = await fetchRepoAndReleases(fullName)
    if (!data) {
      if (forceUpdate) {
        await removeCatalogRepo(fullName, "error", "repo not found on update")
        stats.removed += 1
        console.log(`removed ${fullName}: not found on GitHub`)
      } else {
        await markScrape(fullName, "error", "repo not found")
        stats.errors += 1
      }
      return
    }

    const result = await saveRepoFromRest(
      data.repo,
      data.releases,
      data.activity
    )
    if (result.saved) {
      stats.saved += 1
      if (recheck) stats.resurrected += 1
      console.log(
        `${forceUpdate ? "updated" : "saved"} ${fullName} score=${result.score.toFixed(1)} (${stats.saved})`
      )
      return
    }

    if (forceUpdate) {
      const status =
        result.reason === "no_releases"
          ? "skipped_no_releases"
          : result.reason === "non_app"
            ? "skipped_non_app"
            : "skipped_no_assets"
      const reason =
        result.reason === "no_releases"
          ? "no releases on update"
          : result.reason === "non_app"
            ? "non-app on update"
            : "no-usable-installers on update"
      await removeCatalogRepo(fullName, status, reason)
      stats.removed += 1
      console.log(`removed ${fullName}: ${result.reason}`)
      return
    }

    if (result.reason === "no_releases") {
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

type StreamShardOutcome =
  | { outcome: "completed" }
  | { outcome: "split"; children: Shard[] }
  | { outcome: "stopped" }

/**
 * Stream one shard page by page.
 * - "completed": shard exhausted naturally (persist completion)
 * - "split": hit the ~1000-result search cap; children are already
 *   unshifted onto the discovery queue (persist the split)
 * - "stopped": bailed early (maxRepos / shutdown) — the shard is NOT
 *   completed and NOT split; the caller leaves it pending.
 * Split persistence only ever happens on the natural cap path.
 */
async function streamShard(
  shard: Shard,
  args: Args,
  stats: Stats,
  discovery: StreamingDiscovery
): Promise<StreamShardOutcome> {
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
  let hitCap = false
  // API: 100/page → 10 pages = 1000 cap. HTML: ~10/page → 100 pages.
  const pageSize = args.discovery === "api" ? 100 : 10
  const maxPages = args.discovery === "api" ? 10 : 100

  for (let page = 1; page <= maxPages; page++) {
    if (stopping) return { outcome: "stopped" }
    if (args.maxRepos && stats.saved >= args.maxRepos) {
      return { outcome: "stopped" }
    }

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
      if (stopping) return { outcome: "stopped" }
      if (args.maxRepos && stats.saved >= args.maxRepos) {
        return { outcome: "stopped" }
      }
      await withRateLimitRetry(hit.fullName, () =>
        processFullName(hit.fullName, stats, {
          revalidateDays: args.revalidateDays,
          revalidateNonAppDays: args.revalidateNonAppDays,
        })
      )
    }

    // The search total says this page covered the last results —
    // the shard is done even though the page was non-empty, and it
    // must NOT be split.
    if (totalCount != null && page * pageSize >= totalCount) {
      reachedEnd = true
      break
    }
    // API mode: a short page is the end of the results — no split.
    if (args.discovery === "api" && hits.length < pageSize) {
      reachedEnd = true
      break
    }
    if (page === maxPages) hitCap = true
  }

  if (!reachedEnd && !hitCap) return { outcome: "stopped" }

  // Hit the ~1000-result search cap — split the shard and continue.
  if (hitCap && lastPageCount > 0) {
    const children = splitShard(shard)
    if (!children.length) {
      discovery.completed.add(shardId(shard))
      return { outcome: "completed" }
    }
    console.log(`shard hit page cap — splitting ${shardId(shard)}`)
    discovery.queue.unshift(...children)
    discovery.completed.add(shardId(shard))
    return { outcome: "split", children }
  }

  discovery.completed.add(shardId(shard))
  return { outcome: "completed" }
}

/**
 * Re-check stale ledger rows that previously skipped/errored — a
 * repo with no releases last month may have shipped one since.
 * Runs before the discovery shard loop and, in update mode, after
 * the release-watch phase (tombstoned repos have no Repository row,
 * so only this pass can resurrect them there).
 */
async function runRevalidationPass(args: Args, stats: Stats) {
  if (args.noRevalidate) return
  log(
    "revalidate",
    `pass start — revalidateDays=${args.revalidateDays} nonAppDays=${args.revalidateNonAppDays} max=${args.revalidateMax}`
  )
  const now = new Date()
  // One query with the smaller (more inclusive) day cutoff, then the
  // exact per-status rule is applied in JS via isRevalidationEligible.
  const cutoff = new Date(
    now.getTime() -
      Math.min(args.revalidateDays, args.revalidateNonAppDays) * 86_400_000
  )
  const rows = await prisma.scrapeRecord.findMany({
    where: {
      status: {
        in: [
          "skipped_no_releases",
          "skipped_no_assets",
          "skipped_non_app",
          "error",
        ],
      },
      lastSeenAt: { lt: cutoff },
    },
    orderBy: { lastSeenAt: "asc" },
    take: args.revalidateMax,
    select: { fullName: true, status: true, lastSeenAt: true },
  })

  let attempted = 0
  for (const row of rows) {
    if (stopping) break
    const eligible = isRevalidationEligible(row.status, row.lastSeenAt, new Date(), {
      revalidateDays: args.revalidateDays,
      nonAppDays: args.revalidateNonAppDays,
    })
    if (!eligible) continue
    attempted += 1
    stats.revalidated += 1
    try {
      await withRateLimitRetry(row.fullName, () =>
        processFullName(row.fullName, stats, { recheck: true })
      )
    } catch (err) {
      // Per-repo isolation: processFullName already counts and logs
      // ordinary failures; this only sees exhausted rate-limit
      // retries or ledger escapes — log and move on.
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`revalidate ${row.fullName} failed: ${message}`)
      if (err instanceof RateLimitError) break
    }
  }
  log(
    "revalidate",
    `pass done — attempted=${attempted} resurrected=${stats.resurrected}`
  )
}

type UpdateRunInfo = {
  queueTotal: number
  processed: number
  phase2Processed: number
}

async function runUpdateMode(
  args: Args,
  stats: Stats
): Promise<UpdateRunInfo> {
  const revalidatedAtStart = stats.revalidated
  let queueTotal = 0
  let watchAttempted = 0
  let phase2Processed = 0
  // Full-refresh budget: --max-repos counts Phase 1 refreshes + Phase 2.
  let fullRefreshes = 0
  const budgetLeft = () =>
    args.maxRepos === 0 || fullRefreshes < args.maxRepos

  log(
    "update",
    `catalog refresh — staleDays=${args.staleDays} maxRepos=${args.maxRepos} watchMax=${args.watchMax}`
  )

  // ── Phase 1: release-watch (cheap conditional probes) ──────────
  if (!args.noWatch) {
    const watchQueue = await prisma.repository.findMany({
      orderBy: [
        { releaseCheckedAt: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ],
      take: args.watchMax,
      select: {
        fullName: true,
        latestReleaseGithubId: true,
        releasesEtag: true,
      },
    })
    queueTotal += watchQueue.length
    log("watch", `phase 1 — probing ${watchQueue.length} repo(s)`)

    for (const row of watchQueue) {
      if (stopping) break
      const fullName = row.fullName
      watchAttempted += 1
      stats.watch_checked += 1
      try {
        const check = await withRateLimitRetry(fullName, () =>
          checkLatestRelease(fullName, {
            githubId: row.latestReleaseGithubId ?? null,
            etag: row.releasesEtag ?? null,
          })
        )

        if (check.status === "unchanged") {
          stats.watch_unchanged += 1
          await touchReleaseChecked(fullName, {
            releasesEtag: check.etag ?? undefined,
          })
          continue
        }

        // changed / empty / gone — all need a full refresh decision.
        stats.watch_changed += 1
        if (!budgetLeft()) {
          // Leave releaseCheckedAt untouched: the repo stays at the
          // head of the queue for the next run.
          stats.watch_deferred += 1
          continue
        }

        fullRefreshes += 1
        await withRateLimitRetry(fullName, () =>
          processFullName(fullName, stats, { forceUpdate: true })
        )
        // Stamp the probe result we already paid for. If the refresh
        // removed the row, touchReleaseChecked no-ops.
        const touch: {
          releasesEtag?: string
          latestReleaseGithubId?: string
        } = {}
        if (check.status !== "gone" && check.etag) {
          touch.releasesEtag = check.etag
        }
        if (check.status === "changed") {
          touch.latestReleaseGithubId = check.latest.githubId
        }
        await touchReleaseChecked(fullName, touch)
      } catch (err) {
        // A throw for one repo must NOT abort the watch loop.
        stats.errors += 1
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`watch ${fullName} failed: ${message}`)
      }
    }
    log(
      "watch",
      `phase 1 done — checked=${stats.watch_checked} unchanged=${stats.watch_unchanged} changed=${stats.watch_changed} deferred=${stats.watch_deferred}`
    )
  }

  // ── Revalidation (tombstones have no Repository row) ───────────
  if (!stopping) {
    await runRevalidationPass(args, stats)
  }

  // ── Phase 2: stalest-scoredAt full refresh, remaining budget ───
  const cutoff =
    args.staleDays > 0
      ? new Date(Date.now() - args.staleDays * 86_400_000)
      : null
  // Exclude repos attempted in the last 6h so an erroring repo can't
  // stick at the head of the queue run after run.
  const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000)
  const notRecentlyChecked = {
    OR: [
      { releaseCheckedAt: null },
      { releaseCheckedAt: { lt: sixHoursAgo } },
    ],
  }
  const where = cutoff
    ? {
        AND: [
          {
            OR: [
              { scoredAt: { lt: cutoff } },
              { scoredAt: null, scrapedAt: { lt: cutoff } },
            ],
          },
          notRecentlyChecked,
        ],
      }
    : notRecentlyChecked

  const remaining =
    args.maxRepos === 0 ? null : args.maxRepos - fullRefreshes
  if (remaining !== null && remaining <= 0) {
    log("update", "phase 2 skipped — full-refresh budget exhausted")
  } else {
    const queue = await prisma.repository.findMany({
      where,
      orderBy: [{ scoredAt: "asc" }, { scrapedAt: "asc" }, { id: "asc" }],
      ...(remaining !== null ? { take: remaining } : {}),
      select: { fullName: true },
    })
    queueTotal += queue.length
    log(
      "update",
      `phase 2 — refreshing ${queue.length} repo(s), oldest score first`
    )

    for (let i = 0; i < queue.length; i++) {
      if (stopping) break
      const fullName = queue[i]!.fullName
      console.log(`[${i + 1}/${queue.length}] refresh ${fullName}`)
      phase2Processed += 1
      try {
        await withRateLimitRetry(fullName, () =>
          processFullName(fullName, stats, { forceUpdate: true })
        )
        fullRefreshes += 1
      } catch (err) {
        if (err instanceof RateLimitError) throw err
        stats.errors += 1
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`refresh ${fullName} failed: ${message}`)
        try {
          await touchScrapedAt(fullName)
        } catch {
          // best-effort — the loop must continue either way
        }
      }
    }
  }

  const processed =
    watchAttempted +
    phase2Processed +
    (stats.revalidated - revalidatedAtStart)
  return { queueTotal, processed, phase2Processed }
}

async function runDiscoveryMode(args: Args, stats: Stats) {
  log(
    "discover",
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

  // Revalidation first — stale skips may have shipped a release.
  await runRevalidationPass(args, stats)

  // ── Persistent sweep state ─────────────────────────────────────
  const sweepKey = sweepKeyFor({
    minStars: args.minStars,
    pushedAfter: args.pushedAfter,
    query: args.query,
    discovery: args.discovery,
  })
  let loaded = await loadDiscoveryProgress(sweepKey)
  const resumed = loaded !== null
  if (!loaded) {
    const shards = coarseYearShards(args.minStars)
    await initDiscoveryProgress(sweepKey, shards)
    loaded = { queue: shards, completed: [] }
    log(
      "discover",
      `sweep ${sweepKey} initialized with ${shards.length} shard(s)`
    )
  } else {
    log(
      "discover",
      `sweep ${sweepKey} resumed — ${loaded.queue.length} pending, ${loaded.completed.length} completed`
    )
  }

  const discovery = new StreamingDiscovery({
    minStars: args.minStars,
    pushedAfter: args.pushedAfter,
    queue: loaded.queue,
    completed: loaded.completed,
  })
  if (resumed) {
    // StreamingDiscovery's constructor substitutes coarse shards for
    // an empty queue — a resumed sweep with an empty queue is really
    // complete, so restore the persisted values verbatim.
    discovery.queue = [...loaded.queue]
    discovery.completed = new Set(loaded.completed)
  }

  // Per-run failure cap (the state contract has no attempts read —
  // this is deliberately in-memory only). Rate-limit requeues do
  // not count toward the cap.
  const shardAttempts = new Map<string, number>()
  let anyShardFailed = false
  let sweepComplete = false

  while (true) {
    if (stopping) break
    if (args.maxRepos && stats.saved >= args.maxRepos) break
    const shard = discovery.nextShard()
    if (!shard) {
      sweepComplete = true
      break
    }

    try {
      const result = await streamShard(shard, args, stats, discovery)
      if (result.outcome === "stopped") {
        // Not completed, not split — the persisted row stays
        // pending; just put it back for symmetry and stop.
        discovery.queue.unshift(shard)
        break
      }
      if (result.outcome === "split") {
        await persistShardSplit(sweepKey, shard, result.children)
      } else {
        await persistShardCompleted(sweepKey, shard)
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        const wait = rateLimitWaitMs(err)
        console.warn(
          `API rate limit (shard ${shardId(shard)}) — waiting ${Math.round(wait / 1000)}s`
        )
        await sleep(wait)
        discovery.queue.unshift(shard)
        continue
      }
      const id = shardId(shard)
      const attempts = (shardAttempts.get(id) ?? 0) + 1
      shardAttempts.set(id, attempts)
      console.error(`shard failed ${id} (attempt ${attempts}/3)`, err)
      if (attempts >= 3) {
        anyShardFailed = true
        await persistShardFailed(sweepKey, shard)
        discovery.completed.add(id)
        continue
      }
      discovery.queue.unshift(shard)
      await sleep(15_000)
    }
  }

  if (sweepComplete && !anyShardFailed) {
    await clearDiscoveryProgress(sweepKey)
    log("discover", `sweep ${sweepKey} complete — progress cleared`)
  } else if (sweepComplete && anyShardFailed) {
    log(
      "discover",
      `sweep ${sweepKey} drained with failed shard(s) — progress kept for resume`
    )
  }
}

async function main() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL missing")
    }
    if (!hasGithubToken()) {
      console.warn(
        "WARNING: no GITHUB_TOKEN — discovery falls back to HTML; Core REST limits will be low"
      )
    }

    const args = parseArgs(process.argv.slice(2))
    if (!args.update && args.discovery === "api" && !hasGithubToken()) {
      throw new Error(
        "Discovery mode is api but GITHUB_TOKEN / GH_TOKEN is not set. Add a token or pass --discovery html."
      )
    }

    const stats: Stats = {
      discovered: 0,
      saved: 0,
      skipped_known: 0,
      skipped_no_releases: 0,
      skipped_no_assets: 0,
      skipped_non_app: 0,
      removed: 0,
      errors: 0,
      revalidated: 0,
      resurrected: 0,
      watch_checked: 0,
      watch_unchanged: 0,
      watch_changed: 0,
      watch_deferred: 0,
    }

    const mode = args.update ? "update" : "discover"
    const kind = args.update ? "update" : "discover"
    let runId = ""
    try {
      runId = await startScrapeRun(kind, {
        query: args.query,
        minStars: args.minStars,
        pushedAfter: args.pushedAfter,
        discovery: args.discovery,
        maxRepos: args.maxRepos,
        staleDays: args.staleDays,
      })
    } catch (err) {
      console.warn("startScrapeRun failed — continuing without a run id:", err)
    }
    log("run", `start mode=${mode} runId=${runId || "(none)"}`)

    let updateInfo: UpdateRunInfo = {
      queueTotal: 0,
      processed: 0,
      phase2Processed: 0,
    }
    const errorsAtStart = stats.errors
    if (args.update) {
      updateInfo = await runUpdateMode(args, stats)
    } else {
      await runDiscoveryMode(args, stats)
    }

    // Exit-code sanity. Attempted formula (pragmatic, from stats):
    //   attempted = discovered (fresh enrich attempts)
    //             + revalidated (recheck attempts)
    //             + watch_changed (watch-triggered full refreshes)
    //             + phase2Processed (phase-2 full refreshes; 0 in
    //               discovery mode)
    // Discovery/revalidation: fail when we attempted work, saved
    // nothing, and over half the attempts errored. Update: fail
    // when there was a queue and every processed repo errored.
    const attempted =
      stats.discovered +
      stats.revalidated +
      stats.watch_changed +
      updateInfo.phase2Processed
    // finishScrapeRun accepts "finished" | "failed".
    let runStatus: "finished" | "failed" = "finished"
    if (!args.update) {
      if (attempted > 0 && stats.saved === 0 && stats.errors > attempted / 2) {
        runStatus = "failed"
      }
    } else {
      const updateErrors = stats.errors - errorsAtStart
      if (
        updateInfo.queueTotal > 0 &&
        updateInfo.processed > 0 &&
        updateErrors >= updateInfo.processed
      ) {
        runStatus = "failed"
      }
    }
    if (runStatus === "failed") {
      process.exitCode = 1
    }

    if (runId) {
      try {
        await finishScrapeRun(runId, stats, runStatus)
      } catch (err) {
        console.warn("finishScrapeRun failed:", err)
      }
    }

    log("run", `done mode=${mode} status=${runStatus}`)
    console.log("done", stats)
    // Machine-readable final line — keep the exact prefix.
    console.log(
      `RUN_SUMMARY ${JSON.stringify({ runId, mode, ...stats })}`
    )

    const summaryPath = process.env.GITHUB_STEP_SUMMARY
    if (summaryPath) {
      try {
        const rows = Object.entries(stats)
          .map(([k, v]) => `| ${k} | ${v} |`)
          .join("\n")
        appendFileSync(
          summaryPath,
          [
            "",
            `## Scrape run — ${mode}`,
            "",
            `Run ID: \`${runId}\` · Status: **${runStatus}**`,
            "",
            "| Stat | Value |",
            "| --- | ---: |",
            rows,
            "",
          ].join("\n")
        )
      } catch (err) {
        console.warn("writing GITHUB_STEP_SUMMARY failed:", err)
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
