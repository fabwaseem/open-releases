import { NextRequest } from "next/server"
import type { Prisma } from "@/generated/prisma/client"

import { prisma } from "@/lib/db"
import { GitHubApiError } from "@/lib/github-rest"
import { getSession, isAdminRole } from "@/lib/session"

export const dynamic = "force-dynamic"

const SORT_FIELDS = [
  "activityScore",
  "stars",
  "fullName",
  "language",
  "scrapedAt",
  "createdAt",
  "favorites",
  "featured",
] as const

type SortField = (typeof SORT_FIELDS)[number]

function parseSort(value: string | null): SortField {
  return SORT_FIELDS.includes(value as SortField)
    ? (value as SortField)
    : "activityScore"
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

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminRole(session.user.role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = request.nextUrl
    const q = (searchParams.get("q") ?? "").trim()
    const hidden = searchParams.get("hidden")
    const featured = searchParams.get("featured")
    const language = (searchParams.get("language") ?? "").trim()
    const platform = (searchParams.get("platform") ?? "").trim()
    const minStars = Math.max(Number(searchParams.get("minStars") ?? "0") || 0, 0)
    const sortBy = parseSort(searchParams.get("sortBy"))
    const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"
    const page = Math.max(Number(searchParams.get("page") ?? "1") || 1, 1)
    const pageSize = Math.min(
      Math.max(Number(searchParams.get("pageSize") ?? "20") || 20, 1),
      100
    )

    const where: Prisma.RepositoryWhereInput = {
      ...(hidden === "true"
        ? { hidden: true }
        : hidden === "false"
          ? { hidden: false }
          : {}),
      ...(featured === "true"
        ? { featured: true }
        : featured === "false"
          ? { featured: false }
          : {}),
      ...(language ? { language } : {}),
      ...(platform === "windows"
        ? { hasWindows: true }
        : platform === "macos"
          ? { hasMacos: true }
          : platform === "linux"
            ? { hasLinux: true }
            : platform === "android"
              ? { hasAndroid: true }
              : platform === "ios"
                ? { hasIos: true }
                : {}),
      ...(minStars > 0 ? { stars: { gte: minStars } } : {}),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { owner: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    }

    const orderBy: Prisma.RepositoryOrderByWithRelationInput[] =
      sortBy === "favorites"
        ? [{ favorites: { _count: sortDir } }, { activityScore: "desc" }]
        : sortBy === "featured"
          ? [{ featured: sortDir }, { featuredAt: "desc" }, { activityScore: "desc" }]
          : [{ [sortBy]: sortDir }, { activityScore: "desc" }]

    const total = await prisma.repository.count({ where })
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(page, totalPages)

    const [items, languageRows] = await Promise.all([
      prisma.repository.findMany({
        where,
        orderBy,
        skip: (safePage - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          name: true,
          owner: true,
          stars: true,
          activityScore: true,
          language: true,
          hidden: true,
          hiddenReason: true,
          featured: true,
          featuredAt: true,
          scrapedAt: true,
          createdAt: true,
          hasWindows: true,
          hasMacos: true,
          hasLinux: true,
          hasAndroid: true,
          hasIos: true,
          _count: { select: { favorites: true } },
        },
      }),
      prisma.repository.findMany({
        where: { language: { not: null } },
        distinct: ["language"],
        select: { language: true },
        orderBy: { language: "asc" },
        take: 200,
      }),
    ])

    return Response.json({
      total,
      page: safePage,
      pageSize,
      totalPages,
      sortBy,
      sortDir,
      languages: languageRows
        .map((row) => row.language)
        .filter((value): value is string => Boolean(value)),
      items: items.map((item) => ({
        ...item,
        scrapedAt: item.scrapedAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
        featuredAt: item.featuredAt?.toISOString() ?? null,
      })),
    })
  } catch (err) {
    return apiError(err)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminRole(session.user.role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      id?: string
      hidden?: boolean
      hiddenReason?: string | null
      featured?: boolean
    }

    if (!body.id) {
      return Response.json({ error: "id required" }, { status: 400 })
    }

    const hasHidden = typeof body.hidden === "boolean"
    const hasFeatured = typeof body.featured === "boolean"
    if (!hasHidden && !hasFeatured) {
      return Response.json(
        { error: "Provide hidden and/or featured" },
        { status: 400 }
      )
    }

    const data: Prisma.RepositoryUpdateInput = {}
    if (hasHidden) {
      data.hidden = body.hidden
      data.hiddenReason = body.hidden
        ? body.hiddenReason?.trim() || "Hidden by admin"
        : null
    }
    if (hasFeatured) {
      data.featured = body.featured
      data.featuredAt = body.featured ? new Date() : null
    }

    const updated = await prisma.repository.update({
      where: { id: body.id },
      data,
      select: {
        id: true,
        fullName: true,
        hidden: true,
        hiddenReason: true,
        featured: true,
        featuredAt: true,
      },
    })

    if (hasHidden) {
      await prisma.scrapeRecord.upsert({
        where: { fullName: updated.fullName },
        create: {
          fullName: updated.fullName,
          status: updated.hidden ? "hidden" : "saved",
          reason: updated.hiddenReason ?? undefined,
          repositoryId: updated.id,
        },
        update: {
          status: updated.hidden ? "hidden" : "saved",
          reason: updated.hiddenReason ?? undefined,
          repositoryId: updated.id,
          lastSeenAt: new Date(),
        },
      })
    }

    return Response.json({
      ...updated,
      featuredAt: updated.featuredAt?.toISOString() ?? null,
    })
  } catch (err) {
    return apiError(err)
  }
}
