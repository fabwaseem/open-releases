import { NextRequest } from "next/server"

import { prisma } from "@/lib/db"
import { previewGithubRepo } from "@/lib/repo-ingest"
import { getSession, isAdminRole } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const mine = searchParams.get("mine") === "true"

  if (mine) {
    const items = await prisma.repoSubmission.findMany({
      where: { submittedById: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        fullName: true,
        status: true,
        createdAt: true,
        reviewNote: true,
      },
    })
    return Response.json({
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    })
  }

  if (!isAdminRole(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const status = (searchParams.get("status") ?? "pending").trim()
  const page = Math.max(Number(searchParams.get("page") ?? "1") || 1, 1)
  const pageSize = Math.min(
    Math.max(Number(searchParams.get("pageSize") ?? "20") || 20, 1),
    100
  )

  const where = {
    ...(status === "all"
      ? {}
      : status === "pending" || status === "approved" || status === "rejected"
        ? { status }
        : { status: "pending" }),
  }

  const [total, items] = await Promise.all([
    prisma.repoSubmission.count({ where }),
    prisma.repoSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        submittedBy: {
          select: { id: true, name: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
  ])

  return Response.json({
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      reviewedAt: item.reviewedAt?.toISOString() ?? null,
      updatedAt: item.updatedAt.toISOString(),
    })),
  })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: "Sign in required" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    url?: string
    note?: string
  }
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

  const note = body.note?.trim() || null

  const created = await prisma.repoSubmission.create({
    data: {
      fullName: result.preview.fullName,
      sourceUrl: result.preview.sourceUrl,
      status: "pending",
      note,
      preview: result.preview,
      submittedById: session.user.id,
    },
    select: {
      id: true,
      fullName: true,
      status: true,
      createdAt: true,
    },
  })

  return Response.json({
    ...created,
    createdAt: created.createdAt.toISOString(),
  })
}
