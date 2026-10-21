import { NextRequest } from "next/server"

import { prisma } from "@/lib/db"
import { GitHubApiError } from "@/lib/github-rest"
import { ingestGithubRepo, previewGithubRepo } from "@/lib/repo-ingest"
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

export async function GET(request: NextRequest) {
  try {
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

    const total = await prisma.repoSubmission.count({ where })
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(page, totalPages)

    const items = await prisma.repoSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
      include: {
        submittedBy: {
          select: { id: true, name: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    return Response.json({
      total,
      page: safePage,
      pageSize,
      totalPages,
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        reviewedAt: item.reviewedAt?.toISOString() ?? null,
        updatedAt: item.updatedAt.toISOString(),
      })),
    })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
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

    const note = body.note?.trim() || null
    const { fullName, sourceUrl } = result.preview

    // Admins skip the approval queue and land directly in the catalog.
    if (isAdmin) {
      const repo = await ingestGithubRepo(fullName)
      const now = new Date()

      const pending = await prisma.repoSubmission.findFirst({
        where: { fullName, status: "pending" },
        select: { id: true },
      })

      const submission = pending
        ? await prisma.repoSubmission.update({
            where: { id: pending.id },
            data: {
              status: "approved",
              note: note ?? undefined,
              preview: result.preview,
              reviewedById: session.user.id,
              reviewedAt: now,
              repositoryId: repo.id,
              reviewNote: "Added directly by admin",
            },
            select: {
              id: true,
              fullName: true,
              status: true,
              createdAt: true,
            },
          })
        : await prisma.repoSubmission.create({
            data: {
              fullName,
              sourceUrl,
              status: "approved",
              note,
              preview: result.preview,
              submittedById: session.user.id,
              reviewedById: session.user.id,
              reviewedAt: now,
              repositoryId: repo.id,
              reviewNote: "Added directly by admin",
            },
            select: {
              id: true,
              fullName: true,
              status: true,
              createdAt: true,
            },
          })

      return Response.json({
        ...submission,
        createdAt: submission.createdAt.toISOString(),
        repositoryId: repo.id,
        immediate: true,
      })
    }

    const created = await prisma.repoSubmission.create({
      data: {
        fullName,
        sourceUrl,
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
      immediate: false,
    })
  } catch (err) {
    return apiError(err)
  }
}
