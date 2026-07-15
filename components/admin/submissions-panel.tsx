"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  DotsThreeIcon,
  XIcon,
} from "@phosphor-icons/react"
import toast from "react-hot-toast"

import { AdminFilterBar } from "@/components/admin/admin-filter-bar"
import { AdminPageHeader } from "@/components/admin/admin-page-header"
import { AdminTablePagination } from "@/components/admin/admin-table-pagination"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { RepoPreview } from "@/lib/repo-submission-types"
import { cn } from "@/lib/utils"

type SubmissionRow = {
  id: string
  fullName: string
  sourceUrl: string
  status: string
  note: string | null
  reviewNote: string | null
  preview: RepoPreview
  createdAt: string
  reviewedAt: string | null
  repositoryId: string | null
  submittedBy: { id: string; name: string; email: string }
  reviewedBy: { id: string; name: string; email: string } | null
}

export function SubmissionsPanel() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState("pending")
  const [q, setQ] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [rejectTarget, setRejectTarget] = React.useState<SubmissionRow | null>(
    null
  )
  const [rejectNote, setRejectNote] = React.useState("")

  React.useEffect(() => {
    setPage(1)
  }, [status, pageSize])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-submissions", status, page, pageSize],
    queryFn: async () => {
      const sp = new URLSearchParams({
        status,
        page: String(page),
        pageSize: String(pageSize),
      })
      const res = await fetch(`/api/submissions?${sp}`)
      if (!res.ok) throw new Error("Failed to load submissions")
      return res.json() as Promise<{
        items: SubmissionRow[]
        total: number
        page: number
        totalPages: number
      }>
    },
    placeholderData: (prev) => prev,
  })

  const review = useMutation({
    mutationFn: async ({
      id,
      action,
      reviewNote,
    }: {
      id: string
      action: "approve" | "reject"
      reviewNote?: string
    }) => {
      const res = await fetch(`/api/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewNote }),
      })
      const payload = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(payload.error || "Review failed")
      return payload
    },
    onSuccess: async (_data, vars) => {
      toast.success(
        vars.action === "approve" ? "Repository approved" : "Submission rejected"
      )
      setRejectTarget(null)
      setRejectNote("")
      await queryClient.invalidateQueries({ queryKey: ["admin-submissions"] })
      await queryClient.invalidateQueries({ queryKey: ["admin-stats"] })
      await queryClient.invalidateQueries({ queryKey: ["admin-repos"] })
      await queryClient.invalidateQueries({ queryKey: ["release-filters"] })
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const items = (data?.items ?? []).filter((item) => {
    if (!q.trim()) return true
    const hay = `${item.fullName} ${item.submittedBy.name} ${item.submittedBy.email}`.toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  })

  return (
    <div>
      <AdminPageHeader
        title="Submissions"
        description="Review user-submitted repositories. Approve imports them into the catalog."
      />

      <AdminFilterBar
        filterClassName="grid-cols-1 sm:grid-cols-2 md:grid-cols-2"
        search={
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by repo or submitter…"
            className="h-10"
          />
        }
        filters={
          <Select
            value={status}
            onValueChange={(value) => {
              if (value) setStatus(value)
            }}
          >
            <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3 sm:max-w-xs">
              <SelectValue placeholder="Status">
                {status === "all"
                  ? "All statuses"
                  : status === "pending"
                    ? "Pending"
                    : status === "approved"
                      ? "Approved"
                      : "Rejected"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div
        className={cn(
          "overflow-hidden border border-border/60",
          isFetching && !isLoading && "opacity-80"
        )}
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Repository</TableHead>
              <TableHead className="hidden w-36 md:table-cell">
                Submitted by
              </TableHead>
              <TableHead className="hidden w-28 lg:table-cell">
                Platforms
              </TableHead>
              <TableHead className="w-24 sm:w-28">Status</TableHead>
              <TableHead className="hidden w-32 sm:table-cell">
                Submitted
              </TableHead>
              <TableHead className="w-12 text-right sm:w-16">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-muted-foreground"
                >
                  No submissions found.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const preview = item.preview
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[180px] sm:max-w-[320px]">
                      <div className="min-w-0">
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:text-primary"
                        >
                          {item.fullName}
                        </a>
                        <p className="truncate text-xs text-muted-foreground">
                          {preview?.releaseTag
                            ? `${preview.releaseTag} · ${preview.stars.toLocaleString()} stars`
                            : item.note || "No note"}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground md:hidden">
                          by {item.submittedBy.name}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <p className="text-sm">{item.submittedBy.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.submittedBy.email}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-xs capitalize text-muted-foreground lg:table-cell">
                      {preview?.platforms?.join(" · ") || "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest uppercase",
                          item.status === "pending" &&
                            "bg-primary/15 text-primary",
                          item.status === "approved" &&
                            "bg-emerald-500/15 text-emerald-400",
                          item.status === "rejected" &&
                            "bg-destructive/15 text-destructive"
                        )}
                      >
                        {item.status}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }).format(new Date(item.createdAt))}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="inline-flex size-8 items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                          aria-label={`Actions for ${item.fullName}`}
                        >
                          <DotsThreeIcon className="size-4" weight="bold" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-48">
                          {item.repositoryId ? (
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(`/repo/${item.fullName}`)
                              }
                            >
                              View in directory
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(item.sourceUrl, "_blank")
                              }
                            >
                              Open on GitHub
                            </DropdownMenuItem>
                          )}
                          {item.status === "pending" ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={review.isPending}
                                onClick={() =>
                                  review.mutate({
                                    id: item.id,
                                    action: "approve",
                                  })
                                }
                              >
                                <CheckIcon className="size-4" />
                                Approve & import
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={review.isPending}
                                onClick={() => {
                                  setRejectTarget(item)
                                  setRejectNote("")
                                }}
                              >
                                <XIcon className="size-4" />
                                Reject
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <AdminTablePagination
        page={data?.page ?? page}
        totalPages={data?.totalPages ?? 1}
        total={data?.total ?? 0}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <Dialog
        open={Boolean(rejectTarget)}
        onOpenChange={(next) => {
          if (!next) setRejectTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="normal-case tracking-tight">
              Reject submission
            </DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `Decline ${rejectTarget.fullName}. Optionally tell the submitter why.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Reason (optional)"
            className="h-11"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={review.isPending || !rejectTarget}
              onClick={() => {
                if (!rejectTarget) return
                review.mutate({
                  id: rejectTarget.id,
                  action: "reject",
                  reviewNote: rejectNote || "Rejected by admin",
                })
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
