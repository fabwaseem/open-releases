/**
 * HTML discovery — uses github.com search pages so we never touch
 * the Search API (30 req/min). Markup can change; treat as best-effort.
 */

const SEARCH = "https://github.com/search"
const UA =
  "Mozilla/5.0 (compatible; github-releases-directory/1.0; +https://github.com)"

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

export type BrowserHit = {
  fullName: string
  url: string
  name: string
  owner: string
}

function headers() {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  }
}

async function fetchHtml(url: string): Promise<string> {
  await sleep(1600)
  let res = await fetch(url, { headers: headers(), redirect: "follow" })
  if (res.status === 403 || res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? "30")
    console.warn(`browser blocked ${res.status}, sleep ${retry}s`)
    await sleep(Math.min(Math.max(retry, 5), 90) * 1000)
    res = await fetch(url, { headers: headers(), redirect: "follow" })
  }
  if (!res.ok) {
    throw new Error(`browser HTTP ${res.status} for ${url}`)
  }
  return res.text()
}

const REPO_HREF = /href="\/([^"/]+)\/([^"/?#]+)(?:["?#])/g
const SKIP_OWNERS = new Set([
  "topics",
  "search",
  "settings",
  "marketplace",
  "orgs",
  "users",
  "login",
  "signup",
  "explore",
  "collections",
  "sponsors",
  "about",
  "pricing",
  "features",
  "enterprise",
  "customer-stories",
  "security",
  "team",
  "codespaces",
  "copilot",
  "pulls",
  "issues",
  "notifications",
  "account",
  "organizations",
  "new",
  "dashboard",
])

function extractRepos(html: string): BrowserHit[] {
  const seen = new Set<string>()
  const out: BrowserHit[] = []
  for (const match of html.matchAll(REPO_HREF)) {
    const owner = match[1]!
    const name = match[2]!
    if (SKIP_OWNERS.has(owner.toLowerCase())) continue
    if (name === "releases" || name === "issues" || name === "pulls") continue
    const fullName = `${owner}/${name}`
    if (seen.has(fullName.toLowerCase())) continue
    seen.add(fullName.toLowerCase())
    out.push({
      fullName,
      owner,
      name,
      url: `https://github.com/${fullName}`,
    })
  }
  return out
}

export async function searchReposHtml(
  query: string,
  page: number
): Promise<BrowserHit[]> {
  const url = new URL(SEARCH)
  url.searchParams.set("q", query)
  url.searchParams.set("type", "repositories")
  url.searchParams.set("s", "stars")
  url.searchParams.set("o", "desc")
  url.searchParams.set("p", String(page))
  const html = await fetchHtml(url.toString())
  return extractRepos(html)
}
