"use client"

import * as React from "react"
import { useIsFetching } from "@tanstack/react-query"

import { cn } from "@/lib/utils"

/**
 * Full-page loader for the first data fetch after mount.
 * Hides once and stays gone for the rest of the session.
 */
export function PageLoader() {
  const fetching = useIsFetching()
  const [visible, setVisible] = React.useState(true)
  const [leaving, setLeaving] = React.useState(false)
  const sawFetch = React.useRef(false)

  React.useEffect(() => {
    if (fetching > 0) sawFetch.current = true
  }, [fetching])

  React.useEffect(() => {
    if (sawFetch.current && fetching === 0) {
      setLeaving(true)
      return
    }
    // Static routes / cache hits — don't block forever.
    const fallback = window.setTimeout(() => {
      if (!sawFetch.current) setLeaving(true)
    }, 1200)
    return () => window.clearTimeout(fallback)
  }, [fetching])

  React.useEffect(() => {
    if (!leaving) return
    const t = window.setTimeout(() => setVisible(false), 520)
    return () => window.clearTimeout(t)
  }, [leaving])

  React.useEffect(() => {
    if (!visible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [visible])

  if (!visible) return null

  return (
    <div
      className={cn(
        "fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background",
        "transition-opacity duration-500 ease-out",
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      )}
      aria-busy={!leaving}
      aria-live="polite"
      role="status"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[50%] bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.2_25_/_0.28),transparent_65%)]"
      />

      <div className="relative flex flex-col items-center gap-6 px-6">
        <div className="relative flex size-16 items-center justify-center">
          <span className="page-loader-ring absolute inset-0 rounded-full border border-primary/30" />
          <span className="page-loader-ring page-loader-ring-delay absolute inset-[-6px] rounded-full border border-primary/50" />
          <span className="size-3 rounded-full bg-primary shadow-[0_0_24px_var(--primary)]" />
        </div>

        <div className="text-center">
          <p className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
            Releases
            <span className="text-primary">.</span>
          </p>
          <p className="mt-2 text-xs tracking-[0.18em] text-muted-foreground uppercase">
            Loading catalog
          </p>
        </div>
      </div>
    </div>
  )
}
