"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { brandCopy } from "@/lib/brand"

type ErrorViewProps = {
  title?: string
  description?: string
  code?: string
  digest?: string
  ctaLabel?: string
  ctaHref?: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorView({
  title = brandCopy.error.title,
  description = brandCopy.error.description,
  code = brandCopy.error.code,
  digest,
  ctaLabel = brandCopy.error.cta,
  ctaHref = "/",
  onRetry,
  retryLabel = brandCopy.error.retry,
}: ErrorViewProps) {
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-background px-4 py-10 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.2_25_/_0.22),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative flex w-full max-w-lg flex-col items-center text-center">
        <p className="font-heading text-[5.5rem] leading-none font-bold tracking-tighter text-primary/25 select-none sm:text-[7rem]">
          {code}
        </p>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight text-balance sm:text-3xl lg:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
          {description}
        </p>
        {digest ? (
          <p className="mt-2 font-mono text-[0.65rem] text-muted-foreground/70">
            Ref: {digest}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {onRetry ? (
            <Button type="button" className="rounded-xl" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          <Button
            variant={onRetry ? "outline" : "default"}
            render={<Link href={ctaHref} />}
            className="rounded-xl"
          >
            {ctaLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
