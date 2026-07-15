"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

export function AuthShell({
  children,
  mode,
}: {
  children: ReactNode
  mode: "sign-in" | "sign-up"
}) {
  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <div className="absolute top-4 left-4 z-10 sm:top-6 sm:left-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          render={<Link href="/" />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[55%] bg-[radial-gradient(ellipse_at_top,oklch(0.5_0.22_25_/_0.28),transparent_62%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[35%] bg-[radial-gradient(ellipse_at_bottom,oklch(0.35_0.08_25_/_0.35),transparent_70%)]"
        />

        <div className="relative w-full max-w-md">
          <div className="mb-8 text-center">
            <Link
              href="/"
              className="font-heading text-2xl font-bold tracking-tight"
            >
              Releases
              <span className="text-primary">.</span>
            </Link>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "sign-in"
                ? "Pick up your favorites and keep exploring."
                : "Create an account to save desktop apps you love."}
            </p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
