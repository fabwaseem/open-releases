import { fetchRepoDetail } from "@/lib/github"
import { GitHubApiError } from "@/lib/github-rest"

export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ owner: string; name: string }>
}

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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { owner, name } = await context.params
    if (!owner || !name) {
      return Response.json({ error: "Missing owner or name" }, { status: 400 })
    }

    const detail = await fetchRepoDetail(owner, name)
    if (!detail) {
      return Response.json({ error: "Repository not found in catalog" }, { status: 404 })
    }

    return Response.json(detail, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
