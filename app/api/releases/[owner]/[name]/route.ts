import { fetchRepoDetail } from "@/lib/github"

export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ owner: string; name: string }>
}

export async function GET(_request: Request, context: RouteContext) {
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
}