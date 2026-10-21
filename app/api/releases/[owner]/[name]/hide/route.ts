import { prisma } from "@/lib/db"
import { GitHubApiError } from "@/lib/github-rest"
import { getSession, isAdminRole } from "@/lib/session"

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

/**
 * Soft-hide a repository from the public directory (admin only).
 * Body: { "reason"?: string, "hidden"?: boolean }
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await getSession()
    if (!session || !isAdminRole(session.user.role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { owner, name } = await context.params
    if (!owner || !name) {
      return Response.json({ error: "Missing owner or name" }, { status: 400 })
    }

    const fullName = `${owner}/${name}`
    const body = (await request.json().catch(() => ({}))) as {
      reason?: string
      hidden?: boolean
    }
    const hidden = body.hidden !== false
    const reason = body.reason?.trim() || (hidden ? "hidden via api" : null)

    const repo = await prisma.repository.findFirst({
      where: { fullName: { equals: fullName, mode: "insensitive" } },
    })
    if (!repo) {
      return Response.json({ error: "Repository not found" }, { status: 404 })
    }

    const updated = await prisma.repository.update({
      where: { id: repo.id },
      data: {
        hidden,
        hiddenReason: hidden ? reason : null,
      },
    })

    await prisma.scrapeRecord.upsert({
      where: { fullName: updated.fullName },
      create: {
        fullName: updated.fullName,
        status: hidden ? "hidden" : "saved",
        reason: reason ?? undefined,
        repositoryId: updated.id,
        lastSeenAt: new Date(),
      },
      update: {
        status: hidden ? "hidden" : "saved",
        reason: reason ?? undefined,
        repositoryId: updated.id,
        lastSeenAt: new Date(),
      },
    })

    return Response.json({
      full_name: updated.fullName,
      hidden: updated.hidden,
      hidden_reason: updated.hiddenReason,
    })
  } catch (err) {
    return apiError(err)
  }
}
