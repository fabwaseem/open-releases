import type { NextRequest } from "next/server"

import { queryCatalog } from "@/lib/catalog"
import { getSession, isAdminRole } from "@/lib/session"
import { defaultSortDir, type Platform, type SortDir, type SortKey } from "@/lib/types"

export const dynamic = "force-dynamic"

const PLATFORMS = new Set([
  "all",
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
])
const PUBLIC_SORTS = new Set(["score", "stars", "updated", "name", "released"])
const ADMIN_SORTS = new Set([...PUBLIC_SORTS, "created"])

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const platformParam = searchParams.get("platform") ?? "all"
  const sortParam = searchParams.get("sort") ?? "score"
  const dirParam = searchParams.get("dir")

  const session = await getSession()
  const isAdmin = isAdminRole(session?.user?.role)
  const allowedSorts = isAdmin ? ADMIN_SORTS : PUBLIC_SORTS
  const sort = allowedSorts.has(sortParam)
    ? (sortParam as SortKey)
    : "score"
  const dir: SortDir =
    dirParam === "asc" || dirParam === "desc"
      ? dirParam
      : defaultSortDir(sort)

  const data = await queryCatalog({
    q: searchParams.get("q") ?? undefined,
    platform: PLATFORMS.has(platformParam)
      ? (platformParam as Platform | "all")
      : "all",
    sort,
    dir,
    language: searchParams.get("language") ?? undefined,
    page: Number(searchParams.get("page") ?? "1") || 1,
    pageSize: Number(searchParams.get("pageSize") ?? "24") || 24,
  })

  return Response.json(data, {
    headers: {
      "Cache-Control": isAdmin
        ? "private, no-store"
        : "public, s-maxage=30, stale-while-revalidate=60",
    },
  })
}
