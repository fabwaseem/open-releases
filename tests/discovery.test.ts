import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  StreamingDiscovery,
  coarseYearShards,
  isRevalidationEligible,
  parseSearchQuery,
  shardId,
  shardQuery,
  splitShard,
  type Shard,
} from "../scripts/scrape/discovery.js"

const DAY = 86_400_000

describe("parseSearchQuery", () => {
  test("extracts a stars floor and keeps other qualifiers", () => {
    const p = parseSearchQuery("stars:>100 language:C# archived:false")
    assert.equal(p.minStars, 101)
    assert.equal(p.withoutStars, "language:C# archived:false")
    assert.ok(p.keys.has("stars"))
    assert.ok(p.keys.has("language"))
  })

  test("handles >= and ranges", () => {
    assert.equal(parseSearchQuery("topic:downloader stars:>=50").minStars, 50)
    assert.equal(parseSearchQuery("stars:10..200").minStars, 10)
    assert.equal(parseSearchQuery("stars:*..200").minStars, null)
  })

  test("plain text passes through untouched", () => {
    const p = parseSearchQuery("hello world")
    assert.equal(p.minStars, null)
    assert.equal(p.withoutStars, "hello world")
    assert.equal(p.keys.size, 0)
  })
})

describe("shardQuery", () => {
  const shard: Shard = {
    starsMin: 20,
    starsMax: null,
    createdStart: "2024-01-01",
    createdEnd: "2024-12-31",
  }

  test("injects shard stars + created range and safe defaults", () => {
    const q = shardQuery(shard, 20, "2021-01-01")
    assert.match(q, /stars:>=20/)
    assert.match(q, /created:2024-01-01\.\.2024-12-31/)
    assert.match(q, /pushed:>=2021-01-01/)
    assert.match(q, /is:public/)
    assert.match(q, /archived:false/)
    assert.match(q, /fork:false/)
  })

  test("bounded star range renders as a range clause", () => {
    const q = shardQuery({ ...shard, starsMax: 99 }, 20, "2021-01-01")
    assert.match(q, /stars:20\.\.99/)
  })

  test("user qualifiers suppress the defaults they replace", () => {
    const q = shardQuery(shard, 20, "2021-01-01", "archived:true language:Rust")
    assert.match(q, /archived:true/)
    assert.doesNotMatch(q, /archived:false/)
    assert.match(q, /language:Rust/)
  })
})

describe("splitShard", () => {
  test("date split tiles the range with no gap and no overlap", () => {
    const s: Shard = {
      starsMin: 20,
      starsMax: null,
      createdStart: "2024-01-01",
      createdEnd: "2024-12-31",
    }
    const [a, b] = splitShard(s)
    assert.ok(a && b)
    assert.equal(a.createdStart, s.createdStart)
    assert.equal(b.createdEnd, s.createdEnd)
    // b starts the day after a ends — contiguous, disjoint.
    assert.equal(
      Date.parse(b.createdStart) - Date.parse(a.createdEnd),
      DAY
    )
    assert.equal(a.starsMin, s.starsMin)
    assert.equal(b.starsMin, s.starsMin)
  })

  test("repeated date splits tile a leap year into single days", () => {
    let frontier: Shard[] = [
      {
        starsMin: 20,
        starsMax: null,
        createdStart: "2020-01-01",
        createdEnd: "2020-12-31",
      },
    ]
    // Split only multi-day shards (splitShard prefers date splits).
    for (let i = 0; i < 20; i++) {
      const next: Shard[] = []
      let splitAny = false
      for (const s of frontier) {
        if (s.createdStart < s.createdEnd) {
          next.push(...splitShard(s))
          splitAny = true
        } else {
          next.push(s)
        }
      }
      frontier = next
      if (!splitAny) break
    }
    assert.equal(frontier.length, 366)
    const days = new Set(frontier.map((s) => s.createdStart))
    assert.equal(days.size, 366)
    assert.ok(frontier.every((s) => s.createdStart === s.createdEnd))
  })

  test("single-day open-ended shard splits by stars", () => {
    const s: Shard = {
      starsMin: 20,
      starsMax: null,
      createdStart: "2024-06-01",
      createdEnd: "2024-06-01",
    }
    const [a, b] = splitShard(s)
    assert.ok(a && b)
    assert.equal(a.starsMin, 20)
    assert.ok(a.starsMax != null && a.starsMax >= 20)
    assert.equal(b.starsMin, a.starsMax + 1)
    assert.equal(b.starsMax, null)
  })

  test("bounded star range splits at the midpoint, disjointly", () => {
    const s: Shard = {
      starsMin: 20,
      starsMax: 100,
      createdStart: "2024-06-01",
      createdEnd: "2024-06-01",
    }
    const [a, b] = splitShard(s)
    assert.ok(a && b)
    assert.equal(a.starsMax, 60)
    assert.equal(b.starsMin, 61)
    assert.equal(b.starsMax, 100)
  })

  test("a single star on a single day cannot split", () => {
    const s: Shard = {
      starsMin: 20,
      starsMax: 20,
      createdStart: "2024-06-01",
      createdEnd: "2024-06-01",
    }
    assert.deepEqual(splitShard(s), [])
  })
})

describe("StreamingDiscovery resume semantics", () => {
  test("shardId is stable for identical shards", () => {
    const s = coarseYearShards(20)[0]!
    assert.equal(shardId(s), shardId({ ...s }))
  })

  test("default construction starts with the current year", () => {
    const d = new StreamingDiscovery({ minStars: 20, pushedAfter: "2021-01-01" })
    const first = d.nextShard()
    assert.ok(first)
    assert.equal(
      first.createdStart,
      `${new Date().getUTCFullYear()}-01-01`
    )
  })

  test("resumed queue skips completed shards", () => {
    const [a, b] = coarseYearShards(20)
    const d = new StreamingDiscovery({
      minStars: 20,
      pushedAfter: "2021-01-01",
      queue: [a!, b!],
      completed: [shardId(a!)],
    })
    assert.equal(shardId(d.nextShard()!), shardId(b!))
  })
})

describe("isRevalidationEligible", () => {
  const now = new Date("2026-10-21T00:00:00Z")
  const ago = (days: number) => new Date(now.getTime() - days * DAY)
  const opts = { revalidateDays: 7, nonAppDays: 28 }

  test("skips become eligible after the revalidation age", () => {
    assert.equal(isRevalidationEligible("skipped_no_releases", ago(8), now, opts), true)
    assert.equal(isRevalidationEligible("skipped_no_releases", ago(6), now, opts), false)
    assert.equal(isRevalidationEligible("skipped_no_assets", ago(30), now, opts), true)
    assert.equal(isRevalidationEligible("error", ago(7), now, opts), true)
    assert.equal(isRevalidationEligible("error", ago(1), now, opts), false)
  })

  test("non-app uses the longer window", () => {
    assert.equal(isRevalidationEligible("skipped_non_app", ago(8), now, opts), false)
    assert.equal(isRevalidationEligible("skipped_non_app", ago(29), now, opts), true)
  })

  test("terminal states are never eligible", () => {
    for (const status of ["saved", "hidden", "skipped_inactive"]) {
      assert.equal(isRevalidationEligible(status, ago(365), now, opts), false)
    }
  })

  test("stale discovered markers re-enter after a day", () => {
    assert.equal(isRevalidationEligible("discovered", ago(2), now, opts), true)
    assert.equal(isRevalidationEligible("discovered", ago(0.5), now, opts), false)
  })
})
