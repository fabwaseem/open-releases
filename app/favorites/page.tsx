import type { Metadata } from "next"

import { FavoritesPage } from "@/components/favorites/favorites-page"
import { SiteFooter } from "@/components/layout/site-footer"
import { SiteHeader } from "@/components/layout/site-header"
import { brandCopy } from "@/lib/brand"
import { buildMetadata } from "@/lib/seo"
import { requireSession } from "@/lib/session"

export const metadata: Metadata = buildMetadata({
  title: brandCopy.favorites.title,
  description: brandCopy.favorites.description,
  path: "/favorites",
  noIndex: true,
})

export default async function FavoritesRoute() {
  await requireSession()

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main id="main" className="flex-1">
        <FavoritesPage />
      </main>
      <SiteFooter />
    </div>
  )
}
