import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function AdminFilterBar({
  search,
  filters,
  className,
  filterClassName,
}: {
  search: ReactNode
  filters?: ReactNode
  className?: string
  filterClassName?: string
}) {
  return (
    <div
      className={cn(
        "mb-4 border border-border/60 bg-card/40",
        className
      )}
    >
      <div className="p-3">{search}</div>
      {filters ? (
        <div
          className={cn(
            "grid grid-cols-2 gap-2 border-t border-border/50 p-3 sm:grid-cols-2 md:grid-cols-4",
            filterClassName
          )}
        >
          {filters}
        </div>
      ) : null}
    </div>
  )
}
