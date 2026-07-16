#!/usr/bin/env tsx
/**
 * Copy catalog repos from a source DB (local) to a target DB (prod).
 *
 * Migrates: Repository + latest Release only
 * On start: deletes all ScrapeRecord rows on the target (ledger stays local)
 * After upsert: deletes target repos whose fullName is not in source (keeps Neon = local)
 * Skips: users, favorites, submissions
 *
 * Fast path: bulk INSERT … ON CONFLICT via jsonb_to_recordset (few RTTs to Neon).
 *
 * Usage:
 *   pnpm db:migrate-scrape -- --dry-run
 *   pnpm db:migrate-scrape -- --confirm
 *
 * Env (see .env.example):
 *   LOCAL_DATABASE_URL  — source (scraped data)
 *   PROD_DATABASE_URL   — destination
 *
 * Optional overrides:
 *   SOURCE_DATABASE_URL / TARGET_DATABASE_URL
 */
import "dotenv/config"

import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../generated/prisma/client.js"

/** Rows per bulk upsert — one source read + two target writes. */
const BATCH = 400

type Flags = {
  dryRun: boolean
  confirm: boolean
}

type RepoRow = {
  id: string
  fullName: string
  name: string
  owner: string
  description: string | null
  url: string
  homepage: string | null
  stars: number
  language: string | null
  topics: unknown
  license: string | null
  avatarUrl: string | null
  pushedAt: Date | null
  releasesCount: number | null
  platforms: unknown
  hasWindows: boolean
  hasMacos: boolean
  hasLinux: boolean
  hasAndroid: boolean
  hasIos: boolean
  hidden: boolean
  hiddenReason: string | null
  featured: boolean
  featuredAt: Date | null
  scrapedAt: Date
  releaseCheckedAt: Date | null
  activityScore: number
  scoreNewStars: number
  scoreReleaseFrequency: number
  scoreRecentCommits: number
  scoreContributorGrowth: number
  scoreIssueActivity: number
  previousStars: number | null
  previousContributors: number | null
  contributorsCount: number | null
  scoredAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type ReleaseRow = {
  id: string
  repositoryId: string
  fullName: string
  tag: string
  name: string | null
  publishedAt: Date | null
  url: string | null
  prerelease: boolean
  body: string | null
  platforms: unknown
  hasWindows: boolean
  hasMacos: boolean
  hasLinux: boolean
  hasAndroid: boolean
  hasIos: boolean
  assets: unknown
  createdAt: Date
  updatedAt: Date
}

function parseFlags(argv: string[]): Flags {
  return {
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
  }
}

function requireUrl(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      `Missing ${name}. Set it in .env (see .env.example) before running.`
    )
  }
  return value.trim()
}

function makeClient(connectionString: string, label: string) {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })
  const original = client.$disconnect.bind(client)
  client.$disconnect = async () => {
    try {
      await original()
    } catch (error) {
      console.error(`Failed to disconnect ${label}:`, error)
    }
  }
  return client
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "(invalid url)"
  }
}

function jsonPayload(rows: unknown[]): string {
  return JSON.stringify(rows, (_key, value) => {
    if (value instanceof Date) return value.toISOString()
    return value
  })
}

async function bulkUpsertRepos(target: PrismaClient, repos: RepoRow[]) {
  if (repos.length === 0) return
  const payload = jsonPayload(repos)

  await target.$executeRawUnsafe(
    `
    INSERT INTO "Repository" (
      id, "fullName", name, owner, description, url, homepage, stars,
      language, topics, license, "avatarUrl", "pushedAt", "releasesCount",
      platforms, "hasWindows", "hasMacos", "hasLinux", "hasAndroid", "hasIos",
      hidden, "hiddenReason", featured, "featuredAt", "scrapedAt", "releaseCheckedAt",
      "activityScore", "scoreNewStars", "scoreReleaseFrequency", "scoreRecentCommits",
      "scoreContributorGrowth", "scoreIssueActivity", "previousStars",
      "previousContributors", "contributorsCount", "scoredAt", "createdAt", "updatedAt"
    )
    SELECT
      id, "fullName", name, owner, description, url, homepage, stars,
      language, topics, license, "avatarUrl", "pushedAt", "releasesCount",
      platforms, "hasWindows", "hasMacos", "hasLinux", "hasAndroid", "hasIos",
      hidden, "hiddenReason", featured, "featuredAt", "scrapedAt", "releaseCheckedAt",
      "activityScore", "scoreNewStars", "scoreReleaseFrequency", "scoreRecentCommits",
      "scoreContributorGrowth", "scoreIssueActivity", "previousStars",
      "previousContributors", "contributorsCount", "scoredAt", "createdAt", "updatedAt"
    FROM jsonb_to_recordset($1::jsonb) AS x(
      id text,
      "fullName" text,
      name text,
      owner text,
      description text,
      url text,
      homepage text,
      stars int,
      language text,
      topics jsonb,
      license text,
      "avatarUrl" text,
      "pushedAt" timestamptz,
      "releasesCount" int,
      platforms jsonb,
      "hasWindows" boolean,
      "hasMacos" boolean,
      "hasLinux" boolean,
      "hasAndroid" boolean,
      "hasIos" boolean,
      hidden boolean,
      "hiddenReason" text,
      featured boolean,
      "featuredAt" timestamptz,
      "scrapedAt" timestamptz,
      "releaseCheckedAt" timestamptz,
      "activityScore" double precision,
      "scoreNewStars" double precision,
      "scoreReleaseFrequency" double precision,
      "scoreRecentCommits" double precision,
      "scoreContributorGrowth" double precision,
      "scoreIssueActivity" double precision,
      "previousStars" int,
      "previousContributors" int,
      "contributorsCount" int,
      "scoredAt" timestamptz,
      "createdAt" timestamptz,
      "updatedAt" timestamptz
    )
    ON CONFLICT ("fullName") DO UPDATE SET
      name = EXCLUDED.name,
      owner = EXCLUDED.owner,
      description = EXCLUDED.description,
      url = EXCLUDED.url,
      homepage = EXCLUDED.homepage,
      stars = EXCLUDED.stars,
      language = EXCLUDED.language,
      topics = EXCLUDED.topics,
      license = EXCLUDED.license,
      "avatarUrl" = EXCLUDED."avatarUrl",
      "pushedAt" = EXCLUDED."pushedAt",
      "releasesCount" = EXCLUDED."releasesCount",
      platforms = EXCLUDED.platforms,
      "hasWindows" = EXCLUDED."hasWindows",
      "hasMacos" = EXCLUDED."hasMacos",
      "hasLinux" = EXCLUDED."hasLinux",
      "hasAndroid" = EXCLUDED."hasAndroid",
      "hasIos" = EXCLUDED."hasIos",
      hidden = EXCLUDED.hidden,
      "hiddenReason" = EXCLUDED."hiddenReason",
      featured = EXCLUDED.featured,
      "featuredAt" = EXCLUDED."featuredAt",
      "scrapedAt" = EXCLUDED."scrapedAt",
      "releaseCheckedAt" = EXCLUDED."releaseCheckedAt",
      "activityScore" = EXCLUDED."activityScore",
      "scoreNewStars" = EXCLUDED."scoreNewStars",
      "scoreReleaseFrequency" = EXCLUDED."scoreReleaseFrequency",
      "scoreRecentCommits" = EXCLUDED."scoreRecentCommits",
      "scoreContributorGrowth" = EXCLUDED."scoreContributorGrowth",
      "scoreIssueActivity" = EXCLUDED."scoreIssueActivity",
      "previousStars" = EXCLUDED."previousStars",
      "previousContributors" = EXCLUDED."previousContributors",
      "contributorsCount" = EXCLUDED."contributorsCount",
      "scoredAt" = EXCLUDED."scoredAt",
      "updatedAt" = EXCLUDED."updatedAt"
    `,
    payload
  )
}

async function bulkUpsertReleases(target: PrismaClient, releases: ReleaseRow[]) {
  if (releases.length === 0) return
  const payload = jsonPayload(releases)

  // Join by fullName so we attach to the target row even when ids differ.
  await target.$executeRawUnsafe(
    `
    INSERT INTO "Release" (
      id, "repositoryId", tag, name, "publishedAt", url, prerelease, body,
      platforms, "hasWindows", "hasMacos", "hasLinux", "hasAndroid", "hasIos",
      assets, "createdAt", "updatedAt"
    )
    SELECT
      x.id,
      r.id,
      x.tag,
      x.name,
      x."publishedAt",
      x.url,
      x.prerelease,
      x.body,
      x.platforms,
      x."hasWindows",
      x."hasMacos",
      x."hasLinux",
      x."hasAndroid",
      x."hasIos",
      x.assets,
      x."createdAt",
      x."updatedAt"
    FROM jsonb_to_recordset($1::jsonb) AS x(
      id text,
      "repositoryId" text,
      "fullName" text,
      tag text,
      name text,
      "publishedAt" timestamptz,
      url text,
      prerelease boolean,
      body text,
      platforms jsonb,
      "hasWindows" boolean,
      "hasMacos" boolean,
      "hasLinux" boolean,
      "hasAndroid" boolean,
      "hasIos" boolean,
      assets jsonb,
      "createdAt" timestamptz,
      "updatedAt" timestamptz
    )
    INNER JOIN "Repository" r ON r."fullName" = x."fullName"
    ON CONFLICT ("repositoryId") DO UPDATE SET
      tag = EXCLUDED.tag,
      name = EXCLUDED.name,
      "publishedAt" = EXCLUDED."publishedAt",
      url = EXCLUDED.url,
      prerelease = EXCLUDED.prerelease,
      body = EXCLUDED.body,
      platforms = EXCLUDED.platforms,
      "hasWindows" = EXCLUDED."hasWindows",
      "hasMacos" = EXCLUDED."hasMacos",
      "hasLinux" = EXCLUDED."hasLinux",
      "hasAndroid" = EXCLUDED."hasAndroid",
      "hasIos" = EXCLUDED."hasIos",
      assets = EXCLUDED.assets,
      "updatedAt" = EXCLUDED."updatedAt"
    `,
    payload
  )
}

async function migrateRepos(
  source: PrismaClient,
  target: PrismaClient,
  dryRun: boolean
) {
  let cursor: string | undefined
  let reposUpserted = 0
  let releasesUpserted = 0
  const sourceFullNames: string[] = []
  const started = Date.now()

  for (;;) {
    const batch = await source.repository.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: {
        latestRelease: true,
      },
    })

    if (batch.length === 0) break
    cursor = batch[batch.length - 1]!.id

    const repos: RepoRow[] = []
    const releases: ReleaseRow[] = []

    for (const row of batch) {
      const { latestRelease, ...repo } = row
      repos.push(repo)
      sourceFullNames.push(repo.fullName)
      if (latestRelease) {
        releases.push({
          ...latestRelease,
          fullName: repo.fullName,
        })
      }
    }

    if (!dryRun) {
      await bulkUpsertRepos(target, repos)
      await bulkUpsertReleases(target, releases)
    }

    reposUpserted += repos.length
    releasesUpserted += releases.length

    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    const rate = Math.round(reposUpserted / Math.max((Date.now() - started) / 1000, 0.001))
    process.stdout.write(
      `\r  repositories… ${reposUpserted}${dryRun ? " (dry-run)" : ""}  (${elapsed}s, ~${rate}/s)   `
    )
  }

  process.stdout.write("\n")
  return { reposUpserted, releasesUpserted, sourceFullNames }
}

/** Remove prod repos that no longer exist in the local catalog. Cascades releases. */
async function deleteOrphanRepos(
  target: PrismaClient,
  sourceFullNames: string[],
  dryRun: boolean
) {
  if (sourceFullNames.length === 0) {
    throw new Error("Refusing orphan delete: source catalog is empty.")
  }

  const payload = JSON.stringify(sourceFullNames)

  if (dryRun) {
    const rows = await target.$queryRawUnsafe<{ fullName: string }[]>(
      `
      SELECT r."fullName"
      FROM "Repository" r
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text($1::jsonb) AS s(fn)
        WHERE s.fn = r."fullName"
      )
      ORDER BY r."fullName"
      `,
      payload
    )
    return { deleted: rows.length, sample: rows.slice(0, 10).map((r) => r.fullName) }
  }

  const deleted = await target.$executeRawUnsafe(
    `
    DELETE FROM "Repository" r
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text($1::jsonb) AS s(fn)
      WHERE s.fn = r."fullName"
    )
    `,
    payload
  )

  return { deleted: Number(deleted), sample: [] as string[] }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))

  const sourceUrl = requireUrl(
    "LOCAL_DATABASE_URL (or SOURCE_DATABASE_URL)",
    process.env.SOURCE_DATABASE_URL || process.env.LOCAL_DATABASE_URL
  )
  const targetUrl = requireUrl(
    "PROD_DATABASE_URL (or TARGET_DATABASE_URL)",
    process.env.TARGET_DATABASE_URL || process.env.PROD_DATABASE_URL
  )

  if (sourceUrl === targetUrl) {
    throw new Error("Source and target database URLs must be different.")
  }

  console.log("Repo catalog migration (repos + releases only)")
  console.log(`  source: ${hostOf(sourceUrl)}`)
  console.log(`  target: ${hostOf(targetUrl)}`)
  console.log(
    `  mode:   ${flags.dryRun ? "dry-run (no writes)" : flags.confirm ? "LIVE write" : "blocked"}`
  )
  console.log(`  batch:  ${BATCH} rows / bulk upsert`)

  if (!flags.dryRun && !flags.confirm) {
    throw new Error(
      "Refusing to write without --confirm.\n" +
        "  Preview: pnpm db:migrate-scrape -- --dry-run\n" +
        "  Apply:   pnpm db:migrate-scrape -- --confirm"
    )
  }

  const source = makeClient(sourceUrl, "source")
  const target = makeClient(targetUrl, "target")

  try {
    const [sourceRepos, targetRepos, targetScrapes] = await Promise.all([
      source.repository.count(),
      target.repository.count(),
      target.scrapeRecord.count(),
    ])

    console.log(
      `\nCounts — source repos: ${sourceRepos}, target repos (before): ${targetRepos}, target scrapes (before): ${targetScrapes}`
    )

    console.log("\nClearing scrape records on target…")
    if (flags.dryRun) {
      console.log(`  would delete ${targetScrapes} scrape record(s) (dry-run)`)
    } else {
      const deleted = await target.scrapeRecord.deleteMany({})
      console.log(`  deleted ${deleted.count} scrape record(s)`)
    }

    console.log("\nMigrating repositories (+ latest releases)…")
    const t0 = Date.now()
    const repoStats = await migrateRepos(source, target, flags.dryRun)

    console.log("\nDeleting target repos missing from source…")
    const orphanStats = await deleteOrphanRepos(
      target,
      repoStats.sourceFullNames,
      flags.dryRun
    )
    if (flags.dryRun) {
      console.log(`  would delete ${orphanStats.deleted} orphan repo(s)`)
      if (orphanStats.sample.length) {
        console.log(`  sample: ${orphanStats.sample.join(", ")}`)
      }
    } else {
      console.log(`  deleted ${orphanStats.deleted} orphan repo(s)`)
    }

    const seconds = ((Date.now() - t0) / 1000).toFixed(1)

    const targetAfter = flags.dryRun
      ? targetRepos
      : await target.repository.count()

    console.log("\nDone.")
    console.log(`  elapsed:                ${seconds}s`)
    console.log(`  scrape records cleared: ${flags.dryRun ? targetScrapes : "yes"}`)
    console.log(`  repositories upserted:  ${repoStats.reposUpserted}`)
    console.log(`  releases upserted:      ${repoStats.releasesUpserted}`)
    console.log(
      `  orphan repos deleted:   ${flags.dryRun ? `${orphanStats.deleted} (dry-run)` : orphanStats.deleted}`
    )
    console.log(`  target repos (after):   ${targetAfter}`)
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()])
  }
}

main().catch((error) => {
  console.error(
    "\nMigration failed:",
    error instanceof Error ? error.message : error
  )
  process.exit(1)
})
