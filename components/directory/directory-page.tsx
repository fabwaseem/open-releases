"use client"

import * as React from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import {
  AppleLogoIcon,
  LinuxLogoIcon,
  MagnifyingGlassIcon,
  SpinnerGapIcon,
  SquaresFourIcon,
  WindowsLogoIcon,
} from "@phosphor-icons/react"

import { ReleaseCard } from "@/components/directory/release-card"
import { AddRepoButton } from "@/components/submissions/add-repo-dialog"
import { Button } from "@/components/ui/button"
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
  fetchReleaseFilters,
  fetchReleases,
  queryKeys,
} from "@/lib/api-client"
import type { Platform, SortKey } from "@/lib/types"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 18

const PLATFORM_ICONS: Record<
  Platform | "all",
  React.ComponentType<{ className?: string; weight?: "fill" | "regular" }>
> = {
  all: SquaresFourIcon,
  windows: WindowsLogoIcon,
  macos: AppleLogoIcon,
  linux: LinuxLogoIcon,
}

function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

export function DirectoryPage() {
  const [search, setSearch] = React.useState("")
  const [platform, setPlatform] = React.useState<Platform | "all">("all")
  const [sort, setSort] = React.useState<SortKey>("score")
  const [language, setLanguage] = React.useState("")
  const debouncedSearch = useDebouncedValue(search)
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null)

  const filterParams = {
    q: debouncedSearch,
    platform,
    sort,
    language: language || undefined,
    pageSize: PAGE_SIZE,
  }

  const { data: filters } = useQuery({
    queryKey: queryKeys.releaseFilters,
    queryFn: fetchReleaseFilters,
    staleTime: 60_000,
  })

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.releasesInfinite(filterParams),
    queryFn: ({ pageParam }) =>
      fetchReleases({
        ...filterParams,
        page: pageParam,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  })

  React.useEffect(() => {
    const node = loadMoreRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: "320px 0px" }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const firstPage = data?.pages[0]
  const totalLoaded = filters?.repository_count ?? 0
  const platformFilters = filters?.platform_filters ?? [
    { id: "all" as const, label: "All", count: 0 },
    { id: "windows" as const, label: "Windows", count: 0 },
    { id: "macos" as const, label: "macOS", count: 0 },
    { id: "linux" as const, label: "Linux", count: 0 },
  ]
  const sortOptions = filters?.sort_options ?? [
    { value: "score" as const, label: "Default" },
    { value: "stars" as const, label: "Most stars" },
    { value: "released" as const, label: "Newest release" },
    { value: "updated" as const, label: "Recently updated" },
    { value: "name" as const, label: "Name A–Z" },
  ]
  const sortLabel =
    sortOptions.find((option) => option.value === sort)?.label ?? "Default"
  const languageLabel = language || "All"
  const languages = filters?.languages ?? []
  const showing = firstPage?.total ?? 0
  const items = data?.pages.flatMap((page) => page.items) ?? []
  const loadedCount = items.length

  return (
    <div className="relative min-h-svh bg-background">
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

      <div className="relative mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
        <header className="mb-6 space-y-4 sm:mb-8 sm:space-y-5 lg:mb-12">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-[0.65rem] font-semibold tracking-[0.18em] text-primary uppercase sm:mb-2 sm:text-xs sm:tracking-[0.2em]">
                Open source releases
              </p>
              <h1 className="font-heading text-[1.85rem] leading-[1.1] font-bold tracking-tight text-balance sm:text-4xl lg:text-6xl">
                Latest desktop apps
                <span className="text-primary">.</span>
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <AddRepoButton variant="tile" />
              <div className="flex size-11 flex-col items-center justify-center rounded-xl bg-primary text-center sm:size-[4.5rem] sm:rounded-2xl">
                <p className="text-sm leading-none font-bold text-primary-foreground tabular-nums sm:text-2xl">
                  {totalLoaded}
                </p>
                <p className="mt-0.5 text-[0.5rem] font-semibold tracking-wider text-primary-foreground/80 uppercase sm:mt-1 sm:text-[0.65rem]">
                  tools
                </p>
              </div>
            </div>
          </div>

          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base lg:text-lg">
            <span className="sm:hidden">
              Windows, macOS &amp; Linux apps from GitHub — search and open the
              latest release.
            </span>
            <span className="hidden sm:inline">
              A living directory of GitHub projects shipping Windows, macOS, and
              Linux downloads — search, filter, and jump straight to the latest
              release.
            </span>
          </p>
        </header>

        <section className="mb-6 space-y-3 sm:mb-8 sm:space-y-4">
          <div className="flex items-center gap-2.5 rounded-2xl border border-border/70 bg-card/60 px-3 py-1.5 shadow-sm backdrop-blur-sm sm:gap-3 sm:px-4 sm:py-2">
            <MagnifyingGlassIcon className="size-4 shrink-0 text-primary sm:size-5" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, tag, description…"
              className="h-10 border-0 border-transparent px-0 text-base focus-visible:border-transparent focus-visible:ring-0 sm:h-12 md:text-base"
              aria-label="Search releases"
            />
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:grid-cols-4">
              {platformFilters.map((item) => {
                const Icon = PLATFORM_ICONS[item.id]
                const active = platform === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPlatform(item.id)}
                    className={cn(
                      "inline-flex w-full items-center justify-center gap-2 border px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-card/50 text-muted-foreground hover:border-border hover:text-foreground"
                    )}
                  >
                    <Icon
                      className="size-4 shrink-0"
                      weight={active ? "fill" : "regular"}
                    />
                    <span className="truncate">{item.label}</span>
                    <span
                      className={cn(
                        "px-1.5 text-[0.65rem] tabular-nums",
                        active
                          ? "bg-black/15"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {item.count}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 lg:flex lg:w-auto lg:shrink-0 lg:items-center">
              <Select
                value={sort}
                onValueChange={(value) => {
                  if (value) setSort(value as SortKey)
                }}
              >
                <SelectTrigger className="h-11 w-full min-w-0 border border-border/70 bg-card/50 px-4 capitalize lg:w-48">
                  <SelectValue placeholder="Default">{sortLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={language || "all"}
                onValueChange={(value) =>
                  setLanguage(!value || value === "all" ? "" : value)
                }
              >
                <SelectTrigger className="h-11 w-full min-w-0 border border-border/70 bg-card/50 px-4 capitalize lg:w-44">
                  <SelectValue placeholder="All">{languageLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {languages.map((lang) => (
                    <SelectItem key={lang.name} value={lang.name}>
                      {lang.name} ({lang.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-[0.65rem] font-medium tracking-widest text-muted-foreground uppercase sm:text-xs">
            Showing {loadedCount}
            {showing !== loadedCount ? ` / ${showing}` : ""} of {totalLoaded}
            {isFetching && !isLoading && !isFetchingNextPage
              ? " · updating…"
              : ""}
          </p>
        </section>

        {isError ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
            {(error as Error)?.message || "Could not load the release catalog."}
          </div>
        ) : null}

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-2xl sm:h-64" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/40 px-6 py-16 text-center">
            <p className="font-heading text-xl font-semibold">No releases match</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Try another search term or clear the platform filter.
            </p>
            <Button
              className="mt-6 rounded-xl"
              variant="outline"
              onClick={() => {
                setSearch("")
                setPlatform("all")
                setLanguage("")
              }}
            >
              Reset filters
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
              {items.map((repo) => (
                <ReleaseCard key={repo.full_name} repo={repo} />
              ))}
            </div>

            <div ref={loadMoreRef} className="mt-8 flex flex-col items-center gap-3 pb-4">
              {isFetchingNextPage ? (
                <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <SpinnerGapIcon className="size-4 animate-spin" />
                  Loading more…
                </p>
              ) : null}
              {hasNextPage && !isFetchingNextPage ? (
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => void fetchNextPage()}
                >
                  Load more
                </Button>
              ) : null}
              {!hasNextPage && loadedCount > 0 ? (
                <p className="text-xs text-muted-foreground">You’re all caught up</p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}