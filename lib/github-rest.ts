const REST = "https://api.github.com"

export const DEFAULT_TIMEOUT_MS = 15_000

/** Backoff before each retry (plus jitter). 2 retries → 3 attempts total. */
const RETRY_DELAYS_MS = [600, 1500]
const RETRYABLE_STATUSES = new Set([502, 503, 504])

function headers() {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-releases-directory",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

export type GhRepo = {
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
  private?: boolean
  license?: { spdx_id?: string | null; name?: string | null } | null
  owner?: { login?: string; avatar_url?: string | null } | null
}

export type GhRelease = {
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

export class GitHubApiError extends Error {
  status: number
  /** Seconds to wait before retrying, from the `retry-after` header. */
  retryAfterSec?: number
  /** When the rate-limit window resets, from `x-ratelimit-reset`. */
  resetAt?: Date
  /** True only when GitHub actually rate-limited us (see isRateLimitResponse). */
  rateLimited: boolean
  constructor(
    message: string,
    status: number,
    options?: {
      retryAfterSec?: number
      resetAt?: Date
      rateLimited?: boolean
    }
  ) {
    super(message)
    this.name = "GitHubApiError"
    this.status = status
    this.retryAfterSec = options?.retryAfterSec
    this.resetAt = options?.resetAt
    this.rateLimited = options?.rateLimited ?? status === 429
  }
}

/**
 * Only 429 is always a rate limit. A 403 is one only when GitHub says the
 * quota is exhausted (`x-ratelimit-remaining: 0`) or the body says so —
 * plain 403s (abuse detection aside, e.g. forbidden/private resources)
 * must not be mislabelled.
 */
function isRateLimitResponse(res: Response, bodyText: string): boolean {
  if (res.status === 429) return true
  if (res.status !== 403) return false
  if (res.headers.get("x-ratelimit-remaining") === "0") return true
  return /rate limit/i.test(bodyText)
}

function rateLimitDetails(res: Response): {
  retryAfterSec?: number
  resetAt?: Date
} {
  const details: { retryAfterSec?: number; resetAt?: Date } = {}
  const retryAfter = Number(res.headers.get("retry-after"))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    details.retryAfterSec = retryAfter
  }
  const reset = Number(res.headers.get("x-ratelimit-reset"))
  if (Number.isFinite(reset) && reset > 0) {
    details.resetAt = new Date(reset * 1000)
  }
  return details
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffMs(attempt: number) {
  return RETRY_DELAYS_MS[attempt]! + Math.floor(Math.random() * 250)
}

type FetchOptions = RequestInit & { next?: { revalidate?: number } }

/**
 * fetch with a hard timeout, retrying transport errors (incl. timeouts)
 * and transient 502/503/504 responses. Other statuses are returned to the
 * caller immediately — 4xx responses are never retried.
 */
async function fetchWithRetry(
  url: string | URL,
  init: FetchOptions = {}
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      })
      if (
        RETRYABLE_STATUSES.has(res.status) &&
        attempt < RETRY_DELAYS_MS.length
      ) {
        await sleep(backoffMs(attempt))
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt >= RETRY_DELAYS_MS.length) throw err
      await sleep(backoffMs(attempt))
    }
  }
  throw lastError
}

async function restGet<T>(path: string): Promise<T | null> {
  const res = await fetchWithRetry(`${REST}${path}`, {
    headers: headers(),
    next: { revalidate: 0 },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    if (isRateLimitResponse(res, text)) {
      throw new GitHubApiError(
        "GitHub rate limit reached. Try again in a few minutes.",
        res.status,
        { rateLimited: true, ...rateLimitDetails(res) }
      )
    }
    throw new GitHubApiError(
      `GitHub API error (${res.status}): ${text.slice(0, 180)}`,
      res.status
    )
  }
  return (await res.json()) as T
}

export async function fetchRepo(owner: string, name: string) {
  return restGet<GhRepo>(`/repos/${owner}/${name}`)
}

export async function fetchReleases(owner: string, name: string) {
  return (
    (await restGet<GhRelease[]>(
      `/repos/${owner}/${name}/releases?per_page=20`
    )) ?? []
  )
}

async function countContributors(owner: string, name: string) {
  const url = new URL(`${REST}/repos/${owner}/${name}/contributors`)
  url.searchParams.set("per_page", "1")
  url.searchParams.set("anon", "true")
  const res = await fetchWithRetry(url, { headers: headers() })
  if (res.status === 204 || res.status === 404) return 0
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    // Never silently record 0 contributors for a rate-limited repo —
    // callers must see the failure and retry later instead.
    if (isRateLimitResponse(res, text)) {
      throw new GitHubApiError(
        "GitHub rate limit reached. Try again in a few minutes.",
        res.status,
        { rateLimited: true, ...rateLimitDetails(res) }
      )
    }
    return 0
  }
  const link = res.headers.get("link") ?? ""
  const last = link.match(/[?&]page=(\d+)>;\s*rel="last"/)
  if (last) return Number(last[1])
  const body = (await res.json()) as unknown[]
  return Array.isArray(body) ? body.length : 0
}

async function countRecentCommits(owner: string, name: string) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const commits = await restGet<unknown[]>(
    `/repos/${owner}/${name}/commits?since=${encodeURIComponent(since)}&per_page=100`
  )
  return Array.isArray(commits) ? commits.length : 0
}

export async function fetchActivitySignals(owner: string, name: string, repo: GhRepo) {
  let recentCommits = 0
  let contributorsCount = 0
  try {
    ;[recentCommits, contributorsCount] = await Promise.all([
      countRecentCommits(owner, name),
      countContributors(owner, name),
    ])
  } catch (err) {
    // Rate limits must surface: swallowing them here would record a
    // rate-limited repo as having 0 commits / 0 contributors.
    if (err instanceof GitHubApiError && err.rateLimited) {
      throw err
    }
    // Preview/approve still works without activity extras.
  }
  return {
    recentCommits,
    contributorsCount,
    openIssues: repo.open_issues_count ?? 0,
    createdAt: repo.created_at ? new Date(repo.created_at) : null,
  }
}
