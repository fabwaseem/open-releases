#!/usr/bin/env tsx
/**
 * Import GitHub repos from a text file into the catalog.
 *
 * Each non-empty, non-comment line may be:
 *   https://github.com/owner/repo
 *   owner/repo
 *
 * Dedupes within the file, skips already-listed repos (unless --refresh),
 * fetches live GitHub data via ingestGithubRepo, retries rate limits.
 *
 * Usage:
 *   pnpm import:links
 *   pnpm import:links -- scraper/links.txt
 *   pnpm import:links -- --file scraper/links.txt --refresh
 *   pnpm import:links -- --delay 750 --dry-run
 */
import "dotenv/config"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { prisma } from "../lib/db.js"
import { GitHubApiError } from "../lib/github-rest.js"
import { ingestGithubRepo } from "../lib/repo-ingest.js"
import { parseGithubRepoInput } from "../lib/repo-url.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_FILE = path.join(ROOT, "scraper", "links.txt")

type Stats = {
  lines: number
  parsed: number
  duplicatesInFile: number
  alreadyListed: number
  added: number
  refreshed: number
  skippedNoReleases: number
  skippedNoAssets: number
  notFound: number
  private: number
  invalid: number
  errors: number
}

type Args = {
  file: string
  delayMs: number
  refresh: boolean
  dryRun: boolean
  max: number | null
}

function parseArgs(argv: string[]): Args {
  let file = DEFAULT_FILE
  let delayMs = 600
  let refresh = false
  let dryRun = false
  let max: number | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--file" || arg === "-f") {
      file = path.resolve(argv[++i] ?? DEFAULT_FILE)
    } else if (arg === "--delay") {
      delayMs = Math.max(0, Number(argv[++i]) || 0)
    } else if (arg === "--refresh") {
      refresh = true
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--max") {
      max = Math.max(1, Number(argv[++i]) || 1)
    } else if (!arg.startsWith("-")) {
      file = path.resolve(arg)
    }
  }

  return { file, delayMs, refresh, dryRun, max }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readEntries(file: string): Promise<{
  entries: Array<{ fullName: string; sourceUrl: string; line: number }>
  stats: Pick<Stats, "lines" | "parsed" | "duplicatesInFile" | "invalid">
}> {
  const text = await readFile(file, "utf8")
  const lines = text.split(/\r?\n/)
  const seen = new Set<string>()
  const entries: Array<{ fullName: string; sourceUrl: string; line: number }> =
    []

  let invalid = 0
  let duplicatesInFile = 0
  let parsed = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith("#")) continue

    const parsedUrl = parseGithubRepoInput(raw)
    if (!parsedUrl) {
      invalid += 1
      console.warn(`  L${i + 1}: invalid — ${raw}`)
      continue
    }

    parsed += 1
    const key = parsedUrl.fullName.toLowerCase()
    if (seen.has(key)) {
      duplicatesInFile += 1
      continue
    }
    seen.add(key)
    entries.push({
      fullName: parsedUrl.fullName,
      sourceUrl: parsedUrl.sourceUrl,
      line: i + 1,
    })
  }

  return {
    entries,
    stats: {
      lines: lines.length,
      parsed,
      duplicatesInFile,
      invalid,
    },
  }
}

function classifyError(message: string): keyof Stats | "retryable" | "other" {
  const m = message.toLowerCase()
  if (m.includes("rate limit")) return "retryable"
  if (m.includes("not found")) return "notFound"
  if (m.includes("private")) return "private"
  if (m.includes("no releases")) return "skippedNoReleases"
  if (
    m.includes("no desktop installer") ||
    m.includes("no desktop assets") ||
    m.includes("no installer assets") ||
    m.includes("no installers found")
  ) {
    return "skippedNoAssets"
  }
  return "other"
}

async function markFailed(
  fullName: string,
  status: string,
  reason: string
) {
  await prisma.scrapeRecord.upsert({
    where: { fullName },
    create: {
      fullName,
      status,
      reason: reason.slice(0, 500),
    },
    update: {
      status,
      reason: reason.slice(0, 500),
      lastSeenAt: new Date(),
    },
  })
}

async function ingestWithRetry(
  fullName: string,
  attempts = 4
): Promise<{ ok: true; stars: number } | { ok: false; message: string }> {
  let lastMessage = "unknown error"

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const row = await ingestGithubRepo(fullName, {
        scrapeReason: "links_import",
      })
      return { ok: true, stars: row.stars }
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
      const kind = classifyError(lastMessage)
      const status =
        error instanceof GitHubApiError ? error.status : undefined

      if (
        kind === "retryable" ||
        status === 403 ||
        status === 429
      ) {
        const wait = Math.min(60_000, 5_000 * 2 ** (attempt - 1))
        console.warn(
          `    rate limit / transient — retry ${attempt}/${attempts} in ${Math.round(wait / 1000)}s`
        )
        await sleep(wait)
        continue
      }

      return { ok: false, message: lastMessage }
    }
  }

  return { ok: false, message: lastMessage }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log("Import repos from links file")
  console.log(`  file:    ${args.file}`)
  console.log(`  delay:   ${args.delayMs}ms`)
  console.log(`  refresh: ${args.refresh}`)
  console.log(`  dry-run: ${args.dryRun}`)
  if (args.max) console.log(`  max:     ${args.max}`)

  const { entries, stats: readStats } = await readEntries(args.file)
  const stats: Stats = {
    ...readStats,
    alreadyListed: 0,
    added: 0,
    refreshed: 0,
    skippedNoReleases: 0,
    skippedNoAssets: 0,
    notFound: 0,
    private: 0,
    errors: 0,
  }

  const work = args.max ? entries.slice(0, args.max) : entries
  console.log(
    `\n${work.length} unique repos to process (${entries.length} after file dedupe)\n`
  )

  for (let i = 0; i < work.length; i++) {
    const entry = work[i]!
    const prefix = `[${i + 1}/${work.length}] ${entry.fullName}`

    const existing = await prisma.repository.findUnique({
      where: { fullName: entry.fullName },
      select: { id: true, hidden: true, stars: true },
    })

    // Case-insensitive fallback (GitHub URLs vary in casing)
    const existingLoose =
      existing ??
      (await prisma.repository.findFirst({
        where: { fullName: { equals: entry.fullName, mode: "insensitive" } },
        select: { id: true, hidden: true, stars: true, fullName: true },
      }))

    if (existingLoose && !existingLoose.hidden && !args.refresh) {
      stats.alreadyListed += 1
      console.log(`${prefix} — already listed, skip`)
      continue
    }

    if (args.dryRun) {
      const action =
        existingLoose && !existingLoose.hidden ? "would refresh" : "would add"
      console.log(`${prefix} — ${action} (dry-run)`)
      if (existingLoose && !existingLoose.hidden) stats.refreshed += 1
      else stats.added += 1
      continue
    }

    const wasListed = Boolean(existingLoose && !existingLoose.hidden)
    process.stdout.write(
      `${prefix} — ${wasListed ? "refreshing" : "fetching"}… `
    )

    const result = await ingestWithRetry(entry.fullName)
    if (result.ok) {
      if (wasListed) {
        stats.refreshed += 1
        console.log(`updated (★ ${result.stars})`)
      } else {
        stats.added += 1
        console.log(`added (★ ${result.stars})`)
      }
    } else {
      const kind = classifyError(result.message)
      if (kind === "notFound") {
        stats.notFound += 1
        await markFailed(entry.fullName, "error", result.message)
        console.log(`not found`)
      } else if (kind === "private") {
        stats.private += 1
        await markFailed(entry.fullName, "error", result.message)
        console.log(`private`)
      } else if (kind === "skippedNoReleases") {
        stats.skippedNoReleases += 1
        await markFailed(entry.fullName, "skipped_no_releases", result.message)
        console.log(`no releases`)
      } else if (kind === "skippedNoAssets") {
        stats.skippedNoAssets += 1
        await markFailed(entry.fullName, "skipped_no_assets", result.message)
        console.log(`no installable assets`)
      } else {
        stats.errors += 1
        await markFailed(entry.fullName, "error", result.message)
        console.log(`error: ${result.message}`)
      }
    }

    if (args.delayMs > 0 && i < work.length - 1) {
      await sleep(args.delayMs)
    }
  }

  console.log("\nDone.")
  console.log(`  lines read:          ${stats.lines}`)
  console.log(`  parsed:              ${stats.parsed}`)
  console.log(`  dupes in file:       ${stats.duplicatesInFile}`)
  console.log(`  invalid lines:       ${stats.invalid}`)
  console.log(`  already listed:      ${stats.alreadyListed}`)
  console.log(`  added:               ${stats.added}`)
  console.log(`  refreshed:           ${stats.refreshed}`)
  console.log(`  no releases:         ${stats.skippedNoReleases}`)
  console.log(`  no desktop assets:   ${stats.skippedNoAssets}`)
  console.log(`  not found:           ${stats.notFound}`)
  console.log(`  private:             ${stats.private}`)
  console.log(`  errors:              ${stats.errors}`)

  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(
    "\nImport failed:",
    error instanceof Error ? error.message : error
  )
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
