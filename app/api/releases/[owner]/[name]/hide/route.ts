import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ owner: string; name: string }>
}

/**
 * Soft-hide a repository from the public directory.
 * Body: { "reason"?: string, "hidden"?: boolean }
 */
export async function POST(request: Request, context: RouteContext) {
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
}
