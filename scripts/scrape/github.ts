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

async function handle(res: Response, kind: string) {
  const remaining = res.headers.get("x-ratelimit-remaining")
  const reset = res.headers.get("x-ratelimit-reset")
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    await sleep(2_000 + Math.floor(Math.random() * 2_000))
    throw new RateLimitError(`${kind} HTTP ${res.status} (transient)`)
  }
  if (res.status === 403 || res.status === 429) {
    const text = await res.text()
    if (/rate limit/i.test(text) || res.status === 429) {
      const resetAt = reset ? Number(reset) : undefined
      const wait = resetAt
        ? Math.min(Math.max(resetAt * 1000 - Date.now() + 1000, 1000), 90_000)
        : 15_000
      await sleep(wait)
      throw new RateLimitError(`${kind} rate limited`, resetAt)
    }
    throw new Error(`${kind} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  if (remaining === "0" && reset) {
    const wait = Math.min(Math.max(Number(reset) * 1000 - Date.now() + 500, 500), 60_000)
    if (wait > 500) await sleep(wait)
  }
}

export async function graphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(GQL, {
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

export async function restGet<T = unknown>(
  path: string,
  params?: Record<string, string | number>
): Promise<T | null> {
  const url = new URL(`${REST}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  }
  if (path.startsWith("/search/")) await sleep(2200)
  const res = await fetch(url, { headers: headers() })
  if (res.status === 404) return null
  await handle(res, path.startsWith("/search/") ? "search" : "rest")
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`REST ${res.status}: ${text.slice(0, 300)}`)
  }
  return (await res.json()) as T
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
  const res = await fetch(url, { headers: headers() })
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
  const releases =
    (await restGet<RestRelease[]>(`/repos/${owner}/${name}/releases`, {
      per_page: 20,
    })) ?? []

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