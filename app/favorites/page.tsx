import { FavoritesPage } from "@/components/favorites/favorites-page"
import { SiteHeader } from "@/components/layout/site-header"
import { requireSession } from "@/lib/session"

export default async function FavoritesRoute() {
  await requireSession()

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <FavoritesPage />
    </div>
  )
}
