#!/usr/bin/env tsx
/**
 * Copy scraped catalog data from a source DB (local) to a target DB (prod).
 *
 * Migrates: Repository, Release, ScrapeRecord
 * Skips: users, sessions, accounts, favorites, submissions, verification
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

import { PrismaClient, type Prisma } from "../generated/prisma/client.js"

const BATCH = 100

type Flags = {
  dryRun: boolean
  confirm: boolean
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
  // Tag disconnect errors with which DB failed
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

function repoCreateData(
  repo: Prisma.RepositoryGetPayload<object>
): Prisma.RepositoryCreateInput {
  const { id, createdAt, updatedAt, ...rest } = repo
  return {
    id,
    ...rest,
    createdAt,
    updatedAt,
  }
}

function repoUpdateData(
  repo: Prisma.RepositoryGetPayload<object>
): Prisma.RepositoryUpdateInput {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    fullName: _fullName,
    ...rest
  } = repo
  return rest
}

async function migrateRepos(
  source: PrismaClient,
  target: PrismaClient,
  dryRun: boolean
) {
  let cursor: string | undefined
  let reposUpserted = 0
  let releasesUpserted = 0
  let scrapeFromRepo = 0

  for (;;) {
    const batch = await source.repository.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: {
        latestRelease: true,
        scrapeRecord: true,
      },
    })

    if (batch.length === 0) break
    cursor = batch[batch.length - 1]!.id

    for (const row of batch) {
      const { latestRelease, scrapeRecord, ...repo } = row

      if (dryRun) {
        reposUpserted += 1
        if (latestRelease) releasesUpserted += 1
        if (scrapeRecord) scrapeFromRepo += 1
        continue
      }

      const upserted = await target.repository.upsert({
        where: { fullName: repo.fullName },
        create: repoCreateData(repo),
        update: repoUpdateData(repo),
      })
      reposUpserted += 1

      if (latestRelease) {
        const {
          id: releaseId,
          repositoryId: _repositoryId,
          createdAt,
          updatedAt,
          ...releaseFields
        } = latestRelease

        await target.release.upsert({
          where: { repositoryId: upserted.id },
          create: {
            id: releaseId,
            repositoryId: upserted.id,
            ...releaseFields,
            createdAt,
            updatedAt,
          },
          update: releaseFields,
        })
        releasesUpserted += 1
      }

      if (scrapeRecord) {
        const {
          id: scrapeId,
          repositoryId: _repositoryId,
          createdAt,
          updatedAt,
          ...scrapeFields
        } = scrapeRecord

        await target.scrapeRecord.upsert({
          where: { fullName: scrapeRecord.fullName },
          create: {
            id: scrapeId,
            ...scrapeFields,
            repositoryId: upserted.id,
            createdAt,
            updatedAt,
          },
          update: {
            ...scrapeFields,
            repositoryId: upserted.id,
          },
        })
        scrapeFromRepo += 1
      }
    }

    process.stdout.write(
      `\r  repositories… ${reposUpserted}${dryRun ? " (dry-run)" : ""}`
    )
  }

  process.stdout.write("\n")
  return { reposUpserted, releasesUpserted, scrapeFromRepo }
}

async function migrateOrphanScrapes(
  source: PrismaClient,
  target: PrismaClient,
  dryRun: boolean
) {
  let cursor: string | undefined
  let upserted = 0

  for (;;) {
    const batch = await source.scrapeRecord.findMany({
      where: { repositoryId: null },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    })

    if (batch.length === 0) break
    cursor = batch[batch.length - 1]!.id

    for (const scrape of batch) {
      if (dryRun) {
        upserted += 1
        continue
      }

      const {
        id,
        createdAt,
        updatedAt,
        repositoryId: _repositoryId,
        ...fields
      } = scrape

      await target.scrapeRecord.upsert({
        where: { fullName: scrape.fullName },
        create: {
          id,
          ...fields,
          repositoryId: null,
          createdAt,
          updatedAt,
        },
        update: {
          ...fields,
          // Do not clear an existing repository link on the target
          repositoryId: undefined,
        },
      })
      upserted += 1
    }

    process.stdout.write(
      `\r  orphan scrape records… ${upserted}${dryRun ? " (dry-run)" : ""}`
    )
  }

  process.stdout.write("\n")
  return upserted
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

  console.log("Scrape data migration")
  console.log(`  source: ${hostOf(sourceUrl)}`)
  console.log(`  target: ${hostOf(targetUrl)}`)
  console.log(
    `  mode:   ${flags.dryRun ? "dry-run (no writes)" : flags.confirm ? "LIVE write" : "blocked"}`
  )

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
    const [sourceRepos, sourceScrapes, targetRepos] = await Promise.all([
      source.repository.count(),
      source.scrapeRecord.count(),
      target.repository.count(),
    ])

    console.log(
      `\nCounts — source repos: ${sourceRepos}, source scrapes: ${sourceScrapes}, target repos (before): ${targetRepos}`
    )

    console.log("\nMigrating repositories (+ releases + linked scrapes)…")
    const repoStats = await migrateRepos(source, target, flags.dryRun)

    console.log("Migrating orphan scrape records (no repository)…")
    const orphanScrapes = await migrateOrphanScrapes(
      source,
      target,
      flags.dryRun
    )

    const targetAfter = flags.dryRun
      ? targetRepos
      : await target.repository.count()

    console.log("\nDone.")
    console.log(`  repositories upserted: ${repoStats.reposUpserted}`)
    console.log(`  releases upserted:     ${repoStats.releasesUpserted}`)
    console.log(`  scrapes (from repos):  ${repoStats.scrapeFromRepo}`)
    console.log(`  scrapes (orphans):     ${orphanScrapes}`)
    console.log(`  target repos (after):  ${targetAfter}`)
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()])
  }
}

main().catch((error) => {
  console.error("\nMigration failed:", error instanceof Error ? error.message : error)
  process.exit(1)
})
