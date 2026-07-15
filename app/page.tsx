import { Suspense } from "react"

import { DirectoryPage } from "@/components/directory/directory-page"
import { SiteFooter } from "@/components/layout/site-footer"
import { SiteHeader } from "@/components/layout/site-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function Page() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <div className="flex-1">
        <Suspense
          fallback={
            <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
              <Skeleton className="mb-8 h-28 w-full max-w-xl" />
              <Skeleton className="mb-4 h-12 w-full" />
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-56 rounded-2xl sm:h-64" />
                ))}
              </div>
            </div>
          }
        >
          <DirectoryPage />
        </Suspense>
      </div>
      <SiteFooter />
    </div>
  )
}
