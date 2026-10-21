"use client"

import * as React from "react"
import { ArrowUpIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ScrollToTop({ threshold = 480 }: { threshold?: number }) {
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > threshold)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [threshold])

  return (
    <Button
      type="button"
      size="icon"
      aria-label="Scroll to top"
      className={cn(
        "fixed right-4 bottom-4 z-50 rounded-full shadow-lg transition-[opacity,transform] duration-200 motion-reduce:transition-none sm:right-6 sm:bottom-6",
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      )}
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        })
      }
    >
      <ArrowUpIcon className="size-4" weight="bold" />
    </Button>
  )
}