import { prisma } from "@/lib/db"
import {
  fetchActivitySignals,
  fetchReleases,
  fetchRepo,
  type GhRelease,
  type GhRepo,
} from "@/lib/github-rest"
import { filterDesktopAssets, summarizePlatforms } from "@/lib/platforms"
import {
  computeActivityScore,
  releaseFrequencyPerMonth,
  starVelocityProxy,
} from "@/lib/score"
import { parseGithubRepoInput } from "@/lib/repo-url"
import type { RepoPreview } from "@/lib/repo-submission-types"

export type { RepoPreview }

export type PreviewFailure = {
  ok: false
  error: string
  code:
    | "invalid_url"
    | "not_found"
    | "private"
    | "no_releases"
    | "no_assets"
    | "already_listed"
    | "already_pending"
    | "github_error"
}

export type PreviewSuccess = {
  ok: true
  preview: RepoPreview
}

function pickUsableRelease(releases: GhRelease[]) {
  const usable = releases
    .filter((r) => !r.draft)
    .map((r) => ({
      release: r,
      assets: filterDesktopAssets(r.assets ?? []),
    }))
    .filter((x) => x.assets.length > 0)
    .sort(
      (a, b) =>
        Date.parse(b.release.published_at ?? "") -
        Date.parse(a.release.published_at ?? "")
    )

  if (!usable.length) return null
  return usable.find((x) => !x.release.prerelease) ?? usable[0]!
}

function toPreview(
  repo: GhRepo,
  sourceUrl: string,
  picked: NonNullable<ReturnType<typeof pickUsableRelease>>
): RepoPreview {
  const summary = summarizePlatforms(picked.assets)
  const owner = repo.owner?.login ?? repo.full_name.split("/")[0]!
  return {
    fullName: repo.full_name,
    sourceUrl,
    name: repo.name,
    owner,
    description: repo.description ?? null,
    url: repo.html_url,
    homepage: repo.homepage || null,
    stars: repo.stargazers_count ?? 0,
    language: repo.language ?? null,
    avatarUrl: repo.owner?.avatar_url ?? null,
    license: repo.license?.spdx_id || repo.license?.name || null,
    releaseTag: picked.release.tag_name ?? "unknown",
    releaseName: picked.release.name ?? null,
    releaseUrl: picked.release.html_url ?? null,
    publishedAt: picked.release.published_at ?? null,
    prerelease: Boolean(picked.release.prerelease),
    platforms: summary.platforms,
    assets: picked.assets,
  }
}

export async function previewGithubRepo(
  rawUrl: string,
  opts?: { submittedById?: string }
): Promise<PreviewSuccess | PreviewFailure> {
  const parsed = parseGithubRepoInput(rawUrl)
  if (!parsed) {
    return {
      ok: false,
      code: "invalid_url",
      error: "Enter a valid GitHub repository URL (e.g. https://github.com/owner/repo).",
    }
  }

  const existing = await prisma.repository.findUnique({
    where: { fullName: parsed.fullName },
    select: { id: true, hidden: true },
  })
  if (existing && !existing.hidden) {
    return {
      ok: false,
      code: "already_listed",
      error: "This repository is already in the directory.",
    }
  }

  const pending = await prisma.repoSubmission.findFirst({
    where: { fullName: parsed.fullName, status: "pending" },
    select: { id: true, submittedById: true },
  })
  if (pending) {
    return {
      ok: false,
      code: "already_pending",
      error:
        pending.submittedById === opts?.submittedById
          ? "You already submitted this repository. It is waiting for admin review."
          : "This repository is already waiting for admin review.",
    }
  }

  try {
    const repo = await fetchRepo(parsed.owner, parsed.name)
    if (!repo) {
      return {
        ok: false,
        code: "not_found",
        error: "Repository not found. Check the URL and try again.",
      }
    }
    if (repo.private) {
      return {
        ok: false,
        code: "private",
        error: "Only public repositories can be submitted.",
      }
    }

    const releases = await fetchReleases(parsed.owner, parsed.name)
    if (!releases.length) {
      return {
        ok: false,
        code: "no_releases",
        error: "This repository has no GitHub Releases.",
      }
    }

    const picked = pickUsableRelease(releases)
    if (!picked) {
      return {
        ok: false,
        code: "no_assets",
        error:
          "No desktop installers found in releases (exe, msi, dmg, pkg, AppImage, deb, rpm, etc.).",
      }
    }

    return {
      ok: true,
      preview: toPreview(repo, parsed.sourceUrl, picked),
    }
  } catch (err) {
    return {
      ok: false,
      code: "github_error",
      error: (err as Error).message || "Failed to fetch repository from GitHub.",
    }
  }
}

function buildScoreFields(
  repo: GhRepo,
  releases: GhRelease[],
  activity: Awaited<ReturnType<typeof fetchActivitySignals>>,
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

  const breakdown = computeActivityScore({
    newStars,
    releaseFrequency: releaseFrequencyPerMonth(
      releases.map((r) => r.published_at)
    ),
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

/** Fetch and persist a repo into the public catalog (admin approve). */
export async function ingestGithubRepo(fullName: string) {
  const [owner, name] = fullName.split("/")
  if (!owner || !name) {
    throw new Error("Invalid repository name")
  }

  const repo = await fetchRepo(owner, name)
  if (!repo) throw new Error("Repository not found on GitHub")
  if (repo.private) throw new Error("Repository is private")

  const releases = await fetchReleases(owner, name)
  if (!releases.length) throw new Error("Repository has no releases")

  const picked = pickUsableRelease(releases)
  if (!picked) throw new Error("No desktop installer assets found")

  const summary = summarizePlatforms(picked.assets)
  const activity = await fetchActivitySignals(owner, name, repo)
  const existing = await prisma.repository.findUnique({
    where: { fullName },
    select: { previousStars: true, previousContributors: true },
  })
  const scoreFields = buildScoreFields(repo, releases, activity, existing)

  const ownerLogin = repo.owner?.login ?? owner
  const pushedAt = repo.pushed_at ? new Date(repo.pushed_at) : null
  const publishedAt = picked.release.published_at
    ? new Date(picked.release.published_at)
    : null
  const topics = repo.topics ?? []
  const assets = picked.assets
  const release = picked.release

  const row = await prisma.repository.upsert({
    where: { fullName },
    create: {
      fullName,
      name: repo.name,
      owner: ownerLogin,
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
      hidden: false,
      hiddenReason: null,
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
          assets: assets as unknown as object,
        },
      },
    },
    update: {
      name: repo.name,
      owner: ownerLogin,
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
      hidden: false,
      hiddenReason: null,
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
            assets: assets as unknown as object,
          },
        },
      },
    },
  })

  await prisma.scrapeRecord.upsert({
    where: { fullName },
    create: {
      fullName,
      status: "saved",
      repositoryId: row.id,
      reason: "user_submission",
    },
    update: {
      status: "saved",
      repositoryId: row.id,
      reason: "user_submission",
      lastSeenAt: new Date(),
    },
  })

  return row
}
