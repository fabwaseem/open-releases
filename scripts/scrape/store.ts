import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../../generated/prisma/client.js"
import {
  computeActivityScore,
  releaseFrequencyPerMonth,
  starVelocityProxy,
} from "../../lib/score.js"
import {
  filterDesktopAssets,
  summarizePlatforms,
  type DesktopAsset,
} from "./platforms.js"
import type { ActivitySignals } from "./github.js"

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
      const assets = filterDesktopAssets(r.releaseAssets?.nodes ?? [])
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
  await prisma.scrapeRecord.upsert({
    where: { fullName },
    create: {
      fullName,
      status,
      reason,
      repositoryId,
      lastSeenAt: new Date(),
    },
    update: {
      status,
      reason,
      repositoryId,
      lastSeenAt: new Date(),
    },
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
    await markScrape(fullName, "skipped_no_assets", "no installable release assets")
    return { saved: false as const, reason: "no_assets" }
  }

  const { release, assets } = picked
  const summary = summarizePlatforms(assets)
  const topics =
    node.repositoryTopics?.nodes
      ?.map((n) => n?.topic?.name)
      .filter((t): t is string => Boolean(t)) ?? []

  const owner = node.owner?.login ?? fullName.split("/")[0]!
  const pushedAt = node.pushedAt ? new Date(node.pushedAt) : null
  const publishedAt = release.publishedAt
    ? new Date(release.publishedAt)
    : null

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

type RestReleaseInput = {
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

function buildScoreFields(
  repo: RestSaveInput,
  releases: RestReleaseInput[],
  activity: ActivitySignals,
  previous: {
    previousStars: number | null
    previousContributors: number | null
  } | null
) {
  const stars = repo.stargazers_count ?? 0
  const contributors = activity.contributorsCount

  const newStars =
    previous?.previousStars != null
      ? Math.max(0, stars - previous.previousStars)
      : starVelocityProxy(
          stars,
          repo.created_at ? new Date(repo.created_at) : activity.createdAt
        )

  const contributorGrowth =
    previous?.previousContributors != null
      ? Math.max(0, contributors - previous.previousContributors)
      : Math.min(contributors, 25)

  const releaseFrequency = releaseFrequencyPerMonth(
    releases.map((r) => r.published_at)
  )

  const breakdown = computeActivityScore({
    newStars,
    releaseFrequency,
    recentCommits: activity.recentCommits,
    contributorGrowth,
    issueActivity: activity.openIssues,
  })

  return {
    activityScore: breakdown.score,
    scoreNewStars: breakdown.newStars,
    scoreReleaseFrequency: breakdown.releaseFrequency,
    scoreRecentCommits: breakdown.recentCommits,
    scoreContributorGrowth: breakdown.contributorGrowth,
    scoreIssueActivity: breakdown.issueActivity,
    previousStars: stars,
    previousContributors: contributors,
    contributorsCount: contributors,
    scoredAt: new Date(),
  }
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

  const usable = releases
    .filter((r) => !r.draft)
    .map((r) => {
      const assets = filterDesktopAssets(r.assets ?? [])
      return { release: r, assets }
    })
    .filter((x) => x.assets.length > 0)
    .sort(
      (a, b) =>
        Date.parse(b.release.published_at ?? "") -
        Date.parse(a.release.published_at ?? "")
    )

  if (!usable.length) {
    await markScrape(fullName, "skipped_no_assets", "no installable release assets")
    return { saved: false as const, reason: "no_assets" }
  }

  const picked = usable.find((x) => !x.release.prerelease) ?? usable[0]!
  const { release, assets } = picked
  const summary = summarizePlatforms(assets)
  const owner = repo.owner?.login ?? fullName.split("/")[0]!
  const pushedAt = repo.pushed_at ? new Date(repo.pushed_at) : null
  const publishedAt = release.published_at
    ? new Date(release.published_at)
    : null
  const topics = repo.topics ?? []

  const existing = await prisma.repository.findUnique({
    where: { fullName },
    select: { previousStars: true, previousContributors: true },
  })

  const scoreFields = buildScoreFields(repo, releases, activity, existing)

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