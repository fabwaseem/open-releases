import type { ReactNode } from "react"
import Link from "next/link"

import { SiteFooter } from "@/components/layout/site-footer"
import { SiteHeader } from "@/components/layout/site-header"

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader />
      <main className="relative mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <p className="mb-2 text-[0.65rem] font-semibold tracking-[0.18em] text-primary uppercase">
          Legal
        </p>
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {updated}
        </p>
        <div className="prose-legal mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">
          {children}
        </div>
        <p className="mt-12 text-sm text-muted-foreground">
          <Link href="/" className="text-primary underline-offset-4 hover:underline">
            ← Back to directory
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}

export function LegalSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-lg font-semibold text-foreground">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
