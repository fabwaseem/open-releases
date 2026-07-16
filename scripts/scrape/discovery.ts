/**
 * Coarse year shards — no Search API count calls.
 * Process each year via HTML pages; split only when page 100 is full.
 *
 * `--query` accepts full GitHub repo search syntax, e.g.:
 *   stars:>100 language:C# archived:false
 *   topic:downloader stars:>=50
 */

export type Shard = {
  starsMin: number
  starsMax: number | null
  createdStart: string
  createdEnd: string
}

export type ParsedSearchQuery = {
  /** User tokens excluding stars:* (shard injects stars). */
  withoutStars: string
  /** Qualifier keys present in the user query (lowercase, no leading -). */
  keys: Set<string>
  /** Minimum stars inferred from stars:* , if any. */
  minStars: number | null
}

export function shardId(s: Shard) {
  return `stars:${s.starsMin}..${s.starsMax ?? "*"}|created:${s.createdStart}..${s.createdEnd}`
}

/** Split a GitHub search string into tokens (keeps language:C# intact). */
export function tokenizeSearchQuery(raw: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (const ch of raw.trim()) {
    if (ch === '"') {
      inQuotes = !inQuotes
      cur += ch
      continue
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function qualifierKey(token: string): string | null {
  const m = /^(-?[a-zA-Z][\w.-]*):/.exec(token)
  if (!m) return null
  return m[1]!.replace(/^-/, "").toLowerCase()
}

/** Infer a floor for sharding from a stars: value. */
export function parseStarsMin(value: string): number | null {
  const v = value.trim()
  if (!v) return null

  const gt = /^>(\d+)$/.exec(v)
  if (gt) return Number(gt[1]) + 1

  const gte = /^>=(\d+)$/.exec(v)
  if (gte) return Number(gte[1])

  const range = /^(\d+|\*)\.\.(\d+|\*)$/.exec(v)
  if (range) {
    const lo = range[1]!
    if (lo === "*") return null
    return Number(lo)
  }

  const exact = /^(\d+)$/.exec(v)
  if (exact) return Number(exact[1])

  return null
}

/**
 * Parse a user `--query` so we can merge it with shard defaults
 * without duplicating stars/archived/fork/etc.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const keys = new Set<string>()
  const kept: string[] = []
  let minStars: number | null = null

  for (const token of tokenizeSearchQuery(raw)) {
    const key = qualifierKey(token)
    if (!key) {
      kept.push(token)
      continue
    }
    keys.add(key)

    if (key === "stars") {
      const value = token.slice(token.indexOf(":") + 1)
      const floor = parseStarsMin(value)
      if (floor != null) {
        minStars = minStars == null ? floor : Math.max(minStars, floor)
      }
      // Drop user stars:* — shardQuery re-injects stars for the current shard.
      continue
    }

    kept.push(token)
  }

  return {
    withoutStars: kept.join(" "),
    keys,
    minStars,
  }
}

function starsClause(s: Shard) {
  if (s.starsMax == null) return `stars:>=${s.starsMin}`
  if (s.starsMin === s.starsMax) return `stars:${s.starsMin}`
  return `stars:${s.starsMin}..${s.starsMax}`
}

/**
 * Build the HTML search `q=` string for one shard.
 * User qualifiers (language:, topic:, archived:, …) are preserved;
 * stars come from the shard; defaults fill only missing filters.
 */
export function shardQuery(
  s: Shard,
  _minStars: number,
  pushedAfter: string,
  searchQuery = ""
) {
  const parsed = parseSearchQuery(searchQuery)
  const parts: string[] = []

  if (parsed.withoutStars) parts.push(parsed.withoutStars)

  if (!parsed.keys.has("pushed")) {
    parts.push(`pushed:>=${pushedAfter}`)
  }
  if (!parsed.keys.has("is")) parts.push("is:public")
  if (!parsed.keys.has("mirror")) parts.push("mirror:false")
  if (!parsed.keys.has("archived")) parts.push("archived:false")
  if (!parsed.keys.has("fork")) parts.push("fork:false")

  parts.push(starsClause(s))
  parts.push(`created:${s.createdStart}..${s.createdEnd}`)

  return parts.filter(Boolean).join(" ")
}

function midDate(a: string, b: string) {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return new Date(ta + Math.floor((tb - ta) / 2)).toISOString().slice(0, 10)
}

function nextDay(iso: string) {
  const d = new Date(Date.parse(iso) + 86_400_000)
  return d.toISOString().slice(0, 10)
}

export function splitShard(s: Shard): Shard[] {
  if (s.createdStart < s.createdEnd) {
    const mid = midDate(s.createdStart, s.createdEnd)
    const rightStart = nextDay(mid)
    if (rightStart <= s.createdEnd) {
      return [
        { ...s, createdEnd: mid },
        { ...s, createdStart: rightStart },
      ]
    }
  }
  if (s.starsMax == null) {
    const hi = Math.max(s.starsMin * 2, s.starsMin + 500)
    return [
      { ...s, starsMax: hi },
      { ...s, starsMin: hi + 1, starsMax: null },
    ]
  }
  if (s.starsMax > s.starsMin) {
    const mid = Math.floor((s.starsMin + s.starsMax) / 2)
    return [
      { ...s, starsMax: mid },
      { ...s, starsMin: mid + 1 },
    ]
  }
  return []
}

/** One shard per calendar year — zero count API calls. */
export function coarseYearShards(minStars: number): Shard[] {
  const now = new Date()
  const endYear = now.getUTCFullYear()
  const today = now.toISOString().slice(0, 10)
  const shards: Shard[] = []
  // Newest years first — more likely desktop apps.
  for (let year = endYear; year >= 2008; year--) {
    shards.push({
      starsMin: minStars,
      starsMax: null,
      createdStart: `${year}-01-01`,
      createdEnd: year === endYear ? today : `${year}-12-31`,
    })
  }
  return shards
}

export class StreamingDiscovery {
  queue: Shard[]
  completed: Set<string>
  minStars: number
  pushedAfter: string

  constructor(opts: {
    minStars: number
    pushedAfter: string
    queue?: Shard[]
    completed?: string[]
  }) {
    this.minStars = opts.minStars
    this.pushedAfter = opts.pushedAfter
    this.queue = opts.queue?.length
      ? opts.queue
      : coarseYearShards(opts.minStars)
    this.completed = new Set(opts.completed ?? [])
  }

  /** Next unfinished shard — no Search count. */
  nextShard(): Shard | null {
    while (this.queue.length) {
      const shard = this.queue.shift()!
      const id = shardId(shard)
      if (this.completed.has(id)) continue
      return shard
    }
    return null
  }

  /** Call when HTML page 100 was still full — shard likely over 1000 hits. */
  requeueSplit(shard: Shard) {
    const children = splitShard(shard)
    if (!children.length) {
      this.completed.add(shardId(shard))
      return
    }
    this.queue.unshift(...children)
  }
}

export function yearsAgo(years = 5) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}
