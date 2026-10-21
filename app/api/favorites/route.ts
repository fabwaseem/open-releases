import { NextRequest } from "next/server"

import { prisma } from "@/lib/db"
import { GitHubApiError } from "@/lib/github-rest"
import { getSession } from "@/lib/session"
import { toCatalogRepo } from "@/lib/catalog"

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
    const session = await getSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Hidden repositories are filtered out in the query so their ids never
    // leak into `ids`; `count` comes from this same filtered result.
    const favorites = await prisma.favorite.findMany({
      where: { userId: session.user.id, repository: { hidden: false } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      include: {
        repository: { include: { latestRelease: true } },
      },
    })

    const items = favorites
      .map((f) => toCatalogRepo(f.repository))
      .filter((r): r is NonNullable<typeof r> => r != null)

    return Response.json({
      count: favorites.length,
      ids: favorites.map((f) => f.repositoryId),
      items,
    })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      repositoryId?: string
      fullName?: string
    }

    let repositoryId = body.repositoryId
    if (!repositoryId && body.fullName) {
      const repo = await prisma.repository.findFirst({
        where: {
          fullName: { equals: body.fullName, mode: "insensitive" },
          hidden: false,
        },
        select: { id: true },
      })
      repositoryId = repo?.id
    }

    if (!repositoryId) {
      return Response.json({ error: "Repository required" }, { status: 400 })
    }

    const repo = await prisma.repository.findFirst({
      where: { id: repositoryId, hidden: false },
      select: { id: true },
    })
    if (!repo) {
      return Response.json({ error: "Repository not found" }, { status: 404 })
    }

    await prisma.favorite.upsert({
      where: {
        userId_repositoryId: {
          userId: session.user.id,
          repositoryId: repo.id,
        },
      },
      create: {
        userId: session.user.id,
        repositoryId: repo.id,
      },
      update: {},
    })

    return Response.json({ ok: true, repositoryId: repo.id, favorited: true })
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const repositoryId = searchParams.get("repositoryId")
    const fullName = searchParams.get("fullName")

    let id = repositoryId
    if (!id && fullName) {
      const repo = await prisma.repository.findFirst({
        where: { fullName: { equals: fullName, mode: "insensitive" } },
        select: { id: true },
      })
      id = repo?.id ?? null
    }

    if (!id) {
      return Response.json({ error: "Repository required" }, { status: 400 })
    }

    await prisma.favorite.deleteMany({
      where: { userId: session.user.id, repositoryId: id },
    })

    return Response.json({ ok: true, repositoryId: id, favorited: false })
  } catch (err) {
    return apiError(err)
  }
}
