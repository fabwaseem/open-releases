/**
 * Coarse year shards — no Search API count calls.
 * Process each year via HTML pages; split only when page 100 is full.
 */

export type Shard = {
  starsMin: number
  starsMax: number | null
  createdStart: string
  createdEnd: string
}

export function shardId(s: Shard) {
  return `stars:${s.starsMin}..${s.starsMax ?? "*"}|created:${s.createdStart}..${s.createdEnd}`
}

export function shardQuery(s: Shard, _minStars: number, pushedAfter: string) {
  const stars =
    s.starsMax == null
      ? `stars:>=${s.starsMin}`
      : s.starsMin === s.starsMax
        ? `stars:${s.starsMin}`
        : `stars:${s.starsMin}..${s.starsMax}`
  return [
    `pushed:>=${pushedAfter}`,
    "is:public",
    "mirror:false",
    "archived:false",
    "fork:false",
    stars,
    `created:${s.createdStart}..${s.createdEnd}`,
  ].join(" ")
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
