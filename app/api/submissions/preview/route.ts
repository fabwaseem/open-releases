import { NextRequest } from "next/server"

import { previewGithubRepo } from "@/lib/repo-ingest"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: "Sign in required" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { url?: string }
  const url = body.url?.trim()
  if (!url) {
    return Response.json({ error: "Repository URL is required" }, { status: 400 })
  }

  const result = await previewGithubRepo(url, {
    submittedById: session.user.id,
  })

  if (!result.ok) {
    return Response.json(
      { error: result.error, code: result.code },
      { status: 400 }
    )
  }

  return Response.json(result)
}
