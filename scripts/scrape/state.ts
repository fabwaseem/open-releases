import { createHash } from "node:crypto"
import { prisma } from "./store.js"
import { shardId, type Shard } from "./discovery.js"

function warn(message: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err)
  console.warn(`${message}: ${detail}`)
}

/**
 * Stable key identifying a discovery sweep configuration.
 * Changing minStars / pushedAfter / mode / query starts a fresh sweep.
 */
export function sweepKeyFor(opts: {
  minStars: number
  pushedAfter: string
  query: string
  discovery: string
}): string {
  const hash = createHash("sha1")
    .update(opts.query ?? "")
    .digest("hex")
    .slice(0, 8)
  return `v1|minStars=${opts.minStars}|pushed=${opts.pushedAfter}|mode=${opts.discovery}|q=${hash}`
}

export async function loadDiscoveryProgress(
  sweepKey: string
): Promise<{ queue: Shard[]; completed: string[] } | null> {
  try {
    const rows = await prisma.discoveryShard.findMany({
      where: { sweepKey },
      orderBy: { position: "asc" },
    })
    if (!rows.length) return null
    const queue = rows
      .filter((r) => r.status === "pending")
      .map((r) => r.shard as unknown as Shard)
    const completed = rows
      .filter((r) => r.status === "completed" || r.status === "split")
      .map((r) => r.shardId)
    return { queue, completed }
  } catch (err) {
    warn("loadDiscoveryProgress failed", err)
    return null
  }
}

export async function initDiscoveryProgress(
  sweepKey: string,
  shards: Shard[]
): Promise<void> {
  try {
    const existing = await prisma.discoveryShard.count({
      where: { sweepKey },
    })
    if (existing > 0) return
    if (!shards.length) return
    await prisma.discoveryShard.createMany({
      data: shards.map((shard, i) => ({
        sweepKey,
        shardId: shardId(shard),
        shard: shard as unknown as object,
        status: "pending",
        position: i,
      })),
      skipDuplicates: true,
    })
  } catch (err) {
    warn("initDiscoveryProgress failed", err)
  }
}

async function nextPosition(sweepKey: string): Promise<number> {
  const agg = await prisma.discoveryShard.aggregate({
    where: { sweepKey },
    _max: { position: true },
  })
  return (agg._max.position ?? -1) + 1
}

export async function persistShardCompleted(
  sweepKey: string,
  shard: Shard
): Promise<void> {
  try {
    const id = shardId(shard)
    const existing = await prisma.discoveryShard.findUnique({
      where: { sweepKey_shardId: { sweepKey, shardId: id } },
      select: { id: true },
    })
    if (existing) {
      await prisma.discoveryShard.update({
        where: { sweepKey_shardId: { sweepKey, shardId: id } },
        data: { status: "completed", shard: shard as unknown as object },
      })
      return
    }
    const position = await nextPosition(sweepKey)
    await prisma.discoveryShard.create({
      data: {
        sweepKey,
        shardId: id,
        shard: shard as unknown as object,
        status: "completed",
        position,
      },
    })
  } catch (err) {
    warn("persistShardCompleted failed", err)
  }
}

export async function persistShardSplit(
  sweepKey: string,
  parent: Shard,
  children: Shard[]
): Promise<void> {
  try {
    const parentId = shardId(parent)
    const existing = await prisma.discoveryShard.findUnique({
      where: { sweepKey_shardId: { sweepKey, shardId: parentId } },
      select: { id: true },
    })
    if (existing) {
      await prisma.discoveryShard.update({
        where: { sweepKey_shardId: { sweepKey, shardId: parentId } },
        data: { status: "split", shard: parent as unknown as object },
      })
    } else {
      const position = await nextPosition(sweepKey)
      await prisma.discoveryShard.create({
        data: {
          sweepKey,
          shardId: parentId,
          shard: parent as unknown as object,
          status: "split",
          position,
        },
      })
    }
    if (!children.length) return
    // Children are appended after the current max position. The in-memory
    // queue unshifts them so they run next; persistence order only matters
    // for resume ordering, where appending is acceptable.
    const start = await nextPosition(sweepKey)
    await prisma.discoveryShard.createMany({
      data: children.map((child, i) => ({
        sweepKey,
        shardId: shardId(child),
        shard: child as unknown as object,
        status: "pending",
        position: start + i,
      })),
      skipDuplicates: true,
    })
  } catch (err) {
    warn("persistShardSplit failed", err)
  }
}

export async function persistShardFailed(
  sweepKey: string,
  shard: Shard
): Promise<void> {
  try {
    const id = shardId(shard)
    const existing = await prisma.discoveryShard.findUnique({
      where: { sweepKey_shardId: { sweepKey, shardId: id } },
      select: { id: true, attempts: true },
    })
    if (existing) {
      await prisma.discoveryShard.update({
        where: { sweepKey_shardId: { sweepKey, shardId: id } },
        data: { status: "failed", attempts: existing.attempts + 1 },
      })
      return
    }
    const position = await nextPosition(sweepKey)
    await prisma.discoveryShard.create({
      data: {
        sweepKey,
        shardId: id,
        shard: shard as unknown as object,
        status: "failed",
        position,
        attempts: 1,
      },
    })
  } catch (err) {
    warn("persistShardFailed failed", err)
  }
}

export async function clearDiscoveryProgress(sweepKey: string): Promise<void> {
  try {
    await prisma.discoveryShard.deleteMany({ where: { sweepKey } })
  } catch (err) {
    warn("clearDiscoveryProgress failed", err)
  }
}

export async function startScrapeRun(
  kind: string,
  meta: object
): Promise<string> {
  try {
    const row = await prisma.scrapeRun.create({
      data: {
        kind,
        status: "running",
        meta: meta as unknown as object,
        stats: {} as unknown as object,
      },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    warn("startScrapeRun failed", err)
    return ""
  }
}

export async function finishScrapeRun(
  id: string,
  stats: object,
  status: "finished" | "failed"
): Promise<void> {
  if (!id) return
  try {
    await prisma.scrapeRun.update({
      where: { id },
      data: {
        status,
        stats: stats as unknown as object,
        finishedAt: new Date(),
      },
    })
  } catch (err) {
    warn("finishScrapeRun failed", err)
  }
}
