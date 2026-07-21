import type { NextRequest } from "next/server"

import { isCronAuthorized, refreshStaleRepos } from "@/lib/cron"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
// Vercel Hobby caps functions at 60s. Batch sizes are tuned to finish under it.
export const maxDuration = 60

const DEFAULT_LIMIT = env.CRON_UPDATE_LIMIT ?? 15
const MAX_LIMIT = 150

/**
 * Vercel Cron: refresh the stalest catalog repos (details, latest release,
 * score). Each run handles a bounded batch; scheduling it frequently keeps
 * the whole catalog cycling.
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
  const stats = await refreshStaleRepos(limit)

  return Response.json({
    ok: true,
    job: "update-repos",
    durationMs: Date.now() - startedAt,
    ...stats,
  })
}
