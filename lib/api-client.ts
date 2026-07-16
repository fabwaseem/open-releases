import type {
  Platform,
  ReleasesFiltersResponse,
  ReleasesListResponse,
  RepoDetailResponse,
  SortDir,
  SortKey,
} from "@/lib/types"

export type ListParams = {
  q?: string
  platform?: Platform | "all"
  sort?: SortKey
  dir?: SortDir
  language?: string
  page?: number
  pageSize?: number
}

function toQuery(params: ListParams): string {
  const sp = new URLSearchParams()
  if (params.q) sp.set("q", params.q)
  if (params.platform && params.platform !== "all")
    sp.set("platform", params.platform)
  if (params.sort) sp.set("sort", params.sort)
  if (params.dir) sp.set("dir", params.dir)
  if (params.language) sp.set("language", params.language)
  if (params.page) sp.set("page", String(params.page))
  if (params.pageSize) sp.set("pageSize", String(params.pageSize))
  const qs = sp.toString()
  return qs ? `?${qs}` : ""
}

export async function fetchReleases(
  params: ListParams
): Promise<ReleasesListResponse> {
  const res = await fetch(`/api/releases${toQuery(params)}`)
  if (!res.ok) {
    throw new Error(`Failed to load releases (${res.status})`)
  }
  return res.json()
}

export async function fetchReleaseFilters(): Promise<ReleasesFiltersResponse> {
  const res = await fetch("/api/releases/filters")
  if (!res.ok) {
    throw new Error(`Failed to load filters (${res.status})`)
  }
  return res.json()
}

export async function fetchSurpriseRepo(
  platform?: Platform | null
): Promise<{ full_name: string; owner: string; name: string }> {
  const sp = new URLSearchParams()
  if (platform) sp.set("platform", platform)
  const qs = sp.toString()
  const res = await fetch(`/api/releases/surprise${qs ? `?${qs}` : ""}`)
  if (!res.ok) {
    throw new Error(`Failed to pick a surprise repo (${res.status})`)
  }
  const data = (await res.json()) as {
    repo: { full_name: string; owner: string; name: string }
  }
  return data.repo
}

export async function fetchRepoDetail(
  owner: string,
  name: string
): Promise<RepoDetailResponse> {
  const res = await fetch(
    `/api/releases/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  )
  if (!res.ok) {
    throw new Error(`Failed to load repository (${res.status})`)
  }
  return res.json()
}

export type InfiniteListParams = Omit<ListParams, "page">

export const queryKeys = {
  releases: (params: ListParams) => ["releases", params] as const,
  releasesInfinite: (params: InfiniteListParams) =>
    ["releases-infinite", params] as const,
  releaseFilters: ["release-filters"] as const,
  repo: (owner: string, name: string) => ["repo", owner, name] as const,
}
