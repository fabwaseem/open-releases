import { NextRequest } from "next/server"
import type { Prisma } from "@/generated/prisma/client"

import { prisma } from "@/lib/db"
import { getSession, isAdminRole } from "@/lib/session"

export const dynamic = "force-dynamic"

const SORT_FIELDS = [
  "createdAt",
  "name",
  "email",
  "role",
  "favorites",
] as const

type SortField = (typeof SORT_FIELDS)[number]

function parseSort(value: string | null): SortField {
  return SORT_FIELDS.includes(value as SortField)
    ? (value as SortField)
    : "createdAt"
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminRole(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const q = (searchParams.get("q") ?? "").trim()
  const role = (searchParams.get("role") ?? "").trim()
  const banned = searchParams.get("banned")
  const emailVerified = searchParams.get("emailVerified")
  const sortBy = parseSort(searchParams.get("sortBy"))
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"
  const page = Math.max(Number(searchParams.get("page") ?? "1") || 1, 1)
  const pageSize = Math.min(
    Math.max(Number(searchParams.get("pageSize") ?? "20") || 20, 1),
    100
  )

  const where: Prisma.UserWhereInput = {
    ...(role === "admin" || role === "user" ? { role } : {}),
    ...(banned === "true"
      ? { banned: true }
      : banned === "false"
        ? { banned: false }
        : {}),
    ...(emailVerified === "true"
      ? { emailVerified: true }
      : emailVerified === "false"
        ? { emailVerified: false }
        : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  }

  const orderBy: Prisma.UserOrderByWithRelationInput[] =
    sortBy === "favorites"
      ? [{ favorites: { _count: sortDir } }, { createdAt: "desc" }]
      : [{ [sortBy]: sortDir }, { createdAt: "desc" }]

  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        banReason: true,
        emailVerified: true,
        createdAt: true,
        image: true,
        _count: { select: { favorites: true } },
      },
    }),
  ])

  return Response.json({
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sortBy,
    sortDir,
    items: items.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
    })),
  })
}
