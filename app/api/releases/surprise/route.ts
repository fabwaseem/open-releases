import type { NextRequest } from "next/server"

import { pickSurpriseRepo } from "@/lib/catalog"
import { GitHubApiError } from "@/lib/github-rest"
import { isPlatform } from "@/lib/platforms"
import type { Platform } from "@/lib/types"

export const dynamic = "force-dynamic"

function apiError(err: unknown): Response {
  if (
    err instanceof GitHubApiError &&
    (err.rateLimited || err.status === 429)
  ) {
    return Response.json(
      { error: "GitHub rate limit — try again shortly" },
      { status: 429 }
    )
  }
  if (err instanceof Error && (err as { code?: unknown }).code === "P2025") {
    return Response.json({ error: "Not found" }, { status: 404 })
  }
  if (err instanceof Error && err.name === "ZodError") {
    return Response.json({ error: "Invalid request" }, { status: 400 })
  }
  console.error(err)
  return Response.json({ error: "Internal error" }, { status: 500 })
}

export async function GET(request: NextRequest) {
  try {
    const platformParam = request.nextUrl.searchParams.get("platform")
    const platform =
      platformParam && isPlatform(platformParam)
        ? (platformParam as Platform)
        : null

    const repo = await pickSurpriseRepo(platform)

    if (!repo) {
      return Response.json({ error: "No repositories available" }, { status: 404 })
    }

    return Response.json(
      { repo },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    )
  } catch (err) {
    return apiError(err)
  }
}
