#!/usr/bin/env tsx
/**
 * Discover GitHub repos from curated awesome-lists, then optionally import
 * them into the catalog (desktop releases only — ingest skips the rest).
 *
 * Default sources:
 *   - mustbeperfect/definitive-opensource
 *   - Axorax/awesome-free-apps
 *   - 0PandaDEV/awesome-windows
 *   - awesome-selfhosted/awesome-selfhosted
 *
 * Usage:
 *   pnpm scrape:lists
 *   pnpm scrape:lists -- --dry-run
 *   pnpm scrape:lists -- --out scraper/awesome-lists-links.txt
 *   pnpm scrape:lists -- --import
 *   pnpm scrape:lists -- --import --delay 600 --max 50
 */
import "dotenv/config"

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_OUT = path.join(ROOT, "scraper", "awesome-lists-links.txt")

type ListSource = {
  owner: string
  name: string
  /** Extra markdown paths besides README.md */
  files?: string[]
  note?: string
}

const DEFAULT_SOURCES: ListSource[] = [
  {
    owner: "mustbeperfect",
    name: "definitive-opensource",
    note: "Consumer-facing open source apps",
  },
  {
    owner: "Axorax",
    name: "awesome-free-apps",
    note: "Free PC / mobile apps (mixed freemium)",
  },
  {
    owner: "0PandaDEV",
    name: "awesome-windows",
    note: "Windows tools & apps",
  },
  {
    owner: "awesome-selfhosted",
    name: "awesome-selfhosted",
    files: ["README.md", "non-free.md"],
    note: "Self-hosted services — many won’t have desktop installers",
  },
]

/** GitHub tree paths / owners that are never catalog software. */
const BLOCKED_OWNERS = new Set([
  "github",
  "sponsors",
  "orgs",
  "marketplace",
  "settings",
  "topics",
  "collections",
  "enterprise",
  "readme",
  "git-guides",
  "about",
  "features",
  "customer-stories",
  "security",
  "pricing",
  "team",
  "enterprise",
  "site",
])

const BLOCKED_REPOS = new Set([
  ".github",
  "github",
  "docs",
  "community",
  "sponsorships",
])

const REPO_URL_RE =
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi

type Args = {
  out: string
  dryRun: boolean
  doImport: boolean
  delayMs: number
  max: number | null
  refresh: boolean
}

function parseArgs(argv: string[]): Args {
  let out = DEFAULT_OUT
  let dryRun = false
  let doImport = false
  let delayMs = 600
  let max: number | null = null
  let refresh = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--out" || arg === "-o") {
      out = path.resolve(argv[++i] ?? DEFAULT_OUT)
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--import") {
      doImport = true
    } else if (arg === "--delay") {
      delayMs = Math.max(0, Number(argv[++i]) || 0)
    } else if (arg === "--max") {
      max = Math.max(1, Number(argv[++i]) || 1)
    } else if (arg === "--refresh") {
      refresh = true
    }
  }

  return { out, dryRun, doImport, delayMs, max, refresh }
}

function normalizeRepoName(name: string) {
  return name.replace(/\.git$/i, "").replace(/[?#].*$/, "")
}

function isListMetaRepo(owner: string, name: string): boolean {
  const full = `${owner}/${name}`.toLowerCase()
  return DEFAULT_SOURCES.some(
    (s) => `${s.owner}/${s.name}`.toLowerCase() === full
  )
}

function shouldKeep(owner: string, name: string): boolean {
  const o = owner.toLowerCase()
  const n = normalizeRepoName(name).toLowerCase()
  if (!o || !n) return false
  if (BLOCKED_OWNERS.has(o)) return false
  if (BLOCKED_REPOS.has(n)) return false
  if (n === "awesome" || n.startsWith("awesome-") || n.endsWith("-awesome")) {
    // Meta list repos rarely ship desktop installers
    return false
  }
  if (isListMetaRepo(owner, name)) return false
  // Skip obvious non-repo path segments captured from bad URLs
  if (
    ["blob", "tree", "commit", "issues", "pull", "releases", "wiki", "actions"].includes(
      n
    )
  ) {
    return false
  }
  return true
}

function extractRepos(markdown: string): string[] {
  const found = new Set<string>()
  for (const match of markdown.matchAll(REPO_URL_RE)) {
    const owner = match[1]!
    const name = normalizeRepoName(match[2]!)
    if (!shouldKeep(owner, name)) continue
    found.add(`${owner}/${name}`)
  }
  return [...found]
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "open-releases-awesome-list-scraper",
      Accept: "text/plain,text/markdown,*/*",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  })
  if (!res.ok) return null
  return res.text()
}

async function fetchSourceMarkdown(
  source: ListSource
): Promise<{ files: Array<{ path: string; text: string }>; branch: string }> {
  const files = source.files?.length ? source.files : ["README.md"]
  const branches = ["master", "main"]

  for (const branch of branches) {
    const loaded: Array<{ path: string; text: string }> = []
    for (const file of files) {
      const url = `https://raw.githubusercontent.com/${source.owner}/${source.name}/${branch}/${file}`
      const text = await fetchText(url)
      if (text) loaded.push({ path: file, text })
    }
    if (loaded.length) {
      return { files: loaded, branch }
    }
  }

  // Fallback: GitHub Contents API for default branch README
  const api = `https://api.github.com/repos/${source.owner}/${source.name}/readme`
  const res = await fetch(api, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      "User-Agent": "open-releases-awesome-list-scraper",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  })
  if (!res.ok) {
    throw new Error(
      `Could not fetch README for ${source.owner}/${source.name} (${res.status})`
    )
  }
  return {
    files: [{ path: "README.md", text: await res.text() }],
    branch: "default",
  }
}

function runImport(file: string, args: Args): Promise<number> {
  const importArgs = [file]
  if (args.delayMs) importArgs.push("--delay", String(args.delayMs))
  if (args.max) importArgs.push("--max", String(args.max))
  if (args.refresh) importArgs.push("--refresh")
  if (args.dryRun) importArgs.push("--dry-run")

  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "tsx", "scripts/import-links.ts", ...importArgs],
      {
        cwd: ROOT,
        stdio: "inherit",
        shell: true,
        env: process.env,
      }
    )
    child.on("error", reject)
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log("Scrape GitHub repos from awesome-lists")
  console.log(`  sources: ${DEFAULT_SOURCES.length}`)
  console.log(`  out:     ${args.out}`)
  console.log(`  import:  ${args.doImport}`)
  console.log(`  dry-run: ${args.dryRun}`)

  const bySource = new Map<string, string[]>()
  const all = new Map<string, string>() // lower -> canonical owner/name

  for (const source of DEFAULT_SOURCES) {
    const label = `${source.owner}/${source.name}`
    process.stdout.write(`\nFetching ${label}… `)
    try {
      const { files, branch } = await fetchSourceMarkdown(source)
      const repos: string[] = []
      for (const file of files) {
        repos.push(...extractRepos(file.text))
      }
      const unique = [...new Set(repos)]
      bySource.set(label, unique)
      for (const full of unique) {
        const key = full.toLowerCase()
        if (!all.has(key)) all.set(key, full)
      }
      console.log(
        `ok (${branch}, ${files.map((f) => f.path).join("+")}) → ${unique.length} repos`
      )
      if (source.note) console.log(`  note: ${source.note}`)
    } catch (error) {
      console.log("failed")
      console.warn(
        `  ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const sorted = [...all.values()].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  )

  console.log(`\nUnique GitHub repos across lists: ${sorted.length}`)
  for (const [label, repos] of bySource) {
    console.log(`  ${label}: ${repos.length}`)
  }

  const header = [
    `# Auto-generated by scripts/scrape-awesome-lists.ts`,
    `# ${new Date().toISOString()}`,
    `# ${sorted.length} unique repos from:`,
    ...DEFAULT_SOURCES.map((s) => `#   - ${s.owner}/${s.name}`),
    `#`,
    `# Re-run: pnpm scrape:lists`,
    `# Import:  pnpm scrape:lists -- --import`,
    ``,
  ].join("\n")

  const body = sorted
    .map((full) => `https://github.com/${full}`)
    .join("\n")

  if (args.dryRun && !args.doImport) {
    console.log("\nDry-run: not writing file. Sample:")
    for (const full of sorted.slice(0, 15)) {
      console.log(`  https://github.com/${full}`)
    }
    if (sorted.length > 15) console.log(`  … +${sorted.length - 15} more`)
    return
  }

  await mkdir(path.dirname(args.out), { recursive: true })
  await writeFile(args.out, `${header}${body}\n`, "utf8")
  console.log(`\nWrote ${sorted.length} links → ${args.out}`)

  if (!args.doImport) {
    console.log("\nNext: pnpm import:links -- " + path.relative(ROOT, args.out))
    console.log("  or:  pnpm scrape:lists -- --import")
    return
  }

  console.log("\nStarting catalog import (desktop-release filter applies)…\n")
  const code = await runImport(args.out, args)
  process.exit(code)
}

main().catch((error) => {
  console.error(
    "\nScrape failed:",
    error instanceof Error ? error.message : error
  )
  process.exit(1)
})
