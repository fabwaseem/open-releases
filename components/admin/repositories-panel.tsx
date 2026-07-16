"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowSquareOutIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  PushPinIcon,
  PushPinSlashIcon,
} from "@phosphor-icons/react"
import toast from "react-hot-toast"

import { AdminFilterBar } from "@/components/admin/admin-filter-bar"
import { AdminPageHeader } from "@/components/admin/admin-page-header"
import { AdminTablePagination } from "@/components/admin/admin-table-pagination"
import { SortableTableHead } from "@/components/admin/sortable-table-head"
import type { AdminListResponse, AdminRepo } from "@/components/admin/types"
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
import { cn } from "@/lib/utils"

type RepoListResponse = AdminListResponse<AdminRepo> & {
  languages: string[]
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

function platformLabel(repo: AdminRepo) {
  const parts = [
    repo.hasWindows ? "Win" : null,
    repo.hasMacos ? "Mac" : null,
    repo.hasLinux ? "Linux" : null,
    repo.hasAndroid ? "Android" : null,
    repo.hasIos ? "iOS" : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "—"
}

function formatAdded(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(value))
  } catch {
    return value
  }
}

export function RepositoriesPanel() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [q, setQ] = React.useState("")
  const debouncedQ = useDebouncedValue(q)
  const [hidden, setHidden] = React.useState<"all" | "false" | "true">("all")
  const [featured, setFeatured] = React.useState<"all" | "false" | "true">(
    "all"
  )
  const [language, setLanguage] = React.useState("all")
  const [platform, setPlatform] = React.useState("all")
  const [minStars, setMinStars] = React.useState("0")
  const [sortBy, setSortBy] = React.useState("createdAt")
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)

  React.useEffect(() => {
    setPage(1)
  }, [debouncedQ, hidden, featured, language, platform, minStars, pageSize])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "admin-repos",
      debouncedQ,
      hidden,
      featured,
      language,
      platform,
      minStars,
      sortBy,
      sortDir,
      page,
      pageSize,
    ],
    queryFn: async () => {
      const sp = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      })
      if (debouncedQ) sp.set("q", debouncedQ)
      if (hidden !== "all") sp.set("hidden", hidden)
      if (featured !== "all") sp.set("featured", featured)
      if (language !== "all") sp.set("language", language)
      if (platform !== "all") sp.set("platform", platform)
      if (minStars !== "0") sp.set("minStars", minStars)
      const res = await fetch(`/api/admin/repositories?${sp}`)
      if (!res.ok) throw new Error("Failed to load repositories")
      return res.json() as Promise<RepoListResponse>
    },
    placeholderData: (prev) => prev,
  })

  async function refreshRepos() {
    await queryClient.invalidateQueries({ queryKey: ["admin-repos"] })
    await queryClient.invalidateQueries({ queryKey: ["admin-stats"] })
    await queryClient.invalidateQueries({ queryKey: ["release-filters"] })
    await queryClient.invalidateQueries({ queryKey: ["releases"] })
  }

  const toggleHidden = useMutation({
    mutationFn: async (repo: AdminRepo) => {
      const res = await fetch("/api/admin/repositories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: repo.id,
          hidden: !repo.hidden,
          hiddenReason: repo.hidden ? null : "Hidden by admin",
        }),
      })
      if (!res.ok) throw new Error("Update failed")
      return res.json()
    },
    onSuccess: async () => {
      toast.success("Visibility updated")
      await refreshRepos()
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const toggleFeatured = useMutation({
    mutationFn: async (repo: AdminRepo) => {
      const res = await fetch("/api/admin/repositories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: repo.id,
          featured: !repo.featured,
        }),
      })
      if (!res.ok) throw new Error("Update failed")
      return res.json()
    },
    onSuccess: async (_data, repo) => {
      toast.success(repo.featured ? "Unfeatured" : "Featured on directory")
      await refreshRepos()
    },
    onError: (err) => toast.error((err as Error).message),
  })

  function handleSort(column: string) {
    if (sortBy === column) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(column)
      setSortDir(column === "fullName" || column === "language" ? "asc" : "desc")
    }
    setPage(1)
  }

  const items = data?.items ?? []
  const languages = data?.languages ?? []

  return (
    <div>
      <AdminPageHeader
        title="Repositories"
        description="Search, filter, sort, and hide listings from the public directory."
      />

      <AdminFilterBar
        filterClassName="grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
        search={
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, owner…"
            className="h-10"
          />
        }
        filters={
          <>
            <Select
              value={hidden}
              onValueChange={(value) => {
                if (value) setHidden(value as typeof hidden)
              }}
            >
              <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3">
                <SelectValue placeholder="Visibility">
                  {hidden === "all"
                    ? "All visibility"
                    : hidden === "true"
                      ? "Hidden"
                      : "Visible"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All visibility</SelectItem>
                <SelectItem value="false">Visible</SelectItem>
                <SelectItem value="true">Hidden</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={featured}
              onValueChange={(value) => {
                if (value) setFeatured(value as typeof featured)
              }}
            >
              <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3">
                <SelectValue placeholder="Featured">
                  {featured === "all"
                    ? "All featured"
                    : featured === "true"
                      ? "Featured"
                      : "Not featured"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All featured</SelectItem>
                <SelectItem value="true">Featured</SelectItem>
                <SelectItem value="false">Not featured</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={language}
              onValueChange={(value) => {
                if (value) setLanguage(value)
              }}
            >
              <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3">
                <SelectValue placeholder="Language">
                  {language === "all" ? "All languages" : language}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All languages</SelectItem>
                {languages.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={platform}
              onValueChange={(value) => {
                if (value) setPlatform(value)
              }}
            >
              <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3">
                <SelectValue placeholder="Platform">
                  {{
                    all: "All platforms",
                    windows: "Windows",
                    macos: "macOS",
                    linux: "Linux",
                    android: "Android",
                    ios: "iOS",
                  }[platform] ?? "Platform"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                <SelectItem value="windows">Windows</SelectItem>
                <SelectItem value="macos">macOS</SelectItem>
                <SelectItem value="linux">Linux</SelectItem>
                <SelectItem value="android">Android</SelectItem>
                <SelectItem value="ios">iOS</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={minStars}
              onValueChange={(value) => {
                if (value) setMinStars(value)
              }}
            >
              <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3">
                <SelectValue placeholder="Min stars">
                  {minStars === "0" ? "Any stars" : `${minStars}+ stars`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any stars</SelectItem>
                <SelectItem value="100">100+ stars</SelectItem>
                <SelectItem value="500">500+ stars</SelectItem>
                <SelectItem value="1000">1k+ stars</SelectItem>
                <SelectItem value="5000">5k+ stars</SelectItem>
                <SelectItem value="10000">10k+ stars</SelectItem>
              </SelectContent>
            </Select>
          </>
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
              <SortableTableHead
                label="Repository"
                column="fullName"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableTableHead
                label="Stars"
                column="stars"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="hidden w-24 sm:table-cell"
              />
              <SortableTableHead
                label="Score"
                column="activityScore"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="hidden w-24 md:table-cell"
              />
              <SortableTableHead
                label="Language"
                column="language"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="hidden w-32 lg:table-cell"
              />
              <TableHead className="hidden w-36 lg:table-cell">
                Platforms
              </TableHead>
              <SortableTableHead
                label="Favorites"
                column="favorites"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="hidden w-28 md:table-cell"
              />
              <SortableTableHead
                label="Added"
                column="createdAt"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="hidden w-32 lg:table-cell"
              />
              <TableHead className="w-24 sm:w-28">Status</TableHead>
              <TableHead className="w-12 text-right sm:w-16">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center text-muted-foreground"
                >
                  No repositories match these filters.
                </TableCell>
              </TableRow>
            ) : (
              items.map((repo) => (
                <TableRow key={repo.id}>
                  <TableCell className="max-w-[200px] sm:max-w-[280px]">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-medium">{repo.name}</p>
                        {repo.featured ? (
                          <span className="shrink-0 bg-primary/15 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest text-primary uppercase">
                            Featured
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {repo.fullName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                        {repo.stars.toLocaleString()} stars · score{" "}
                        {repo.activityScore.toFixed(1)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground lg:hidden">
                        Added {formatAdded(repo.createdAt)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {repo.stars.toLocaleString()}
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">
                    {repo.activityScore.toFixed(1)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {repo.language ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {platformLabel(repo)}
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">
                    {repo._count.favorites}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground tabular-nums lg:table-cell">
                    {formatAdded(repo.createdAt)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest uppercase",
                        repo.hidden
                          ? "bg-destructive/15 text-destructive"
                          : "bg-primary/15 text-primary"
                      )}
                    >
                      {repo.hidden ? "Hidden" : "Visible"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex size-8 items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                        aria-label={`Actions for ${repo.fullName}`}
                      >
                        <DotsThreeIcon className="size-4" weight="bold" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem
                          onClick={() => router.push(`/repo/${repo.fullName}`)}
                        >
                          <ArrowSquareOutIcon className="size-4" />
                          View page
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={toggleFeatured.isPending}
                          onClick={() => toggleFeatured.mutate(repo)}
                        >
                          {repo.featured ? (
                            <>
                              <PushPinSlashIcon className="size-4" />
                              Unfeature
                            </>
                          ) : (
                            <>
                              <PushPinIcon className="size-4" />
                              Feature
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={toggleHidden.isPending}
                          onClick={() => toggleHidden.mutate(repo)}
                        >
                          {repo.hidden ? (
                            <>
                              <EyeIcon className="size-4" />
                              Unhide
                            </>
                          ) : (
                            <>
                              <EyeSlashIcon className="size-4" />
                              Hide
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
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
    </div>
  )
}
