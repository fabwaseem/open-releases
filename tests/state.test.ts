import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { shardId, type Shard } from "../scripts/scrape/discovery.js"
import {
  clearDiscoveryProgress,
  finishScrapeRun,
  initDiscoveryProgress,
  loadDiscoveryProgress,
  persistShardCompleted,
  persistShardSplit,
  startScrapeRun,
  sweepKeyFor,
} from "../scripts/scrape/state.js"
import { prisma } from "../scripts/scrape/store.js"

// DB-backed: exercises the persistent discovery state against the local
// dev database (DATABASE_URL from .env). Skipped when no DB is configured.
const hasDb = Boolean(process.env.DATABASE_URL)

const shard = (year: number): Shard => ({
  starsMin: 20,
  starsMax: null,
  createdStart: `${year}-01-01`,
  createdEnd: `${year}-12-31`,
})

describe("sweepKeyFor", () => {
  test("is stable and sensitive to the sweep config", () => {
    const a = sweepKeyFor({ minStars: 20, pushedAfter: "2021-01-01", query: "", discovery: "api" })
    const b = sweepKeyFor({ minStars: 20, pushedAfter: "2021-01-01", query: "", discovery: "api" })
    const c = sweepKeyFor({ minStars: 50, pushedAfter: "2021-01-01", query: "", discovery: "api" })
    assert.equal(a, b)
    assert.notEqual(a, c)
  })
})

describe("persistent discovery progress", { skip: !hasDb }, () => {
  const key = `test-sweep-${process.pid}-${Date.now()}`

  test("init → complete → resume → split → clear roundtrip", async () => {
    const shards = [shard(2026), shard(2025), shard(2024)]
    await clearDiscoveryProgress(key)

    assert.equal(await loadDiscoveryProgress(key), null)

    await initDiscoveryProgress(key, shards)
    const fresh = await loadDiscoveryProgress(key)
    assert.ok(fresh)
    assert.equal(fresh.queue.length, 3)
    assert.deepEqual(fresh.completed, [])

    // Complete the first shard; a "restarted" load must not offer it again.
    await persistShardCompleted(key, shards[0]!)
    const resumed = await loadDiscoveryProgress(key)
    assert.ok(resumed)
    assert.equal(resumed.queue.length, 2)
    assert.deepEqual(resumed.completed, [shardId(shards[0]!)])
    assert.equal(shardId(resumed.queue[0]!), shardId(shards[1]!))

    // Split the second shard: parent counts as done, children queue up.
    const children = [
      { ...shards[1]!, createdEnd: "2025-06-30" },
      { ...shards[1]!, createdStart: "2025-07-01" },
    ]
    await persistShardSplit(key, shards[1]!, children)
    const afterSplit = await loadDiscoveryProgress(key)
    assert.ok(afterSplit)
    assert.ok(afterSplit.completed.includes(shardId(shards[1]!)))
    const queuedIds = afterSplit.queue.map((s) => shardId(s))
    assert.ok(queuedIds.includes(shardId(children[0]!)))
    assert.ok(queuedIds.includes(shardId(children[1]!)))
    assert.ok(queuedIds.includes(shardId(shards[2]!)))

    await clearDiscoveryProgress(key)
    assert.equal(await loadDiscoveryProgress(key), null)
  })

  test("scrape run records roundtrip", async () => {
    const id = await startScrapeRun("discover", { test: true })
    assert.ok(id)
    await finishScrapeRun(id, { saved: 3, errors: 0 }, "finished")
    const row = await prisma.scrapeRun.findUnique({ where: { id } })
    assert.ok(row)
    assert.equal(row.status, "finished")
    assert.ok(row.finishedAt)
    assert.deepEqual(row.stats, { saved: 3, errors: 0 })
    await prisma.scrapeRun.delete({ where: { id } })
  })
})
