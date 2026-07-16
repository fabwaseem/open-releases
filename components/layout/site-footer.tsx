import Link from "next/link"

import { BrandMark } from "@/components/layout/brand-mark"
import { siteConfig } from "@/lib/brand"

export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border/60 bg-background/80">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="space-y-1">
          <BrandMark className="text-sm" />
          <p className="text-xs text-muted-foreground">
            © {year} {siteConfig.name}. Open-source apps for desktop and mobile.
          </p>
        </div>
        <nav
          aria-label="Legal"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
        >
          <Link
            href="/privacy"
            className="transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  )
}
