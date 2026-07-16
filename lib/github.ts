import { prisma } from "@/lib/db"
import { getRepoFromCatalog, toCatalogRepo } from "@/lib/catalog"
import {
  summarizePlatforms,
  usableInstallers,
} from "@/lib/platforms"
import type { ReleaseAsset, RepoDetailResponse } from "@/lib/types"

const GITHUB_API = "https://api.github.com"

function githubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-releases-directory",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function mapAssets(assets: unknown[]): ReleaseAsset[] {
  return usableInstallers(
    assets as Array<{
      name?: string
      size?: number
      download_count?: number
      browser_download_url?: string
    }>
  )
}

const README_MAX_CHARS = 350_000

async function fetchReadmeMarkdown(
  owner: string,
  name: string
): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${name}/readme`, {
      headers: {
        ...githubHeaders(),
        Accept: "application/vnd.github.raw",
      },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const text = await res.text()
    if (!text.trim()) return null
    if (text.length > README_MAX_CHARS) {
      return `${text.slice(0, README_MAX_CHARS)}\n\n…`
    }
    return text
  } catch {
    return null
  }
}

/** Make relative README media/links resolve against the repo on GitHub. */
export function rewriteRepoMarkdown(
  markdown: string,
  {
    owner,
    repo,
    branch,
  }: {
    owner: string
    repo: string
    branch: string
  }
): string {
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`
  const resolve = (src: string) => {
    const trimmed = src.trim()
    if (/^(https?:|data:|mailto:|#)/i.test(trimmed)) return trimmed
    return `${rawBase}${trimmed.replace(/^\.?\//, "")}`
  }

  return markdown
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (full, alt: string, src: string) => {
        if (/^(https?:|data:)/i.test(src.trim())) return full
        return `![${alt}](${resolve(src)})`
      }
    )
    .replace(
      /<img\b([^>]*?)\bsrc=(['"])([^'"]+)\2/gi,
      (full, attrs: string, quote: string, src: string) => {
        if (/^(https?:|data:)/i.test(src.trim())) return full
        return `<img${attrs}src=${quote}${resolve(src)}${quote}`
      }
    )
}

async function syncLatestReleaseIfChanged(
  fullName: string,
  release: {
    tag_name?: string
    name?: string | null
    body?: string | null
    published_at?: string | null
    html_url?: string
    prerelease?: boolean
    assets?: unknown[]
  },
  repoFields?: {
    stars?: number
    description?: string | null
    homepage?: string | null
    topics?: string[]
    license?: string | null
    language?: string | null
    pushed_at?: string | null
    avatar_url?: string | null
  }
) {
  const tag = release.tag_name
  if (!tag) return

  const existing = await prisma.repository.findUnique({
    where: { fullName },
    include: { latestRelease: true },
  })
  if (!existing) return

  const desktop = usableInstallers(
    (release.assets ?? []) as Array<{
      name?: string
      size?: number
      download_count?: number
      browser_download_url?: string
    }>
  )
  const summary = summarizePlatforms(desktop)
  const publishedAt = release.published_at
    ? new Date(release.published_at)
    : null

  const tagChanged = existing.latestRelease?.tag !== tag
  // Always refresh when the tag moves — including empty installers so the
  // catalog doesn't keep a stale older release as "latest".
  const shouldUpdateRelease = tagChanged

  await prisma.repository.update({
    where: { id: existing.id },
    data: {
      stars: repoFields?.stars ?? existing.stars,
      description: repoFields?.description ?? existing.description,
      homepage: repoFields?.homepage || existing.homepage,
      topics: repoFields?.topics ?? existing.topics ?? [],
      license: repoFields?.license ?? existing.license,
      language: repoFields?.language ?? existing.language,
      pushedAt: repoFields?.pushed_at
        ? new Date(repoFields.pushed_at)
        : existing.pushedAt,
      avatarUrl: repoFields?.avatar_url ?? existing.avatarUrl,
      releaseCheckedAt: new Date(),
      ...(shouldUpdateRelease
        ? {
            platforms: summary.platforms,
            hasWindows: summary.hasWindows,
            hasMacos: summary.hasMacos,
            hasLinux: summary.hasLinux,
            hasAndroid: summary.hasAndroid,
            hasIos: summary.hasIos,
            latestRelease: {
              upsert: {
                create: {
                  tag,
                  name: release.name ?? null,
                  publishedAt,
                  url: release.html_url ?? null,
                  prerelease: Boolean(release.prerelease),
                  body: release.body ?? null,
                  platforms: summary.platforms,
                  hasWindows: summary.hasWindows,
                  hasMacos: summary.hasMacos,
                  hasLinux: summary.hasLinux,
                  hasAndroid: summary.hasAndroid,
                  hasIos: summary.hasIos,
                  assets: desktop,
                },
                update: {
                  tag,
                  name: release.name ?? null,
                  publishedAt,
                  url: release.html_url ?? null,
                  prerelease: Boolean(release.prerelease),
                  body: release.body ?? null,
                  platforms: summary.platforms,
                  hasWindows: summary.hasWindows,
                  hasMacos: summary.hasMacos,
                  hasLinux: summary.hasLinux,
                  hasAndroid: summary.hasAndroid,
                  hasIos: summary.hasIos,
                  assets: desktop,
                },
              },
            },
          }
        : {}),
    },
  })
}

export async function fetchRepoDetail(
  owner: string,
  name: string
): Promise<RepoDetailResponse | null> {
  const catalog = await getRepoFromCatalog(owner, name)
  if (!catalog) return null

  const fullName = catalog.full_name

  try {
    const [repoRes, releaseRes, readmeMarkdown] = await Promise.all([
      fetch(`${GITHUB_API}/repos/${owner}/${name}`, {
        headers: githubHeaders(),
        next: { revalidate: 300 },
      }),
      fetch(`${GITHUB_API}/repos/${owner}/${name}/releases/latest`, {
        headers: githubHeaders(),
        next: { revalidate: 300 },
      }),
      fetchReadmeMarkdown(owner, name),
    ])

    if (!repoRes.ok) {
      return { catalog, live: null }
    }

    const repo = (await repoRes.json()) as {
      stargazers_count?: number
      forks_count?: number
      subscribers_count?: number
      open_issues_count?: number
      description?: string | null
      homepage?: string | null
      topics?: string[]
      license?: { spdx_id?: string; name?: string } | null
      language?: string | null
      pushed_at?: string | null
      created_at?: string | null
      default_branch?: string | null
      html_url?: string
      owner?: { avatar_url?: string | null }
    }

    type LiveRelease = NonNullable<
      NonNullable<RepoDetailResponse["live"]>["latest_release"]
    >
    let latest: LiveRelease | null = null

    if (releaseRes.ok) {
      const release = (await releaseRes.json()) as {
        tag_name?: string
        name?: string | null
        body?: string | null
        published_at?: string | null
        html_url?: string
        prerelease?: boolean
        assets?: unknown[]
      }
      latest = {
        tag: release.tag_name ?? catalog.latest_release.tag,
        name: release.name ?? null,
        body: release.body ?? null,
        published_at: release.published_at ?? null,
        html_url: release.html_url ?? catalog.latest_release.url ?? catalog.url,
        prerelease: Boolean(release.prerelease),
        assets: mapAssets(release.assets ?? []),
      }

      await syncLatestReleaseIfChanged(fullName, release, {
        stars: repo.stargazers_count,
        description: repo.description,
        homepage: repo.homepage,
        topics: repo.topics,
        license: repo.license?.spdx_id || repo.license?.name || null,
        language: repo.language,
        pushed_at: repo.pushed_at,
        avatar_url: repo.owner?.avatar_url,
      })
    } else {
      await prisma.repository.update({
        where: { fullName },
        data: {
          stars: repo.stargazers_count ?? catalog.stars,
          description: repo.description ?? catalog.description,
          homepage: repo.homepage || catalog.homepage,
          topics: repo.topics?.length ? repo.topics : catalog.topics,
          language: repo.language ?? catalog.language,
          pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : undefined,
          releaseCheckedAt: new Date(),
        },
      })
    }

    const refreshed = await prisma.repository.findUnique({
      where: { fullName },
      include: { latestRelease: true },
    })
    const catalogFresh =
      (refreshed && toCatalogRepo(refreshed)) || catalog

    const branch = repo.default_branch || "main"
    const readme = readmeMarkdown
      ? rewriteRepoMarkdown(readmeMarkdown, {
          owner,
          repo: name,
          branch,
        })
      : null

    return {
      catalog: catalogFresh,
      live: {
        fetched_at: new Date().toISOString(),
        stars: repo.stargazers_count ?? catalogFresh.stars,
        forks: repo.forks_count ?? 0,
        watchers: repo.subscribers_count ?? 0,
        open_issues: repo.open_issues_count ?? 0,
        description: repo.description ?? catalogFresh.description,
        homepage: repo.homepage || catalogFresh.homepage,
        topics: repo.topics?.length ? repo.topics : catalogFresh.topics,
        license:
          repo.license?.spdx_id ||
          repo.license?.name ||
          catalogFresh.license,
        language: repo.language ?? catalogFresh.language,
        pushed_at: repo.pushed_at ?? catalogFresh.pushed_at,
        created_at: repo.created_at ?? null,
        default_branch: repo.default_branch ?? null,
        html_url: repo.html_url ?? catalogFresh.url,
        latest_release: latest,
        readme,
      },
    }
  } catch {
    return { catalog, live: null }
  }
}
