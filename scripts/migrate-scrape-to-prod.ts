#!/usr/bin/env tsx
/**
 * Copy catalog repos from a source DB (local) to a target DB (prod).
 *
 * Migrates: Repository + latest Release only
 * On start: deletes all ScrapeRecord rows on the target (ledger stays local)
 * Skips: users, favorites, submissions
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
  } as Prisma.RepositoryCreateInput
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
  return rest as Prisma.RepositoryUpdateInput
}

async function migrateRepos(
  source: PrismaClient,
  target: PrismaClient,
  dryRun: boolean
) {
  let cursor: string | undefined
  let reposUpserted = 0
  let releasesUpserted = 0

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

    for (const row of batch) {
      const { latestRelease, ...repo } = row

      if (dryRun) {
        reposUpserted += 1
        if (latestRelease) releasesUpserted += 1
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
          } as Prisma.ReleaseUncheckedCreateInput,
          update: releaseFields as Prisma.ReleaseUpdateInput,
        })
        releasesUpserted += 1
      }
    }

    process.stdout.write(
      `\r  repositories… ${reposUpserted}${dryRun ? " (dry-run)" : ""}`
    )
  }

  process.stdout.write("\n")
  return { reposUpserted, releasesUpserted }
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
    const repoStats = await migrateRepos(source, target, flags.dryRun)

    const targetAfter = flags.dryRun
      ? targetRepos
      : await target.repository.count()

    console.log("\nDone.")
    console.log(`  scrape records cleared: ${flags.dryRun ? targetScrapes : "yes"}`)
    console.log(`  repositories upserted:  ${repoStats.reposUpserted}`)
    console.log(`  releases upserted:      ${repoStats.releasesUpserted}`)
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
