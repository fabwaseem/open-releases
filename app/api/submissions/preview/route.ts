import { NextRequest } from "next/server"

import { GitHubApiError } from "@/lib/github-rest"
import { previewGithubRepo } from "@/lib/repo-ingest"
import { getSession, isAdminRole } from "@/lib/session"

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
  if (
    err instanceof Error &&
    (err as { code?: unknown }).code === "ingest_error"
  ) {
    return Response.json({ error: err.message }, { status: 400 })
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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return Response.json({ error: "Sign in required" }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as { url?: string }
    const url = body.url?.trim()
    if (!url) {
      return Response.json({ error: "Repository URL is required" }, { status: 400 })
    }

    const isAdmin = isAdminRole(session.user.role)
    const result = await previewGithubRepo(url, {
      submittedById: session.user.id,
      skipPendingCheck: isAdmin,
    })

    if (!result.ok) {
      // previewGithubRepo folds GitHub failures into a "github_error"
      // result; a rate limit must surface as 429, not a generic 400.
      if (result.code === "github_error" && /rate limit/i.test(result.error)) {
        return Response.json(
          { error: "GitHub rate limit — try again shortly", code: result.code },
          { status: 429 }
        )
      }
      return Response.json(
        { error: result.error, code: result.code },
        { status: 400 }
      )
    }

    return Response.json(result)
  } catch (err) {
    return apiError(err)
  }
}
