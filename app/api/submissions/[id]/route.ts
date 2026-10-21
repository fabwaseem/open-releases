import { NextRequest } from "next/server"

import { prisma } from "@/lib/db"
import { GitHubApiError } from "@/lib/github-rest"
import { ingestGithubRepo } from "@/lib/repo-ingest"
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session || !isAdminRole(session.user.role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as {
      action?: "approve" | "reject"
      reviewNote?: string
    }

    if (body.action !== "approve" && body.action !== "reject") {
      return Response.json(
        { error: "action must be approve or reject" },
        { status: 400 }
      )
    }

    const submission = await prisma.repoSubmission.findUnique({
      where: { id },
    })
    if (!submission) {
      return Response.json({ error: "Submission not found" }, { status: 404 })
    }
    if (submission.status !== "pending") {
      return Response.json(
        { error: `Submission is already ${submission.status}` },
        { status: 400 }
      )
    }

    const reviewNote = body.reviewNote?.trim() || null

    if (body.action === "reject") {
      const updated = await prisma.repoSubmission.update({
        where: { id },
        data: {
          status: "rejected",
          reviewNote: reviewNote || "Rejected by admin",
          reviewedById: session.user.id,
          reviewedAt: new Date(),
        },
      })
      return Response.json({
        id: updated.id,
        status: updated.status,
        fullName: updated.fullName,
      })
    }

    const repo = await ingestGithubRepo(submission.fullName)
    const updated = await prisma.repoSubmission.update({
      where: { id },
      data: {
        status: "approved",
        reviewNote,
        reviewedById: session.user.id,
        reviewedAt: new Date(),
        repositoryId: repo.id,
      },
    })
    return Response.json({
      id: updated.id,
      status: updated.status,
      fullName: updated.fullName,
      repositoryId: repo.id,
    })
  } catch (err) {
    return apiError(err)
  }
}
