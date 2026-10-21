import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../../generated/prisma/client.js"
import {
  buildRepositoryScoreFields,
} from "../../lib/score.js"
import {
  summarizePlatforms,
  usableInstallers,
  SKIPPED_NO_ASSETS_REASON,
  SKIPPED_NO_ASSETS_STATUS,
  type DesktopAsset,
} from "./platforms.js"
import type { ActivitySignals } from "./github.js"
import {
  evaluateNonApp,
  SKIPPED_NON_APP_REASON,
  SKIPPED_NON_APP_STATUS,
} from "../../lib/non-app.js"

const globalForPrisma = globalThis as unknown as { scrapePrisma?: PrismaClient }

function getPrisma() {
  if (!globalForPrisma.scrapePrisma) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set")
    }
    globalForPrisma.scrapePrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    })
  }
  return globalForPrisma.scrapePrisma
}

export const prisma = getPrisma()

export type GqlRelease = {
  name?: string | null
  tagName?: string | null
  url?: string | null
  publishedAt?: string | null
  isPrerelease?: boolean
  isDraft?: boolean
  description?: string | null
  releaseAssets?: {
    nodes?: Array<{
      name?: string
      size?: number
      downloadCount?: number
      downloadUrl?: string
    }>
  }
}

export type GqlRepo = {
  nameWithOwner: string
  name: string
  description?: string | null
  url: string
  homepageUrl?: string | null
  stargazerCount?: number
  pushedAt?: string | null
  primaryLanguage?: { name?: string | null } | null
  repositoryTopics?: {
    nodes?: Array<{ topic?: { name?: string | null } | null } | null>
  } | null
  licenseInfo?: { spdxId?: string | null; name?: string | null } | null
  owner?: { login?: string; avatarUrl?: string | null } | null
  releases?: {
    totalCount?: number
    nodes?: GqlRelease[]
  }
}

function pickLatest(releases: GqlRelease[]) {
  const usable = releases
    .filter((r) => !r.isDraft)
    .map((r) => {
      const assets = usableInstallers(r.releaseAssets?.nodes ?? [])
      return { release: r, assets }
    })
    .filter((x) => x.assets.length > 0)
    .sort((a, b) =>
      Date.parse(b.release.publishedAt ?? "") -
      Date.parse(a.release.publishedAt ?? "")
    )

  if (!usable.length) return null
  const stable = usable.find((x) => !x.release.isPrerelease)
  return stable ?? usable[0]!
}

export async function alreadyScraped(fullName: string) {
  const row = await prisma.scrapeRecord.findUnique({
    where: { fullName },
    select: { status: true },
  })
  return row
}

export async function markScrape(
  fullName: string,
  status: string,
  reason?: string,
  repositoryId?: string
) {
  const existing = await prisma.scrapeRecord.findUnique({
    where: { fullName },
    select: { attempts: true },
  })
  const attempts = status === "error" ? (existing?.attempts ?? 0) + 1 : 0
  await prisma.scrapeRecord.upsert({
    where: { fullName },
    create: {
      fullName,
      status,
      reason,
      repositoryId,
      attempts,
      lastSeenAt: new Date(),
    },
    update: {
      status,
      reason,
      repositoryId,
      attempts,
      lastSeenAt: new Date(),
    },
  })
}

export async function scrapeRecordState(fullName: string) {
  const row = await prisma.scrapeRecord.findUnique({
    where: { fullName },
    select: { status: true, lastSeenAt: true, attempts: true },
  })
  if (!row) return null
  return {
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    attempts: row.attempts,
  }
}

export async function touchReleaseChecked(
  fullName: string,
  opts?: {
    releasesEtag?: string | null
    latestReleaseGithubId?: string | null
  }
) {
  const data: {
    releaseCheckedAt: Date
    releasesEtag?: string | null
    latestReleaseGithubId?: string | null
  } = { releaseCheckedAt: new Date() }
  if (opts?.releasesEtag !== undefined) data.releasesEtag = opts.releasesEtag
  if (opts?.latestReleaseGithubId !== undefined) {
    data.latestReleaseGithubId = opts.latestReleaseGithubId
  }
  await prisma.repository.updateMany({
    where: { fullName },
    data,
  })
}

export async function touchScrapedAt(fullName: string) {
  await prisma.repository.updateMany({
    where: { fullName },
    data: { scrapedAt: new Date() },
  })
}

export async function saveRepoFromGraphql(node: GqlRepo) {
  const fullName = node.nameWithOwner
  const releases = node.releases?.nodes ?? []
  const total = node.releases?.totalCount ?? 0

  if (total <= 0 || !releases.length) {
    await markScrape(fullName, "skipped_no_releases", "no releases")
    return { saved: false as const, reason: "no_releases" }
  }

  const picked = pickLatest(releases)
  if (!picked) {
    await markScrape(fullName, SKIPPED_NO_ASSETS_STATUS, SKIPPED_NO_ASSETS_REASON)
    return { saved: false as const, reason: "no_assets" }
  }

  const { release, assets } = picked
  const summary = summarizePlatforms(assets)
  const topics =
    node.repositoryTopics?.nodes
      ?.map((n) => n?.topic?.name)
      .filter((t): t is string => Boolean(t)) ?? []

  const nonApp = evaluateNonApp({
    fullName,
    name: node.name,
    description: node.description ?? null,
    topics,
    hasWindows: summary.hasWindows,
    hasMacos: summary.hasMacos,
    hasLinux: summary.hasLinux,
    hasAndroid: summary.hasAndroid,
    hasIos: summary.hasIos,
    platforms: summary.platforms,
    assets,
    stars: node.stargazerCount ?? 0,
  })
  if (nonApp) {
    await markScrape(fullName, SKIPPED_NON_APP_STATUS, SKIPPED_NON_APP_REASON)
    return { saved: false as const, reason: "non_app" as const }
  }

  const owner = node.owner?.login ?? fullName.split("/")[0]!
  const pushedAt = node.pushedAt ? new Date(node.pushedAt) : null
  const publishedAt = release.publishedAt
    ? new Date(release.publishedAt)
    : null

  const existing = await prisma.repository.findUnique({
    where: { fullName },
    select: {
      previousStars: true,
      previousContributors: true,
      scoredAt: true,
      createdAt: true,
    },
  })

  const scoreFields = buildRepositoryScoreFields({
    stars: node.stargazerCount ?? 0,
    previousStars: existing?.previousStars ?? null,
    previousContributors: existing?.previousContributors ?? null,
    scoredAt: existing?.scoredAt ?? null,
    repoCreatedAt: null,
    catalogCreatedAt: existing?.createdAt ?? null,
    latestReleasePublishedAt: publishedAt,
    releasePublishedAts: releases.map((r) => r.publishedAt),
    recentCommits: 0,
    contributorsCount: existing?.previousContributors ?? 0,
    openIssues: 0,
  })

  const repo = await prisma.repository.upsert({
    where: { fullName },
    create: {
      fullName,
      name: node.name,
      owner,
      description: node.description ?? null,
      url: node.url,
      homepage: node.homepageUrl || null,
      stars: node.stargazerCount ?? 0,
      language: node.primaryLanguage?.name ?? null,
      topics,
      license: node.licenseInfo?.spdxId || node.licenseInfo?.name || null,
      avatarUrl: node.owner?.avatarUrl ?? null,
      pushedAt,
      releasesCount: total,
      platforms: summary.platforms,
      hasWindows: summary.hasWindows,
      hasMacos: summary.hasMacos,
      hasLinux: summary.hasLinux,
      hasAndroid: summary.hasAndroid,
      hasIos: summary.hasIos,
      hidden: false,
      scrapedAt: new Date(),
      ...scoreFields,
      latestRelease: {
        create: {
          tag: release.tagName ?? "unknown",
          name: release.name ?? null,
          publishedAt,
          url: release.url ?? null,
          prerelease: Boolean(release.isPrerelease),
          body: release.description ?? null,
          platforms: summary.platforms,
          hasWindows: summary.hasWindows,
          hasMacos: summary.hasMacos,
          hasLinux: summary.hasLinux,
      hasAndroid: summary.hasAndroid,
      hasIos: summary.hasIos,
          assets: assets as unknown as object,
        },
      },
    },
    update: {
      name: node.name,
      owner,
      description: node.description ?? null,
      url: node.url,
      homepage: node.homepageUrl || null,
      stars: node.stargazerCount ?? 0,
      language: node.primaryLanguage?.name ?? null,
      topics,
      license: node.licenseInfo?.spdxId || node.licenseInfo?.name || null,
      avatarUrl: node.owner?.avatarUrl ?? null,
      pushedAt,
      releasesCount: total,
      platforms: summary.platforms,
      hasWindows: summary.hasWindows,
      hasMacos: summary.hasMacos,
      hasLinux: summary.hasLinux,
      hasAndroid: summary.hasAndroid,
      hasIos: summary.hasIos,
      scrapedAt: new Date(),
      ...scoreFields,
      latestRelease: {
        upsert: {
          create: {
            tag: release.tagName ?? "unknown",
            name: release.name ?? null,
            publishedAt,
            url: release.url ?? null,
            prerelease: Boolean(release.isPrerelease),
            body: release.description ?? null,
            platforms: summary.platforms,
            hasWindows: summary.hasWindows,
            hasMacos: summary.hasMacos,
            hasLinux: summary.hasLinux,
      hasAndroid: summary.hasAndroid,
      hasIos: summary.hasIos,
            assets: assets as unknown as object,
          },
          update: {
            tag: release.tagName ?? "unknown",
            name: release.name ?? null,
            publishedAt,
            url: release.url ?? null,
            prerelease: Boolean(release.isPrerelease),
            body: release.description ?? null,
            platforms: summary.platforms,
            hasWindows: summary.hasWindows,
            hasMacos: summary.hasMacos,
            hasLinux: summary.hasLinux,
      hasAndroid: summary.hasAndroid,
      hasIos: summary.hasIos,
            assets: assets as unknown as object,
          },
        },
      },
    },
  })

  await markScrape(fullName, "saved", undefined, repo.id)
  return { saved: true as const, id: repo.id, assets: assets as DesktopAsset[] }
}

export async function hideRepository(fullName: string, reason: string) {
  const repo = await prisma.repository.update({
    where: { fullName },
    data: { hidden: true, hiddenReason: reason },
  })
  await markScrape(fullName, "hidden", reason, repo.id)
  return repo
}

/** Remove a catalog row (releases cascade) and mark the scrape ledger. */
export async function removeCatalogRepo(
  fullName: string,
  status: string,
  reason: string
) {
  const existing = await prisma.repository.findUnique({
    where: { fullName },
    select: { id: true },
  })
  if (existing) {
    await prisma.repository.delete({ where: { id: existing.id } })
  }
  await markScrape(fullName, status, reason)
  return { deleted: Boolean(existing) }
}

type RestSaveInput = {
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

export type RestReleaseInput = {
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

const VERSION_SUFFIX =
  /[._-](windows|win|macos|mac|osx|darwin|linux|android|ios|iphone|ipad|x86_64|amd64|arm64|aarch64|universal|portable|setup|installer|appimage|deb|rpm|apk|dmg|exe|msi|zip|tar\.gz|tgz)$/

/** Normalize a tag for cross-release version matching (e.g. v1.2.0-windows → 1.2.0). */
function normalizeVersion(tag?: string | null): string {
  if (!tag) return ""
  let v = tag.trim().toLowerCase()
  v = v.replace(/^v(?=\d)/, "")
  // Strip trailing platform/arch/package suffixes repeatedly.
  for (;;) {
    const next = v.replace(VERSION_SUFFIX, "")
    if (next === v) break
    v = next
  }
  return v.replace(/[._-]+$/, "")
}

export type ReleaseBundle = {
  primary: RestReleaseInput
  assets: DesktopAsset[]
  usedTags: string[]
}

/**
 * Pick the primary release and merge in sibling releases that belong to
 * the same version (normalized tag match) or were published within
 * 7 days of the primary — installers are often split across per-platform
 * releases for the same version.
 */
export function pickReleaseBundle(
  releases: RestReleaseInput[]
): ReleaseBundle | null {
  const usable = releases
    .filter((r) => !r.draft)
    .map((release) => {
      const assets = usableInstallers(release.assets ?? [])
      return { release, assets }
    })
    .filter((x) => x.assets.length > 0)
    .sort(
      (a, b) =>
        Date.parse(b.release.published_at ?? "") -
        Date.parse(a.release.published_at ?? "")
    )

  if (!usable.length) return null

  const primaryEntry = usable.find((x) => !x.release.prerelease) ?? usable[0]!
  const primary = primaryEntry.release
  const primaryVersion = normalizeVersion(primary.tag_name)
  const primaryTime = Date.parse(primary.published_at ?? "")
  const sevenDaysMs = 7 * 86_400_000

  const merged: typeof usable = [primaryEntry]
  for (const entry of usable) {
    if (entry === primaryEntry) continue
    const versionMatch =
      primaryVersion !== "" &&
      normalizeVersion(entry.release.tag_name) === primaryVersion
    const time = Date.parse(entry.release.published_at ?? "")
    const withinWindow =
      Number.isFinite(primaryTime) &&
      Number.isFinite(time) &&
      Math.abs(time - primaryTime) <= sevenDaysMs
    if (versionMatch || withinWindow) merged.push(entry)
  }

  const seen = new Set<string>()
  const assets: DesktopAsset[] = []
  for (const entry of merged) {
    for (const asset of entry.assets) {
      const key = asset.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      assets.push(asset)
    }
  }

  return {
    primary,
    assets,
    usedTags: merged.map((x) => x.release.tag_name ?? "unknown"),
  }
}

function buildScoreFields(
  repo: RestSaveInput,
  releases: RestReleaseInput[],
  activity: ActivitySignals,
  previous: {
    previousStars: number | null
    previousContributors: number | null
    scoredAt: Date | null
    createdAt: Date | null
  } | null,
  latestReleasePublishedAt: Date | null
) {
  return buildRepositoryScoreFields({
    stars: repo.stargazers_count ?? 0,
    previousStars: previous?.previousStars ?? null,
    previousContributors: previous?.previousContributors ?? null,
    scoredAt: previous?.scoredAt ?? null,
    repoCreatedAt: repo.created_at
      ? new Date(repo.created_at)
      : activity.createdAt,
    catalogCreatedAt: previous?.createdAt ?? null,
    latestReleasePublishedAt,
    releasePublishedAts: releases.map((r) => r.published_at),
    recentCommits: activity.recentCommits,
    contributorsCount: activity.contributorsCount,
    openIssues: activity.openIssues,
  })
}

/** Persist from Core REST payloads (HTML discovery path). */
export async function saveRepoFromRest(
  repo: RestSaveInput,
  releases: RestReleaseInput[],
  activity: ActivitySignals = {
    recentCommits: 0,
    contributorsCount: 0,
    openIssues: repo.open_issues_count ?? 0,
    createdAt: repo.created_at ? new Date(repo.created_at) : null,
  }
) {
  const fullName = repo.full_name
  if (!releases.length) {
    await markScrape(fullName, "skipped_no_releases", "no releases")
    return { saved: false as const, reason: "no_releases" }
  }

  const bundle = pickReleaseBundle(releases)
  if (!bundle) {
    await markScrape(fullName, SKIPPED_NO_ASSETS_STATUS, SKIPPED_NO_ASSETS_REASON)
    return { saved: false as const, reason: "no_assets" }
  }

  const release = bundle.primary
  const assets = bundle.assets
  const summary = summarizePlatforms(assets)
  const owner = repo.owner?.login ?? fullName.split("/")[0]!
  const pushedAt = repo.pushed_at ? new Date(repo.pushed_at) : null
  const publishedAt = release.published_at
    ? new Date(release.published_at)
    : null
  const topics = repo.topics ?? []

  const nonApp = evaluateNonApp({
    fullName,
    name: repo.name,
    description: repo.description ?? null,
    topics,
    hasWindows: summary.hasWindows,
    hasMacos: summary.hasMacos,
    hasLinux: summary.hasLinux,
    hasAndroid: summary.hasAndroid,
    hasIos: summary.hasIos,
    platforms: summary.platforms,
    assets,
    stars: repo.stargazers_count ?? 0,
  })
  if (nonApp) {
    await markScrape(fullName, SKIPPED_NON_APP_STATUS, SKIPPED_NON_APP_REASON)
    return { saved: false as const, reason: "non_app" }
  }

  const existing = await prisma.repository.findUnique({
    where: { fullName },
    select: {
      previousStars: true,
      previousContributors: true,
      scoredAt: true,
      createdAt: true,
    },
  })

  const scoreFields = buildScoreFields(
    repo,
    releases,
    activity,
    existing,
    publishedAt
  )

  // Watermark: keep the existing value when the primary has no GitHub id;
  // releasesEtag is intentionally left unchanged here (see touchReleaseChecked).
  const watermarkFields =
    release.id != null
      ? { latestReleaseGithubId: String(release.id) }
      : {}

  const row = await prisma.repository.upsert({
    where: { fullName },
    create: {
      fullName,
      name: repo.name,
      owner,
      description: repo.description ?? null,
      url: repo.html_url,
      homepage: repo.homepage || null,
      stars: repo.stargazers_count ?? 0,
      language: repo.language ?? null,
      topics,
      license: repo.license?.spdx_id || repo.license?.name || null,
      avatarUrl: repo.owner?.avatar_url ?? null,
      pushedAt,
      releasesCount: releases.length,
      platforms: summary.platforms,
      hasWindows: summary.hasWindows,
      hasMacos: summary.hasMacos,
      hasLinux: summary.hasLinux,
      hasAndroid: summary.hasAndroid,
      hasIos: summary.hasIos,
      hidden: false,
      scrapedAt: new Date(),
      ...scoreFields,
      ...watermarkFields,
      latestRelease: {
        create: {
          tag: release.tag_name ?? "unknown",
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
          assets: assets as unknown as object,
        },
      },
    },
    update: {
      name: repo.name,
      owner,
      description: repo.description ?? null,
      url: repo.html_url,
      homepage: repo.homepage || null,
      stars: repo.stargazers_count ?? 0,
      language: repo.language ?? null,
      topics,
      license: repo.license?.spdx_id || repo.license?.name || null,
      avatarUrl: repo.owner?.avatar_url ?? null,
      pushedAt,
      releasesCount: releases.length,
      platforms: summary.platforms,
      hasWindows: summary.hasWindows,
      hasMacos: summary.hasMacos,
      hasLinux: summary.hasLinux,
      hasAndroid: summary.hasAndroid,
      hasIos: summary.hasIos,
      scrapedAt: new Date(),
      ...scoreFields,
      ...watermarkFields,
      latestRelease: {
        upsert: {
          create: {
            tag: release.tag_name ?? "unknown",
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
            assets: assets as unknown as object,
          },
          update: {
            tag: release.tag_name ?? "unknown",
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
            assets: assets as unknown as object,
          },
        },
      },
    },
  })

  await markScrape(fullName, "saved", undefined, row.id)
  return {
    saved: true as const,
    id: row.id,
    assets: assets as DesktopAsset[],
    score: scoreFields.activityScore,
  }
}