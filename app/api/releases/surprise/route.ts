import type { NextRequest } from "next/server"

import { pickSurpriseRepo } from "@/lib/catalog"
import { isPlatform } from "@/lib/platforms"
import type { Platform } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const platformParam = request.nextUrl.searchParams.get("platform")
  const platform =
    platformParam && isPlatform(platformParam)
      ? (platformParam as Platform)
      : null

  const repo = await pickSurpriseRepo(platform)

  if (!repo) {
    return Response.json({ error: "No repositories available" }, { status: 404 })
  }

  return Response.json(
    { repo },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  )
}
