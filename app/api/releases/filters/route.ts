import { getCatalogFilters } from "@/lib/catalog"

export const dynamic = "force-dynamic"

export async function GET() {
  const data = await getCatalogFilters()
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
    },
  })
}
