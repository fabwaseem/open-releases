#!/usr/bin/env tsx
/**
 * Purge non-apps and repos with no usable installers from the catalog.
 *
 * Matches (including already-hidden rows from a prior soft-hide run) are:
 *   1. Removed from Repository (+ cascaded Release / favorites)
 *   2. Recorded on ScrapeRecord as skipped_non_app or skipped_no_assets
 *
 * Usage:
 *   pnpm hide:non-apps              # dry-run
 *   pnpm hide:non-apps -- --apply   # delete + mark skipped
 *   pnpm hide:non-apps -- --limit 50
 *   pnpm hide:non-apps -- --json out.json
 */
import "dotenv/config"

import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { prisma } from "../lib/db.js"
import {
  evaluateNonApp,
  SKIPPED_NON_APP_REASON,
  SKIPPED_NON_APP_STATUS,
  type NonAppMatch,
} from "../lib/non-app.js"
import {
  hasUsableInstallers,
  SKIPPED_NO_ASSETS_REASON,
  SKIPPED_NO_ASSETS_STATUS,
} from "../lib/platforms.js"

type Args = {
  apply: boolean
  limit: number | null
  jsonPath: string | null
}

type PurgeMatch = NonAppMatch & {
  scrapeStatus: string
  scrapeReason: string
}

function parseArgs(argv: string[]): Args {
  let apply = false
  let limit: number | null = null
  let jsonPath: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--apply") apply = true
    else if (arg === "--dry-run") apply = false
    else if (arg === "--limit") {
      limit = Math.max(1, Number(argv[++i]) || 1)
    } else if (arg === "--json") {
      jsonPath = argv[++i] ?? null
    }
  }

  return { apply, limit, jsonPath }
}

function fromRepo(repo: {
  id: string
  fullName: string
  name: string
  description: string | null
  topics: unknown
  platforms: unknown
  stars: number
  hasWindows: boolean
  hasMacos: boolean
  hasLinux: boolean
  hasAndroid: boolean
  hasIos: boolean
  hidden: boolean
  hiddenReason: string | null
  latestRelease: { assets: unknown } | null
}): PurgeMatch | null {
  const platforms = Array.isArray(repo.platforms)
    ? (repo.platforms as string[])
    : []
  const assets = repo.latestRelease?.assets ?? []

  // Empty / curation-stripped installers (e.g. only niche arches, unlabeled zips)
  if (!hasUsableInstallers(assets)) {
    return {
      id: repo.id,
      fullName: repo.fullName,
      name: repo.name,
      description: repo.description,
      platforms,
      stars: repo.stars,
      reasons: ["no-usable-installers"],
      rules: ["assets:empty-or-filtered"],
      sampleAssets: [],
      scrapeStatus: SKIPPED_NO_ASSETS_STATUS,
      scrapeReason: SKIPPED_NO_ASSETS_REASON,
    }
  }

  const match = evaluateNonApp({
    id: repo.id,
    fullName: repo.fullName,
    name: repo.name,
    description: repo.description,
    topics: repo.topics,
    platforms: repo.platforms,
    stars: repo.stars,
    hasWindows: repo.hasWindows,
    hasMacos: repo.hasMacos,
    hasLinux: repo.hasLinux,
    hasAndroid: repo.hasAndroid,
    hasIos: repo.hasIos,
    assets,
  })
  if (match) {
    return {
      ...match,
      scrapeStatus: SKIPPED_NON_APP_STATUS,
      scrapeReason: SKIPPED_NON_APP_REASON,
    }
  }

  // Prior soft-hide run — still purge even if heuristics drifted
  const reason = repo.hiddenReason ?? ""
  if (
    repo.hidden &&
    (reason.includes("non-app") || reason.includes("cli/server"))
  ) {
    return {
      id: repo.id,
      fullName: repo.fullName,
      name: repo.name,
      description: repo.description,
      platforms,
      stars: repo.stars,
      reasons: ["prior-soft-hide"],
      rules: ["legacy:hidden-non-app"],
      sampleAssets: [],
      scrapeStatus: SKIPPED_NON_APP_STATUS,
      scrapeReason: SKIPPED_NON_APP_REASON,
    }
  }

  return null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const repos = await prisma.repository.findMany({
    where: { latestRelease: { isNot: null } },
    include: { latestRelease: true },
    orderBy: { stars: "desc" },
  })

  let matches = repos
    .map((r) => fromRepo(r))
    .filter((m): m is PurgeMatch => m != null)

  const totalMatches = matches.length
  const noAssets = matches.filter((m) =>
    m.rules.includes("assets:empty-or-filtered")
  ).length
  const nonApps = totalMatches - noAssets
  const alreadyHidden = matches.filter((m) => {
    const repo = repos.find((r) => r.id === m.id)
    return Boolean(repo?.hidden)
  }).length
  const visible = totalMatches - alreadyHidden

  if (args.limit != null) matches = matches.slice(0, args.limit)

  console.log(
    `Scanned ${repos.length} catalog repos → ${totalMatches} matches (${noAssets} no installers, ${nonApps} non-app; ${visible} visible, ${alreadyHidden} already hidden)`
  )
  if (args.limit != null && matches.length < totalMatches) {
    console.log(`Showing first ${matches.length} (--limit)`)
  }
  console.log(
    args.apply
      ? "Mode: APPLY (delete repos + mark scrape ledger)"
      : "Mode: dry-run"
  )
  console.log("")

  for (const m of matches) {
    const repo = repos.find((r) => r.id === m.id)
    const flag = repo?.hidden ? " [hidden]" : ""
    console.log(
      `${m.fullName.padEnd(42)} ★${String(m.stars).padStart(6)}${flag}  ${m.rules.join(" | ")} → ${m.scrapeStatus}`
    )
    console.log(`  reasons: ${m.reasons.join(", ")}`)
    if (m.description) {
      console.log(`  ${m.description.slice(0, 100)}`)
    }
  }

  if (args.jsonPath) {
    await writeFile(args.jsonPath, JSON.stringify(matches, null, 2), "utf8")
    console.log(`\nWrote ${matches.length} matches → ${args.jsonPath}`)
  }

  if (!args.apply) {
    console.log(
      `\nDry-run only. Re-run with --apply to remove these and mark scrape status.`
    )
    return
  }

  let removed = 0
  for (const m of matches) {
    if (!m.id) continue

    await prisma.$transaction(async (tx) => {
      await tx.repository.delete({ where: { id: m.id } })
      await tx.scrapeRecord.upsert({
        where: { fullName: m.fullName },
        create: {
          fullName: m.fullName,
          status: m.scrapeStatus,
          reason: m.scrapeReason,
          repositoryId: null,
        },
        update: {
          status: m.scrapeStatus,
          reason: m.scrapeReason,
          repositoryId: null,
          lastSeenAt: new Date(),
        },
      })
    })
    removed += 1
  }

  console.log(
    `\nRemoved ${removed} repositories (releases cascaded). Scrape ledger updated.`
  )
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  main()
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
