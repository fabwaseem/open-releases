import { prisma } from "@/lib/db"
import type {
  CatalogRepo,
  LatestRelease,
  Platform,
  ReleaseAsset,
  ReleasesFiltersResponse,
  ReleasesListResponse,
  SortKey,
} from "@/lib/types"
import type { Prisma } from "@/generated/prisma/client"

export type ListQuery = {
  q?: string
  platform?: Platform | "all"
  sort?: SortKey
  language?: string
  page?: number
  pageSize?: number
}

type RepoWithRelease = Prisma.RepositoryGetPayload<{
  include: { latestRelease: true }
}>

const SORT_OPTIONS = [
  { value: "score" as const, label: "Default" },
  { value: "stars" as const, label: "Most stars" },
  { value: "released" as const, label: "Newest release" },
  { value: "updated" as const, label: "Recently updated" },
  { value: "name" as const, label: "Name A–Z" },
]

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string")
}

function asPlatforms(value: unknown): Platform[] {
  return asStringArray(value).filter(
    (p): p is Platform => p === "windows" || p === "macos" || p === "linux"
  )
}

function asAssets(value: unknown): ReleaseAsset[] {
  if (!Array.isArray(value)) return []
  const out: ReleaseAsset[] = []
  for (const raw of value) {
    const a = raw as Partial<ReleaseAsset>
    if (!a?.name || !a?.url) continue
    out.push({
      name: a.name,
      platform: a.platform ?? "windows",
      size: a.size ?? null,
      download_count: a.download_count ?? null,
      url: a.url,
    })
  }
  return out
}

function toLatestRelease(
  release: NonNullable<RepoWithRelease["latestRelease"]>
): LatestRelease {
  const platforms = asPlatforms(release.platforms)
  return {
    tag: release.tag,
    name: release.name,
    published_at: release.publishedAt?.toISOString() ?? null,
    url: release.url,
    prerelease: release.prerelease,
    assets: asAssets(release.assets),
    platforms,
    has_windows: release.hasWindows,
    has_macos: release.hasMacos,
    has_linux: release.hasLinux,
  }
}

export function toCatalogRepo(repo: RepoWithRelease): CatalogRepo | null {
  if (!repo.latestRelease) return null
  return {
    id: repo.id,
    full_name: repo.fullName,
    name: repo.name,
    owner: repo.owner,
    description: repo.description,
    url: repo.url,
    homepage: repo.homepage,
    stars: repo.stars,
    language: repo.language,
    topics: asStringArray(repo.topics),
    license: repo.license,
    avatar_url: repo.avatarUrl,
    pushed_at: repo.pushedAt?.toISOString() ?? null,
    releases_count: repo.releasesCount,
    platforms: asPlatforms(repo.platforms),
    has_windows: repo.hasWindows,
    has_macos: repo.hasMacos,
    has_linux: repo.hasLinux,
    activity_score: repo.activityScore ?? 0,
    featured: Boolean(repo.featured),
    latest_release: toLatestRelease(repo.latestRelease),
    scraped_at: repo.scrapedAt.toISOString(),
  }
}

export async function getRepoFromCatalog(
  owner: string,
  name: string
): Promise<CatalogRepo | null> {
  const fullName = `${owner}/${name}`
  const repo = await prisma.repository.findFirst({
    where: {
      fullName: { equals: fullName, mode: "insensitive" },
      hidden: false,
    },
    include: { latestRelease: true },
  })
  if (!repo) return null
  return toCatalogRepo(repo)
}

function buildWhere(params: ListQuery): Prisma.RepositoryWhereInput {
  const platform = params.platform ?? "all"
  const q = (params.q ?? "").trim()
  const language = (params.language ?? "").trim()

  const where: Prisma.RepositoryWhereInput = {
    hidden: false,
    latestRelease: { isNot: null },
  }

  if (platform === "windows") where.hasWindows = true
  else if (platform === "macos") where.hasMacos = true
  else if (platform === "linux") where.hasLinux = true

  if (language) {
    where.language = { equals: language, mode: "insensitive" }
  }

  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { owner: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { language: { contains: q, mode: "insensitive" } },
    ]
  }

  return where
}

function buildOrderBy(
  sort: SortKey
): Prisma.RepositoryOrderByWithRelationInput[] {
  // Default sort pins featured repos first; filters still apply via `where`.
  // Explicit sorts follow the user's choice without forcing featured to the top.
  switch (sort) {
    case "name":
      return [{ name: "asc" }]
    case "updated":
      return [{ pushedAt: "desc" }, { stars: "desc" }]
    case "released":
      return [
        { latestRelease: { publishedAt: "desc" } },
        { stars: "desc" },
      ]
    case "stars":
      return [{ stars: "desc" }, { name: "asc" }]
    case "score":
    default:
      return [
        { featured: "desc" },
        { featuredAt: "desc" },
        { activityScore: "desc" },
        { stars: "desc" },
      ]
  }
}

/** Filter/sort options and catalog-wide counts (no repo rows). */
export async function getCatalogFilters(): Promise<ReleasesFiltersResponse> {
  const baseWhere: Prisma.RepositoryWhereInput = {
    hidden: false,
    latestRelease: { isNot: null },
  }

  const [repository_count, windows, macos, linux, languageGroups] =
    await Promise.all([
      prisma.repository.count({ where: baseWhere }),
      prisma.repository.count({
        where: { ...baseWhere, hasWindows: true },
      }),
      prisma.repository.count({
        where: { ...baseWhere, hasMacos: true },
      }),
      prisma.repository.count({
        where: { ...baseWhere, hasLinux: true },
      }),
      prisma.repository.groupBy({
        by: ["language"],
        where: { ...baseWhere, language: { not: null } },
        _count: { language: true },
        orderBy: { _count: { language: "desc" } },
        take: 40,
      }),
    ])

  const platforms = { windows, macos, linux }

  return {
    repository_count,
    platforms,
    platform_filters: [
      { id: "all", label: "All", count: repository_count },
      { id: "windows", label: "Windows", count: windows },
      { id: "macos", label: "macOS", count: macos },
      { id: "linux", label: "Linux", count: linux },
    ],
    languages: languageGroups
      .filter((g) => g.language)
      .map((g) => ({
        name: g.language!,
        count: g._count.language,
      })),
    sort_options: SORT_OPTIONS,
  }
}

/** Paginated repos + pagination meta only. */
export async function queryCatalog(
  params: ListQuery
): Promise<ReleasesListResponse> {
  const sort = params.sort ?? "score"
  const pageSize = Math.min(Math.max(params.pageSize ?? 24, 1), 100)
  const page = Math.max(params.page ?? 1, 1)
  const where = buildWhere(params)

  const total = await prisma.repository.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)

  const rows = await prisma.repository.findMany({
    where,
    include: { latestRelease: true },
    orderBy: buildOrderBy(sort),
    skip: (safePage - 1) * pageSize,
    take: pageSize,
  })

  const items = rows
    .map(toCatalogRepo)
    .filter((r): r is CatalogRepo => r != null)

  return {
    total,
    count: items.length,
    page: safePage,
    pageSize,
    totalPages,
    items,
  }
}
