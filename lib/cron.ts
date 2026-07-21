import { prisma } from "@/lib/db"
import { env } from "@/lib/env"
import { GitHubApiError, searchRepos } from "@/lib/github-rest"
import { ingestGithubRepo } from "@/lib/repo-ingest"

/**
 * Batch helpers behind /api/cron/*. Designed for serverless time limits:
 * each invocation processes a bounded batch and exits; the next scheduled
 * run continues where this one left off (oldest scoredAt first).
 */

export function isCronAuthorized(request: Request): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get("authorization")
  return header === `Bearer ${secret}`
}

/**
 * Wall-clock budget for a batch. Vercel Hobby hard-kills functions at 60s,
 * so we stop a few seconds early to always return a clean JSON response.
 */
const DEFAULT_BUDGET_MS = 50_000

export type CronRepoResult = {
  fullName: string
  action: "updated" | "removed" | "added" | "skipped" | "error"
  detail?: string
}

/** Failures that mean the repo no longer qualifies for the catalog. */
const DISQUALIFYING_PATTERNS = [
  /not found/i,
  /no releases/i,
  /no installer assets/i,
  /non-app/i,
  /is private/i,
]

function isDisqualifying(message: string): boolean {
  return DISQUALIFYING_PATTERNS.some((re) => re.test(message))
}

function ledgerStatus(message: string): string {
  if (/no releases/i.test(message)) return "skipped_no_releases"
  if (/non-app/i.test(message)) return "skipped_non_app"
  return "skipped_no_assets"
}

async function markSkipped(fullName: string, message: string) {
  const status = ledgerStatus(message)
  const reason = message.slice(0, 180)
  await prisma.scrapeRecord.upsert({
    where: { fullName },
    create: { fullName, status, reason },
    update: { status, reason, repositoryId: null, lastSeenAt: new Date() },
  })
}

/** Returns false when the repo is featured and therefore kept. */
async function removeFromCatalog(fullName: string, message: string) {
  const existing = await prisma.repository.findUnique({
    where: { fullName },
    select: { id: true, featured: true },
  })
  if (existing?.featured) return false
  if (existing) {
    await prisma.repository.delete({ where: { id: existing.id } })
  }
  await markSkipped(fullName, `cron: ${message}`)
  return true
}

/**
 * Refresh the N stalest catalog repos (details + releases + score).
 * Repos that no longer qualify are removed. Rate limits stop the batch
 * early — remaining rows stay stale and are picked up next run.
 */
export async function refreshStaleRepos(
  limit: number,
  budgetMs: number = DEFAULT_BUDGET_MS
): Promise<{
  processed: number
  updated: number
  removed: number
  errors: number
  rateLimited: boolean
  timedOut: boolean
  results: CronRepoResult[]
}> {
  const deadline = Date.now() + budgetMs
  // Hidden repos stay untouched — re-ingesting would flip them visible again.
  const queue = await prisma.repository.findMany({
    where: { hidden: false },
    orderBy: [{ scoredAt: "asc" }, { scrapedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { fullName: true },
  })

  const results: CronRepoResult[] = []
  let updated = 0
  let removed = 0
  let errors = 0
  let rateLimited = false
  let timedOut = false

  for (const row of queue) {
    if (Date.now() >= deadline) {
      timedOut = true
      break
    }
    try {
      await ingestGithubRepo(row.fullName, { scrapeReason: "cron_update" })
      updated += 1
      results.push({ fullName: row.fullName, action: "updated" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      if (err instanceof GitHubApiError && (err.status === 403 || err.status === 429)) {
        rateLimited = true
        results.push({
          fullName: row.fullName,
          action: "skipped",
          detail: "rate limited — stopping batch",
        })
        break
      }

      // 451 = repo blocked (e.g. DMCA), 410 = gone — drop it from the catalog.
      const blocked =
        err instanceof GitHubApiError && (err.status === 451 || err.status === 410)

      if (blocked || isDisqualifying(message)) {
        const didRemove = await removeFromCatalog(row.fullName, message)
        if (didRemove) {
          removed += 1
          results.push({ fullName: row.fullName, action: "removed", detail: message })
        } else {
          results.push({
            fullName: row.fullName,
            action: "skipped",
            detail: `featured repo kept: ${message}`,
          })
        }
        continue
      }

      errors += 1
      results.push({ fullName: row.fullName, action: "error", detail: message })
    }
  }

  return {
    processed: results.length,
    updated,
    removed,
    errors,
    rateLimited,
    timedOut,
    results,
  }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

/** Search queries aimed at trending + brand-new releases. */
function discoveryQueries(): string[] {
  return [
    // Trending: active repos updated this week with real traction
    `stars:>200 pushed:>${isoDaysAgo(7)} archived:false`,
    // Rising: young repos already gaining stars
    `created:>${isoDaysAgo(90)} stars:>20 archived:false`,
    // Fresh unknowns: brand new, any stars, recently pushed
    `created:>${isoDaysAgo(30)} pushed:>${isoDaysAgo(7)} archived:false`,
  ]
}

/**
 * Discover new candidate repos via GitHub search and ingest unknown ones.
 * Repos without qualifying release assets are recorded in the scrape ledger
 * so they're not retried on every run.
 */
export async function discoverNewRepos(
  limit: number,
  budgetMs: number = DEFAULT_BUDGET_MS
): Promise<{
  scanned: number
  added: number
  skipped: number
  errors: number
  rateLimited: boolean
  timedOut: boolean
  results: CronRepoResult[]
}> {
  const deadline = Date.now() + budgetMs
  const results: CronRepoResult[] = []
  let scanned = 0
  let added = 0
  let skipped = 0
  let errors = 0
  let rateLimited = false
  let timedOut = false

  outer: for (const query of discoveryQueries()) {
    for (let page = 1; page <= 2; page++) {
      let hits: Array<{ full_name: string }>
      try {
        const res = await searchRepos(query, page)
        hits = res.items
      } catch (err) {
        if (err instanceof GitHubApiError && (err.status === 403 || err.status === 429)) {
          rateLimited = true
          break outer
        }
        throw err
      }
      if (!hits.length) break

      const fullNames = hits.map((h) => h.full_name)
      const known = await prisma.scrapeRecord.findMany({
        where: { fullName: { in: fullNames } },
        select: { fullName: true, status: true },
      })
      const knownMap = new Map(known.map((k) => [k.fullName.toLowerCase(), k.status]))

      for (const hit of hits) {
        if (added >= limit) break outer
        if (Date.now() >= deadline) {
          timedOut = true
          break outer
        }
        scanned += 1

        const prior = knownMap.get(hit.full_name.toLowerCase())
        if (prior && prior !== "error" && prior !== "discovered") continue

        try {
          await ingestGithubRepo(hit.full_name, { scrapeReason: "cron_discovery" })
          added += 1
          results.push({ fullName: hit.full_name, action: "added" })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)

          if (err instanceof GitHubApiError && (err.status === 403 || err.status === 429)) {
            rateLimited = true
            break outer
          }

          if (isDisqualifying(message)) {
            // Ledger the miss so future runs skip it quickly.
            await markSkipped(hit.full_name, message)
            skipped += 1
            continue
          }

          errors += 1
          results.push({ fullName: hit.full_name, action: "error", detail: message })
        }
      }
    }
  }

  return { scanned, added, skipped, errors, rateLimited, timedOut, results }
}
