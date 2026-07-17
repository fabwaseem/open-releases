/**
 * Directory ranking score (0–100).
 *
 * Goals:
 * 1. Fresh, actively maintained releases surface — not only mega-star repos.
 * 2. New / unknown repos (including 0★) get a fair discovery window.
 * 3. If they age without star momentum, score decays and they sink naturally.
 *
 * Pipeline:
 *   core        — release freshness, cadence, commits, contributors, issues
 *   momentum    — stars gained / 30d (0★ newcomers aren't punished here)
 *   discovery   — age-based boost × activity gate (young + shipping)
 *   stagnation  — after a grace period, flat star growth shrinks the score
 *
 * final = clamp01(core + discovery) * stagnation * 100
 */

export const SCORE_WEIGHTS = {
  /** Latest release freshness (exponential decay). */
  releaseRecency: 0.28,
  /** Commits in the last ~30 days. */
  recentCommits: 0.18,
  /** Star growth rate (not absolute stars). */
  starMomentum: 0.18,
  /** Weighted release cadence. */
  releaseFrequency: 0.12,
  /** New contributors since last scrape. */
  contributorGrowth: 0.08,
  /** Open issues — weak community signal only. */
  issueActivity: 0.06,
  /** Discovery boost for young unknown projects. */
  discovery: 0.1,
} as const

const WEIGHT_SUM =
  SCORE_WEIGHTS.releaseRecency +
  SCORE_WEIGHTS.recentCommits +
  SCORE_WEIGHTS.starMomentum +
  SCORE_WEIGHTS.releaseFrequency +
  SCORE_WEIGHTS.contributorGrowth +
  SCORE_WEIGHTS.issueActivity +
  SCORE_WEIGHTS.discovery

/** Soft-caps for log normalization (values near cap → ~1.0). */
const SOFT_CAPS = {
  starMomentum: 120,
  releaseFrequency: 3,
  recentCommits: 80,
  contributorGrowth: 40,
  issueActivity: 120,
} as const

/** Latest release is ~half weight at this age (days). */
const RELEASE_RECENCY_HALF_LIFE_DAYS = 24

/** GitHub-repo / catalog age: discovery boost half-life (days). */
const DISCOVERY_HALF_LIFE_DAYS = 45

/** Days before stagnation can start reducing the score. */
const STAGNATION_GRACE_DAYS = 60

/** After grace, flat-momentum repos fade with this half-life (days). */
const STAGNATION_HALF_LIFE_DAYS = 90

/** Floor so stagnant repos don't vanish entirely from the catalog ranking. */
const STAGNATION_FLOOR = 0.32

/** Star momentum above this (per 30d, normalized units) skips stagnation. */
const STAGNATION_MOMENTUM_ESCAPE = 2

export type ScoreInputs = {
  /** Stars gained per 30 days (time-normalized when rescored). */
  starMomentum: number
  /** Absolute star count — used only for newcomer/stagnation context. */
  stars: number
  /** Repo age in days (GitHub created_at), null if unknown. */
  repoAgeDays: number | null
  /** Days since the repo entered our catalog, null if brand-new insert. */
  catalogAgeDays: number | null
  /** Weighted releases per month over the recent window. */
  releaseFrequency: number
  /** 0–1 freshness of the latest release. */
  releaseRecency: number
  /** Commits in the last ~30 days. */
  recentCommits: number
  /** New contributors since last scrape. */
  contributorGrowth: number
  /** Open issues. */
  issueActivity: number
}

export type ScoreBreakdown = {
  score: number
  /** Alias stored as scoreNewStars in DB (momentumignal). */
  newStars: number
  releaseFrequency: number
  releaseRecency: number
  recentCommits: number
  contributorGrowth: number
  issueActivity: number
  discovery: number
  stagnation: number
  normalized: {
    starMomentum: number
    releaseFrequency: number
    releaseRecency: number
    recentCommits: number
    contributorGrowth: number
    issueActivity: number
    discovery: number
  }
}

export type RepositoryScoreFields = {
  activityScore: number
  scoreNewStars: number
  scoreReleaseFrequency: number
  scoreRecentCommits: number
  scoreContributorGrowth: number
  scoreIssueActivity: number
  previousStars: number
  previousContributors: number
  contributorsCount: number
  scoredAt: Date
}

function clamp01(n: number) {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(1, n)
}

function ageDays(from: Date | null | undefined, now = Date.now()): number | null {
  if (!from) return null
  const t = from.getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, (now - t) / 86_400_000)
}

/** Log-scale normalize so mega-repos don't dominate forever. */
export function normalizeSignal(value: number, softCap: number): number {
  if (!Number.isFinite(value) || value <= 0 || softCap <= 0) return 0
  return clamp01(Math.log1p(value) / Math.log1p(softCap))
}

/** 1 when just released → ~0 as it ages. */
export function releaseRecencyScore(
  publishedAt: string | Date | null | undefined,
  halfLifeDays = RELEASE_RECENCY_HALF_LIFE_DAYS
): number {
  if (!publishedAt) return 0
  const t =
    publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(publishedAt)
  if (!Number.isFinite(t)) return 0
  const days = (Date.now() - t) / 86_400_000
  if (days <= 0) return 1
  return Math.exp((-Math.LN2 * days) / halfLifeDays)
}

/**
 * Youth curve: 1 at birth, ~0.5 at halfLife, → 0 for old projects.
 * Uses the younger of GitHub age vs catalog age so newly listed unknowns
 * still get a window even if the GitHub repo itself is older.
 */
export function youthScore(
  repoAgeDays: number | null,
  catalogAgeDays: number | null,
  halfLifeDays = DISCOVERY_HALF_LIFE_DAYS
): number {
  const ages = [repoAgeDays, catalogAgeDays].filter(
    (d): d is number => d != null && Number.isFinite(d)
  )
  if (!ages.length) {
    // Unknown age — treat as moderately new so first inserts aren't zeroed.
    return 0.55
  }
  const age = Math.min(...ages)
  return Math.exp((-Math.LN2 * age) / halfLifeDays)
}

/**
 * Activity gate so abandoned shells don't ride the discovery boost.
 * Needs a recent release and/or recent commits.
 */
export function activityGate(input: {
  releaseRecency: number
  recentCommits: number
  releaseFrequency: number
}): number {
  const commits = normalizeSignal(input.recentCommits, SOFT_CAPS.recentCommits)
  const cadence = normalizeSignal(
    input.releaseFrequency,
    SOFT_CAPS.releaseFrequency
  )
  return clamp01(
    Math.max(input.releaseRecency, commits * 0.85, cadence * 0.7)
  )
}

/**
 * Discovery boost for young unknown projects (including 0★).
 * Decays with age; requires shipping activity.
 */
export function discoveryBoost(input: {
  repoAgeDays: number | null
  catalogAgeDays: number | null
  releaseRecency: number
  recentCommits: number
  releaseFrequency: number
  stars: number
}): number {
  const youth = youthScore(input.repoAgeDays, input.catalogAgeDays)
  const gate = activityGate(input)
  // Slight extra lift for truly unknown (0–25★) active projects.
  const unknownLift =
    input.stars <= 25 ? 1 : input.stars <= 100 ? 0.85 : 0.65
  return clamp01(youth * Math.max(gate, 0.15) * unknownLift)
}

/**
 * After a grace period, repos with no star momentum fade.
 * Active star growth escapes the penalty entirely.
 */
export function stagnationMultiplier(input: {
  repoAgeDays: number | null
  catalogAgeDays: number | null
  starMomentum: number
}): number {
  const ages = [input.repoAgeDays, input.catalogAgeDays].filter(
    (d): d is number => d != null && Number.isFinite(d)
  )
  const age = ages.length ? Math.max(...ages) : 0

  if (age < STAGNATION_GRACE_DAYS) return 1
  if (input.starMomentum >= STAGNATION_MOMENTUM_ESCAPE) return 1

  const overdue = age - STAGNATION_GRACE_DAYS
  // Milder fade if there is tiny momentum; harder fade if fully flat.
  const momentumRelief = clamp01(
    input.starMomentum / STAGNATION_MOMENTUM_ESCAPE
  )
  const fade = Math.exp((-Math.LN2 * overdue) / STAGNATION_HALF_LIFE_DAYS)
  const multiplier =
    STAGNATION_FLOOR +
    (1 - STAGNATION_FLOOR) * (fade * (0.55 + 0.45 * momentumRelief))
  return Math.min(1, Math.max(STAGNATION_FLOOR, multiplier))
}

export function computeActivityScore(raw: ScoreInputs): ScoreBreakdown {
  const discovery = discoveryBoost({
    repoAgeDays: raw.repoAgeDays,
    catalogAgeDays: raw.catalogAgeDays,
    releaseRecency: raw.releaseRecency,
    recentCommits: raw.recentCommits,
    releaseFrequency: raw.releaseFrequency,
    stars: raw.stars,
  })

  const normalized = {
    starMomentum: normalizeSignal(raw.starMomentum, SOFT_CAPS.starMomentum),
    releaseFrequency: normalizeSignal(
      raw.releaseFrequency,
      SOFT_CAPS.releaseFrequency
    ),
    releaseRecency: clamp01(raw.releaseRecency),
    recentCommits: normalizeSignal(
      raw.recentCommits,
      SOFT_CAPS.recentCommits
    ),
    contributorGrowth: normalizeSignal(
      raw.contributorGrowth,
      SOFT_CAPS.contributorGrowth
    ),
    issueActivity: normalizeSignal(
      raw.issueActivity,
      SOFT_CAPS.issueActivity
    ),
    discovery,
  }

  const weighted =
    normalized.releaseRecency * SCORE_WEIGHTS.releaseRecency +
    normalized.recentCommits * SCORE_WEIGHTS.recentCommits +
    normalized.starMomentum * SCORE_WEIGHTS.starMomentum +
    normalized.releaseFrequency * SCORE_WEIGHTS.releaseFrequency +
    normalized.contributorGrowth * SCORE_WEIGHTS.contributorGrowth +
    normalized.issueActivity * SCORE_WEIGHTS.issueActivity +
    normalized.discovery * SCORE_WEIGHTS.discovery

  const core = weighted / WEIGHT_SUM
  const stagnation = stagnationMultiplier({
    repoAgeDays: raw.repoAgeDays,
    catalogAgeDays: raw.catalogAgeDays,
    starMomentum: raw.starMomentum,
  })

  const score = Math.round(clamp01(core) * stagnation * 1000) / 10

  return {
    score,
    newStars: raw.starMomentum,
    releaseFrequency: raw.releaseFrequency,
    releaseRecency: raw.releaseRecency,
    recentCommits: raw.recentCommits,
    contributorGrowth: raw.contributorGrowth,
    issueActivity: raw.issueActivity,
    discovery,
    stagnation,
    normalized,
  }
}

/**
 * First-scrape proxy for star momentum.
 * 0★ young repos return a small synthetic floor so they aren't locked at 0
 * on the momentum axis — discovery boost does the heavy lifting, this just
 * avoids a total dead zone until the next rescrape measures real deltas.
 */
export function starVelocityProxy(
  stars: number,
  createdAt: Date | null
): number {
  if (!createdAt) {
    return stars > 0 ? Math.min(stars / 6, SOFT_CAPS.starMomentum) : 0.5
  }
  const ageDays = Math.max(
    14,
    (Date.now() - createdAt.getTime()) / 86_400_000
  )
  if (stars <= 0) {
    // Brand-new unknown: tiny placeholder momentum during grace window.
    return ageDays <= STAGNATION_GRACE_DAYS ? 0.75 : 0
  }
  const per30 = (stars / ageDays) * 30
  return Math.min(per30, SOFT_CAPS.starMomentum)
}

/** Stars gained per 30 days, normalized for scrape interval. */
export function starsGainedPer30Days(
  currentStars: number,
  previousStars: number | null,
  scoredAt: Date | null,
  repoCreatedAt: Date | null
): number {
  if (previousStars != null && scoredAt) {
    const delta = Math.max(0, currentStars - previousStars)
    const days = Math.max(
      1,
      (Date.now() - scoredAt.getTime()) / 86_400_000
    )
    return Math.min((delta / days) * 30, SOFT_CAPS.starMomentum)
  }
  return starVelocityProxy(currentStars, repoCreatedAt)
}

/** Recent releases weigh more than older ones in the window. */
export function releaseFrequencyPerMonth(
  publishedAts: Array<string | Date | null | undefined>,
  windowDays = 180
): number {
  const cutoff = Date.now() - windowDays * 86_400_000
  let weighted = 0

  for (const iso of publishedAts) {
    if (!iso) continue
    const t = iso instanceof Date ? iso.getTime() : Date.parse(iso)
    if (!Number.isFinite(t) || t < cutoff) continue
    const days = (Date.now() - t) / 86_400_000
    const weight = days <= 30 ? 2 : days <= 60 ? 1.5 : 1
    weighted += weight
  }

  return weighted / (windowDays / 30)
}

export function buildRepositoryScoreFields(input: {
  stars: number
  previousStars: number | null
  previousContributors: number | null
  scoredAt: Date | null
  repoCreatedAt: Date | null
  /** When the row first entered our catalog (Repository.createdAt). */
  catalogCreatedAt?: Date | null
  latestReleasePublishedAt: Date | string | null
  releasePublishedAts: Array<string | Date | null | undefined>
  recentCommits: number
  contributorsCount: number
  openIssues: number
}): RepositoryScoreFields {
  const starMomentum = starsGainedPer30Days(
    input.stars,
    input.previousStars,
    input.scoredAt,
    input.repoCreatedAt
  )

  const contributorGrowth =
    input.previousContributors != null
      ? Math.max(0, input.contributorsCount - input.previousContributors)
      : Math.min(input.contributorsCount, 25)

  const breakdown = computeActivityScore({
    starMomentum,
    stars: input.stars,
    repoAgeDays: ageDays(input.repoCreatedAt),
    catalogAgeDays: ageDays(input.catalogCreatedAt ?? null),
    releaseFrequency: releaseFrequencyPerMonth(input.releasePublishedAts),
    releaseRecency: releaseRecencyScore(input.latestReleasePublishedAt),
    recentCommits: input.recentCommits,
    contributorGrowth,
    issueActivity: input.openIssues,
  })

  return {
    activityScore: breakdown.score,
    scoreNewStars: breakdown.newStars,
    scoreReleaseFrequency: breakdown.releaseFrequency,
    scoreRecentCommits: breakdown.recentCommits,
    scoreContributorGrowth: breakdown.contributorGrowth,
    scoreIssueActivity: breakdown.issueActivity,
    previousStars: input.stars,
    previousContributors: input.contributorsCount,
    contributorsCount: input.contributorsCount,
    scoredAt: new Date(),
  }
}
