import "dotenv/config"

const REST = "https://api.github.com"
const GQL = "https://api.github.com/graphql"

export class RateLimitError extends Error {
  resetAt?: number
  constructor(message: string, resetAt?: number) {
    super(message)
    this.name = "RateLimitError"
    this.resetAt = resetAt
  }
}

function headers() {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-releases-directory-scraper",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

function jitterMs(): number {
  return Math.floor(Math.random() * 501)
}

/**
 * Fetch with a hard timeout. Transport errors (network failure /
 * abort / timeout) and 502/503/504 responses are retried up to 2
 * extra times with backoff 1s / 3s + jitter ≤500ms.
 *
 * The retry loop only wraps the transport call itself: the final
 * response is returned unconsumed so `handle()` stays the single
 * place that classifies rate limits and transient statuses.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  const backoffs = [1_000, 3_000]
  let lastError: unknown
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (
        (res.status === 502 || res.status === 503 || res.status === 504) &&
        attempt < 2
      ) {
        // Discard without reading the body so the retry is clean.
        try {
          await res.body?.cancel()
        } catch {
          // ignore — body may already be closed
        }
        await sleep(backoffs[attempt]! + jitterMs())
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt < 2) {
        await sleep(backoffs[attempt]! + jitterMs())
        continue
      }
      throw err
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("fetchWithTimeout: exhausted retries")
}

async function handle(res: Response, kind: string) {
  const remaining = res.headers.get("x-ratelimit-remaining")
  const reset = res.headers.get("x-ratelimit-reset")
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new RateLimitError(`${kind} HTTP ${res.status} (transient)`)
  }
  if (res.status === 403 || res.status === 429) {
    const text = await res.text()
    if (/rate limit/i.test(text) || res.status === 429) {
      const retryAfterRaw = res.headers.get("retry-after")
      const retryAfterSec =
        retryAfterRaw != null && retryAfterRaw.trim() !== ""
          ? Number(retryAfterRaw)
          : NaN
      const resetAt =
        Number.isFinite(retryAfterSec) && retryAfterSec >= 0
          ? Math.floor(Date.now() / 1000) + retryAfterSec
          : reset
            ? Number(reset)
            : undefined
      // Caller waits until reset and retries — don't sleep here.
      throw new RateLimitError(`${kind} rate limited`, resetAt)
    }
    throw new Error(`${kind} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  if (remaining === "0" && reset) {
    const wait = Math.min(
      Math.max(Number(reset) * 1000 - Date.now() + 500, 500),
      3_600_000
    )
    if (wait > 500) await sleep(wait)
  }
}

export async function graphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetchWithTimeout(GQL, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  await handle(res, "graphql")
  const text = await res.text()
  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("json") || text.trimStart().startsWith("<")) {
    if (/rate limit|abuse/i.test(text)) {
      throw new RateLimitError("graphql returned HTML (rate limited)")
    }
    throw new Error(
      `graphql non-JSON HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, " ")}`
    )
  }
  const payload = JSON.parse(text) as {
    data?: T
    errors?: Array<{ message: string }>
  }
  if (payload.errors?.length) {
    const msg = payload.errors.map((e) => e.message).join("; ")
    if (/rate limit/i.test(msg)) throw new RateLimitError(msg)
    if (!payload.data) throw new Error(`GraphQL: ${msg}`)
  }
  if (!payload.data) throw new Error("GraphQL returned no data")
  return payload.data
}

export type RestGetOpts = {
  timeoutMs?: number
  headers?: Record<string, string>
  etag?: string | null
}

export async function restGet<T = unknown>(
  path: string,
  params?: Record<string, string | number>,
  opts?: { timeoutMs?: number; headers?: Record<string, string> }
): Promise<T | null> {
  const url = new URL(`${REST}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  }
  if (path.startsWith("/search/")) await sleep(2200)
  const res = await fetchWithTimeout(
    url,
    { headers: { ...headers(), ...(opts?.headers ?? {}) } },
    opts?.timeoutMs
  )
  if (res.status === 404) return null
  await handle(res, path.startsWith("/search/") ? "search" : "rest")
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`REST ${res.status}: ${text.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

export async function restGetWithMeta<T = unknown>(
  path: string,
  params?: Record<string, string | number>,
  opts?: RestGetOpts
): Promise<{ data: T | null; etag: string | null; notModified: boolean }> {
  const url = new URL(`${REST}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  }
  if (path.startsWith("/search/")) await sleep(2200)
  const reqHeaders: Record<string, string> = {
    ...headers(),
    ...(opts?.headers ?? {}),
  }
  if (opts?.etag) reqHeaders["If-None-Match"] = opts.etag
  const res = await fetchWithTimeout(
    url,
    { headers: reqHeaders },
    opts?.timeoutMs
  )
  // 304 short-circuits before handle(): it is not an error and must
  // not trigger handle()'s remaining=0 sleep even though GitHub
  // still sends rate-limit headers on 304 responses.
  if (res.status === 304) {
    return {
      data: null,
      etag: res.headers.get("etag") ?? opts?.etag ?? null,
      notModified: true,
    }
  }
  if (res.status === 404) {
    return { data: null, etag: res.headers.get("etag"), notModified: false }
  }
  await handle(res, path.startsWith("/search/") ? "search" : "rest")
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`REST ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as T
  return { data, etag: res.headers.get("etag"), notModified: false }
}

export type RestRepo = {
  full_name: string
  name: string
  description?: string | null
  html_url: string
  homepage?: string | null
  stargazers_count?: number
  open_issues_count?: number
  created_at?: string | null
  pushed_at?: string | null
  language?: string | null
  topics?: string[]
  license?: { spdx_id?: string | null; name?: string | null } | null
  owner?: { login?: string; avatar_url?: string | null } | null
}

export type ActivitySignals = {
  recentCommits: number
  contributorsCount: number
  openIssues: number
  createdAt: Date | null
}

export type RestRelease = {
  id?: number
  tag_name?: string
  name?: string | null
  html_url?: string
  published_at?: string | null
  prerelease?: boolean
  draft?: boolean
  body?: string | null
  assets?: Array<{
    name?: string
    size?: number
    download_count?: number
    browser_download_url?: string
  }>
}

async function countContributors(owner: string, name: string): Promise<number> {
  await sleep(150)
  const url = new URL(`${REST}/repos/${owner}/${name}/contributors`)
  url.searchParams.set("per_page", "1")
  url.searchParams.set("anon", "true")
  const res = await fetchWithTimeout(url, { headers: headers() })
  if (res.status === 204 || res.status === 404) return 0
  await handle(res, "rest")
  if (!res.ok) return 0
  const link = res.headers.get("link") ?? ""
  const last = link.match(/[?&]page=(\d+)>;\s*rel="last"/)
  if (last) return Number(last[1])
  const body = (await res.json()) as unknown[]
  return Array.isArray(body) ? body.length : 0
}

async function countRecentCommits(owner: string, name: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  await sleep(150)
  const commits = await restGet<unknown[]>(`/repos/${owner}/${name}/commits`, {
    since,
    per_page: 100,
  })
  return Array.isArray(commits) ? commits.length : 0
}

/** Core REST — 5k/hour authenticated (not Search's 30/min). */
export async function fetchRepoAndReleases(fullName: string): Promise<{
  repo: RestRepo
  releases: RestRelease[]
  activity: ActivitySignals
} | null> {
  const [owner, name] = fullName.split("/")
  if (!owner || !name) return null
  await sleep(200)
  const repo = await restGet<RestRepo>(`/repos/${owner}/${name}`)
  if (!repo) return null
  await sleep(200)
  // Extra releases for release-frequency scoring + desktop picker.
  // Paginate: per_page=100, up to 5 pages, stop on a short page.
  const releases: RestRelease[] = []
  for (let page = 1; page <= 5; page++) {
    const batch =
      (await restGet<RestRelease[]>(`/repos/${owner}/${name}/releases`, {
        per_page: 100,
        page,
      })) ?? []
    releases.push(...batch)
    if (batch.length < 100) break
    if (page < 5) await sleep(200)
  }

  let recentCommits = 0
  let contributorsCount = 0
  try {
    recentCommits = await countRecentCommits(owner, name)
    contributorsCount = await countContributors(owner, name)
  } catch (err) {
    if (err instanceof RateLimitError) throw err
    console.warn(`activity signals failed for ${fullName}:`, err)
  }

  return {
    repo,
    releases,
    activity: {
      recentCommits,
      contributorsCount,
      openIssues: repo.open_issues_count ?? 0,
      createdAt: repo.created_at ? new Date(repo.created_at) : null,
    },
  }
}

export type LatestReleaseInfo = {
  githubId: string
  tag: string
  publishedAt: string | null
}

/** First non-draft entry (the releases list is newest-first). */
export function latestNonDraft(
  releases: Array<{
    id?: number
    tag_name?: string
    published_at?: string | null
    draft?: boolean
  }>
): LatestReleaseInfo | null {
  for (const release of releases) {
    if (release.draft) continue
    return {
      githubId: release.id != null ? String(release.id) : "",
      tag: release.tag_name ?? "",
      publishedAt: release.published_at ?? null,
    }
  }
  return null
}

export type LatestReleaseCheck =
  | { status: "unchanged"; etag: string | null }
  | { status: "gone" }
  | { status: "empty"; etag: string | null }
  | { status: "changed"; latest: LatestReleaseInfo; etag: string | null }

/**
 * Cheap release-watch probe: one conditional request for the 3
 * newest releases. Compares the ETag / latest release id against
 * what the catalog already knows — no full enrichment needed when
 * nothing changed.
 */
export async function checkLatestRelease(
  fullName: string,
  known: { githubId: string | null; etag: string | null }
): Promise<LatestReleaseCheck> {
  const [owner, name] = fullName.split("/")
  if (!owner || !name) return { status: "gone" }
  const { data, etag, notModified } =
    await restGetWithMeta<RestRelease[]>(
      `/repos/${owner}/${name}/releases`,
      { per_page: 3 },
      { etag: known.etag }
    )
  if (notModified) return { status: "unchanged", etag }
  if (data === null) return { status: "gone" }
  const latest = latestNonDraft(data)
  if (!latest) return { status: "empty", etag }
  if (known.githubId && latest.githubId === known.githubId) {
    return { status: "unchanged", etag }
  }
  return { status: "changed", latest, etag }
}

export type SearchHit = {
  fullName: string
  owner: string
  name: string
  url: string
}

/**
 * Authenticated repo discovery via REST Search API (30 req/min).
 * Same rate pool as GraphQL `search` — prefer this over HTML scraping.
 * Max 1000 results per query (page * per_page ≤ 1000).
 */
export async function searchReposApi(
  query: string,
  page: number
): Promise<{ hits: SearchHit[]; totalCount: number }> {
  type SearchResponse = {
    total_count?: number
    items?: Array<{
      full_name?: string
      name?: string
      html_url?: string
      owner?: { login?: string }
    }>
  }

  const data = await restGet<SearchResponse>("/search/repositories", {
    q: query,
    sort: "stars",
    order: "desc",
    per_page: 100,
    page,
  })

  const items = data?.items ?? []
  const hits: SearchHit[] = []
  for (const item of items) {
    const fullName = item.full_name
    if (!fullName || !fullName.includes("/")) continue
    const [owner, name] = fullName.split("/")
    if (!owner || !name) continue
    hits.push({
      fullName,
      owner,
      name,
      url: item.html_url ?? `https://github.com/${fullName}`,
    })
  }

  return {
    hits,
    totalCount: data?.total_count ?? hits.length,
  }
}

export function hasGithubToken() {
  return Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
}