"use client"

import {
  CaretLeftIcon,
  CaretRightIcon,
  DotsThreeIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const PAGE_SIZES = [10, 20, 30, 50, 100] as const

function getPageItems(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const items: Array<number | "…"> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(totalPages - 1, page + 1)

  if (start > 2) items.push("…")
  for (let i = start; i <= end; i += 1) items.push(i)
  if (end < totalPages - 1) items.push("…")
  items.push(totalPages)
  return items
}

export function AdminTablePagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  className,
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  className?: string
}) {
  const pages = getPageItems(page, Math.max(totalPages, 1))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border border-t-0 border-border/60 bg-card/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {from}–{to} of {total}
        </span>
        <div className="flex items-center gap-2">
          <span className="tracking-widest uppercase">Rows</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              if (value) onPageSizeChange(Number(value))
            }}
          >
            <SelectTrigger className="h-8 w-[4.5rem] border border-border/70 bg-background/50 px-2 text-xs">
              <SelectValue>{pageSize}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-2 sm:px-4"
        >
          <CaretLeftIcon data-icon="inline-start" />
          <span className="hidden sm:inline">Prev</span>
        </Button>

        <div className="flex max-w-[min(100%,14rem)] flex-wrap items-center justify-center gap-1 sm:max-w-none">
          {pages.map((item, index) =>
            item === "…" ? (
              <span
                key={`e-${index}`}
                className="flex size-8 items-center justify-center text-muted-foreground"
              >
                <DotsThreeIcon className="size-4" />
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                variant={item === page ? "default" : "outline"}
                size="icon-sm"
                className="tabular-nums"
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            )
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-2 sm:px-4"
        >
          <span className="hidden sm:inline">Next</span>
          <CaretRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
