"use client"

import * as React from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import {
  AndroidLogoIcon,
  AppleLogoIcon,
  DeviceMobileIcon,
  LinuxLogoIcon,
  MagnifyingGlassIcon,
  SpinnerGapIcon,
  SquaresFourIcon,
  WindowsLogoIcon,
  XIcon,
} from "@phosphor-icons/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

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
import { fetchReleaseFilters, fetchReleases, queryKeys } from "@/lib/api-client"
import { useSession } from "@/lib/auth-client"
import { brandCopy } from "@/lib/brand"
import type { Platform, SortKey } from "@/lib/types"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 18

const PLATFORMS = new Set<Platform>([
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
])
const PUBLIC_SORT_KEYS = new Set<SortKey>([
  "score",
  "stars",
  "updated",
  "name",
  "released",
])
const ADMIN_ONLY_SORT: SortKey = "created"

const PLATFORM_ICONS: Record<
  Platform | "all",
  React.ComponentType<{ className?: string; weight?: "fill" | "regular" }>
> = {
  all: SquaresFourIcon,
  windows: WindowsLogoIcon,
  macos: AppleLogoIcon,
  linux: LinuxLogoIcon,
  android: AndroidLogoIcon,
  ios: DeviceMobileIcon,
}

function parsePlatform(value: string | null): Platform | "all" {
  if (value && PLATFORMS.has(value as Platform)) return value as Platform
  return "all"
}

function parseSort(
  value: string | null,
  allowAdminSort: boolean,
  sessionPending: boolean
): SortKey {
  if (value === ADMIN_ONLY_SORT) {
    // Keep URL while session resolves so admins don't flash back to Default.
    if (allowAdminSort || sessionPending) return ADMIN_ONLY_SORT
    return "score"
  }
  if (value && PUBLIC_SORT_KEYS.has(value as SortKey)) return value as SortKey
  return "score"
}

function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

function buildFilterHref(
  pathname: string,
  {
    q,
    platform,
    sort,
    language,
  }: {
    q: string
    platform: Platform | "all"
    sort: SortKey
    language: string
  }
) {
  const params = new URLSearchParams()
  const trimmed = q.trim()
  if (trimmed) params.set("q", trimmed)
  if (platform !== "all") params.set("platform", platform)
  if (sort !== "score") params.set("sort", sort)
  if (language) params.set("language", language)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

const filterTriggerClass =
  "h-11 w-full min-w-0 border border-border/70 bg-card/60 px-4 transition-colors hover:border-border hover:bg-card focus-visible:border-ring"

export function DirectoryPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: session, isPending: sessionPending } = useSession()
  const isAdmin = session?.user?.role === "admin"

  const urlQ = searchParams.get("q") ?? ""
  const platform = parsePlatform(searchParams.get("platform"))
  const sort = parseSort(searchParams.get("sort"), isAdmin, sessionPending)
  const language = searchParams.get("language")?.trim() ?? ""

  const [search, setSearch] = React.useState(urlQ)
  const debouncedSearch = useDebouncedValue(search)
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    setSearch(urlQ)
  }, [urlQ])

  const replaceFilters = React.useCallback(
    (next: {
      q?: string
      platform?: Platform | "all"
      sort?: SortKey
      language?: string
    }) => {
      const href = buildFilterHref(pathname, {
        q: next.q ?? debouncedSearch,
        platform: next.platform ?? platform,
        sort: next.sort ?? sort,
        language: next.language ?? language,
      })
      const current = `${pathname}${
        searchParams.toString() ? `?${searchParams.toString()}` : ""
      }`
      if (href !== current) {
        router.replace(href, { scroll: false })
      }
    },
    [debouncedSearch, language, pathname, platform, router, searchParams, sort]
  )

  React.useEffect(() => {
    // Wait until debounce matches the input so a clear/edit isn't overwritten
    // by a stale debounced value writing the old query back into the URL.
    if (debouncedSearch !== search) return
    if (debouncedSearch.trim() === urlQ.trim()) return
    replaceFilters({ q: debouncedSearch })
  }, [debouncedSearch, replaceFilters, search, urlQ])

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

  const totalLoaded = filters?.repository_count ?? 0
  const platformFilters = filters?.platform_filters ?? [
    { id: "all" as const, label: "All", count: 0 },
    { id: "windows" as const, label: "Windows", count: 0 },
    { id: "macos" as const, label: "macOS", count: 0 },
    { id: "linux" as const, label: "Linux", count: 0 },
    { id: "android" as const, label: "Android", count: 0 },
    { id: "ios" as const, label: "iOS", count: 0 },
  ]
  const sortOptions = React.useMemo(() => {
    const base = filters?.sort_options ?? [
      { value: "score" as const, label: "Default" },
      { value: "stars" as const, label: "Most stars" },
      { value: "released" as const, label: "Newest release" },
      { value: "updated" as const, label: "Recently updated" },
      { value: "name" as const, label: "Name A–Z" },
    ]
    if (!isAdmin) return base.filter((option) => option.value !== "created")
    const hasCreated = base.some((option) => option.value === "created")
    if (hasCreated) return base
    return [
      base[0]!,
      { value: "created" as const, label: "Newest added" },
      ...base.slice(1),
    ]
  }, [filters?.sort_options, isAdmin])

  React.useEffect(() => {
    if (sessionPending) return
    if (!isAdmin && searchParams.get("sort") === "created") {
      replaceFilters({ sort: "score" })
    }
  }, [isAdmin, replaceFilters, searchParams, sessionPending])
  const sortLabel =
    sortOptions.find((option) => option.value === sort)?.label ?? "Default"
  const languageLabel = language || "All"
  const activePlatform =
    platformFilters.find((item) => item.id === platform) ?? platformFilters[0]!
  const ActivePlatformIcon = PLATFORM_ICONS[activePlatform.id]
  const languages = filters?.languages ?? []
  const items = data?.pages.flatMap((page) => page.items) ?? []
  const loadedCount = items.length

  return (
    <div className="relative bg-background">
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

      <div className="relative mx-auto w-full max-w-[1400px] px-4 py-6 pb-10 sm:px-6 sm:py-8 sm:pb-14 lg:px-8 lg:py-12 lg:pb-16">
        <header className="mb-6 space-y-4 sm:mb-8 sm:space-y-5 lg:mb-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-[0.65rem] font-semibold tracking-[0.18em] text-primary uppercase sm:mb-2 sm:text-xs sm:tracking-[0.2em]">
                {brandCopy.hero.eyebrow}
              </p>
              <h1 className="font-heading text-xl leading-snug font-semibold tracking-tight text-balance sm:text-2xl lg:text-3xl">
                {brandCopy.hero.title}
                <span className="text-primary">.</span>
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <AddRepoButton variant="tile" />
            </div>
          </div>

          <p className="max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base lg:text-lg">
            <span className="sm:hidden">
              {brandCopy.hero.descriptionMobile}
            </span>
            <span className="hidden sm:inline">
              {brandCopy.hero.description}
            </span>
          </p>
        </header>

        <section
          aria-label="Search and filters"
          className={cn(
            "sticky top-0 z-10 -mx-4 mb-6 space-y-3 border-b border-transparent px-4 py-3 backdrop-blur-md sm:-mx-6 sm:mb-8 sm:space-y-3 sm:px-6 lg:-mx-8 lg:px-8",
            "bg-background/85 supports-[backdrop-filter]:bg-background/70"
          )}
        >
          <div className="flex items-center gap-2.5 rounded-2xl border border-border/70 bg-card/70 px-3 py-2 shadow-sm ring-1 ring-transparent transition-[box-shadow,ring-color] focus-within:ring-primary/35 sm:gap-3 sm:px-4 sm:py-2.5">
            <MagnifyingGlassIcon className="size-4 shrink-0 text-primary sm:size-5" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={brandCopy.search.placeholder}
              className="h-10 border-0 border-transparent px-0 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 sm:h-11 md:text-base"
              aria-label="Search releases"
            />
            {search ? (
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Clear search"
                onClick={() => {
                  setSearch("")
                  replaceFilters({ q: "" })
                }}
              >
                <XIcon className="size-4" weight="bold" />
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Select
              value={platform}
              onValueChange={(value) => {
                if (value) {
                  replaceFilters({ platform: value as Platform | "all" })
                }
              }}
            >
              <SelectTrigger
                className={filterTriggerClass}
                aria-label="Filter by platform"
              >
                <SelectValue placeholder="Platform">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ActivePlatformIcon
                      className="size-4 shrink-0"
                      weight="fill"
                    />
                    <span className="truncate">{activePlatform.label}</span>
                    <span className="bg-muted px-1.5 text-[0.65rem] text-muted-foreground tabular-nums">
                      {activePlatform.count}
                    </span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" className="min-w-(--anchor-width)">
                {platformFilters.map((item) => {
                  const Icon = PLATFORM_ICONS[item.id]
                  return (
                    <SelectItem key={item.id} value={item.id}>
                      <span className="inline-flex w-full items-center gap-2">
                        <Icon className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="text-[0.65rem] text-muted-foreground tabular-nums">
                          {item.count}
                        </span>
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            <Select
              value={sort}
              onValueChange={(value) => {
                if (value) replaceFilters({ sort: value as SortKey })
              }}
            >
              <SelectTrigger className={cn(filterTriggerClass, "capitalize")}>
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
                replaceFilters({
                  language: !value || value === "all" ? "" : value,
                })
              }
            >
              <SelectTrigger className={cn(filterTriggerClass, "capitalize")}>
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
          <div className="rounded-2xl border border-border/60 bg-card/40 px-6 py-20 text-center">
            <p className="font-heading text-xl font-semibold tracking-tight">
              {brandCopy.empty.title}
            </p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {brandCopy.empty.body}
            </p>
            <Button
              className="mt-8 rounded-xl"
              variant="outline"
              onClick={() => {
                setSearch("")
                replaceFilters({
                  q: "",
                  platform: "all",
                  sort: "score",
                  language: "",
                })
              }}
            >
              {brandCopy.empty.reset}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
              {items.map((repo, index) => (
                <ReleaseCard
                  key={repo.full_name}
                  repo={repo}
                  staggerIndex={index % 12}
                />
              ))}
            </div>

            <div
              ref={loadMoreRef}
              className="mt-10 flex flex-col items-center gap-3 pb-4"
            >
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
                <p className="text-xs text-muted-foreground">
                  {brandCopy.empty.end}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
