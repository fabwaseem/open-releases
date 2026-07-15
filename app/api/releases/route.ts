import type { NextRequest } from "next/server"

import { queryCatalog } from "@/lib/catalog"
import type { Platform, SortKey } from "@/lib/types"

export const dynamic = "force-dynamic"

const PLATFORMS = new Set(["all", "windows", "macos", "linux"])
const SORTS = new Set(["score", "stars", "updated", "name", "released"])

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const platformParam = searchParams.get("platform") ?? "all"
  const sortParam = searchParams.get("sort") ?? "score"

  const data = await queryCatalog({
    q: searchParams.get("q") ?? undefined,
    platform: PLATFORMS.has(platformParam)
      ? (platformParam as Platform | "all")
      : "all",
    sort: SORTS.has(sortParam) ? (sortParam as SortKey) : "score",
    language: searchParams.get("language") ?? undefined,
    page: Number(searchParams.get("page") ?? "1") || 1,
    pageSize: Number(searchParams.get("pageSize") ?? "24") || 24,
  })

  return Response.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  })
}