"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { brandCopy } from "@/lib/brand"

type NotFoundViewProps = {
  title: string
  description: string
  code?: string
  ctaLabel?: string
  ctaHref?: string
  secondaryLabel?: string
  secondaryHref?: string
}

export function NotFoundView({
  title,
  description,
  code = brandCopy.notFound.code,
  ctaLabel = brandCopy.notFound.cta,
  ctaHref = "/",
  secondaryLabel,
  secondaryHref,
}: NotFoundViewProps) {
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
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button render={<Link href={ctaHref} />}>
            {ctaLabel}
          </Button>
          {secondaryLabel && secondaryHref ? (
            <Button
              variant="outline"
              render={<Link href={secondaryHref} />}
             
            >
              {secondaryLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
