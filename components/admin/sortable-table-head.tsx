"use client"

import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react"

import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export function SortableTableHead({
  label,
  column,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label: string
  column: string
  sortBy: string
  sortDir: "asc" | "desc"
  onSort: (column: string) => void
  className?: string
}) {
  const active = sortBy === column

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1.5 transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        <span className="inline-flex flex-col leading-none">
          <CaretUpIcon
            className={cn(
              "size-2.5",
              active && sortDir === "asc" ? "text-primary" : "opacity-30"
            )}
          />
          <CaretDownIcon
            className={cn(
              "-mt-0.5 size-2.5",
              active && sortDir === "desc" ? "text-primary" : "opacity-30"
            )}
          />
        </span>
      </button>
    </TableHead>
  )
}
