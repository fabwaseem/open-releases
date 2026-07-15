export type Platform = "windows" | "macos" | "linux"

export type SortKey = "score" | "stars" | "updated" | "name" | "released"

export type ReleaseAsset = {
  name: string
  platform: Platform | string
  size: number | null
  download_count: number | null
  url: string
}

export type LatestRelease = {
  tag: string
  name: string | null
  published_at: string | null
  url: string | null
  prerelease: boolean
  assets: ReleaseAsset[]
  platforms: Platform[]
  has_windows: boolean
  has_macos: boolean
  has_linux: boolean
}

export type CatalogRepo = {
  id: string
  full_name: string
  name: string
  owner: string
  description: string | null
  url: string
  homepage: string | null
  stars: number
  language: string | null
  topics: string[]
  license: string | null
  avatar_url: string | null
  pushed_at: string | null
  releases_count: number | null
  platforms: Platform[]
  has_windows: boolean
  has_macos: boolean
  has_linux: boolean
  /** Weighted activity score 0–100. */
  activity_score: number
  /** Admin-featured; pinned on default directory sort. */
  featured: boolean
  latest_release: LatestRelease
  scraped_at?: string
}

/** Paginated catalog page — items + pagination meta only. */
export type ReleasesListResponse = {
  total: number
  count: number
  page: number
  pageSize: number
  totalPages: number
  items: CatalogRepo[]
}

export type SortOption = {
  value: SortKey
  label: string
}

export type PlatformFilterOption = {
  id: Platform | "all"
  label: string
  count: number
}

/** Filters, sort options, and catalog-wide counts. */
export type ReleasesFiltersResponse = {
  repository_count: number
  platforms: Record<Platform, number>
  platform_filters: PlatformFilterOption[]
  languages: { name: string; count: number }[]
  sort_options: SortOption[]
}

export type RepoDetailResponse = {
  catalog: CatalogRepo
  live: {
    fetched_at: string
    stars: number
    forks: number
    watchers: number
    open_issues: number
    description: string | null
    homepage: string | null
    topics: string[]
    license: string | null
    language: string | null
    pushed_at: string | null
    created_at: string | null
    default_branch: string | null
    html_url: string
    latest_release: {
      tag: string
      name: string | null
      body: string | null
      published_at: string | null
      html_url: string
      prerelease: boolean
      assets: ReleaseAsset[]
    } | null
  } | null
}
