import { GitHubApiError } from "@/lib/github-rest"
import { getCatalogFilters } from "@/lib/catalog"

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

export async function GET() {
  try {
    const data = await getCatalogFilters()
    return Response.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
