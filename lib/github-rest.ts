const REST = "https://api.github.com"

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
  constructor(message: string, status: number) {
    super(message)
    this.name = "GitHubApiError"
    this.status = status
  }
}

async function restGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`${REST}${path}`, {
    headers: headers(),
    next: { revalidate: 0 },
  })
  if (res.status === 404) return null
  if (res.status === 403 || res.status === 429) {
    throw new GitHubApiError(
      "GitHub rate limit reached. Try again in a few minutes.",
      res.status
    )
  }
  if (!res.ok) {
    const text = await res.text()
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
  const res = await fetch(url, { headers: headers() })
  if (res.status === 204 || res.status === 404) return 0
  if (!res.ok) return 0
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
  } catch {
    // Preview/approve still works without activity extras.
  }
  return {
    recentCommits,
    contributorsCount,
    openIssues: repo.open_issues_count ?? 0,
    createdAt: repo.created_at ? new Date(repo.created_at) : null,
  }
}
