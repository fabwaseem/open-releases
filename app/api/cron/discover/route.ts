import type { NextRequest } from "next/server"

import { discoverNewRepos, isCronAuthorized } from "@/lib/cron"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
// Vercel Hobby caps functions at 60s. Batch sizes are tuned to finish under it.
export const maxDuration = 60

const DEFAULT_LIMIT = env.CRON_DISCOVER_LIMIT ?? 8
const MAX_LIMIT = 100

/**
 * Vercel Cron: search GitHub for trending and freshly released repos and
 * ingest the ones we don't know yet. Misses are recorded in the scrape
 * ledger so subsequent runs skip them cheaply.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const limitParam = Number(request.nextUrl.searchParams.get("limit"))
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT

  const startedAt = Date.now()
  const stats = await discoverNewRepos(limit)

  return Response.json({
    ok: true,
    job: "discover",
    durationMs: Date.now() - startedAt,
    ...stats,
  })
}
