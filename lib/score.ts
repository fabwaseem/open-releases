/**
 * Directory ranking score (components normalized 0–1, then weighted).
 *
 * Designed so fresh, actively maintained releases can surface — not only
 * mega-repos with huge star counts.
 *
 * score =
 *   (new stars / 30d × 0.22) +
 *   (latest release recency × 0.25) +
 *   (release cadence × 0.13) +
 *   (recent commits × 0.18) +
 *   (contributor growth × 0.12) +
 *   (issue activity × 0.10)
 */

export const SCORE_WEIGHTS = {
  newStars: 0.22,
  releaseRecency: 0.25,
  releaseFrequency: 0.13,
  recentCommits: 0.18,
  contributorGrowth: 0.12,
  issueActivity: 0.1,
} as const

const WEIGHT_SUM = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)

/** Soft-caps for log normalization (values near cap → ~1.0). */
const SOFT_CAPS = {
  newStars: 250,
  /** weighted releases per month */
  releaseFrequency: 3,
  recentCommits: 80,
  contributorGrowth: 40,
  issueActivity: 150,
} as const

/** Latest release is ~half weight at this age (days). */
const RELEASE_RECENCY_HALF_LIFE_DAYS = 21

export type ScoreInputs = {
  /** Stars gained per 30 days (time-normalized when rescored). */
  newStars: number
  /** Weighted releases per month over the recent window. */
  releaseFrequency: number
  /** 0–1 freshness of the latest release (exponential decay). */
  releaseRecency: number
  /** Commits in the last ~30 days (capped by API page size). */
  recentCommits: number
  /** New contributors since last scrape (or count proxy on first scrape). */
  contributorGrowth: number
  /** Open issues — weak static community signal. */
  issueActivity: number
}

export type ScoreBreakdown = {
  score: number
  newStars: number
  releaseFrequency: number
  releaseRecency: number
  recentCommits: number
  contributorGrowth: number
  issueActivity: number
  normalized: {
    newStars: number
    releaseFrequency: number
    releaseRecency: number
    recentCommits: number
    contributorGrowth: number
    issueActivity: number
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

/** Log-scale normalize so mega-repos don't dominate forever. */
export function normalizeSignal(value: number, softCap: number): number {
  if (!Number.isFinite(value) || value <= 0 || softCap <= 0) return 0
  return clamp01(Math.log1p(value) / Math.log1p(softCap))
}

/** 0 at halfLife, 1 when just released. */
export function releaseRecencyScore(
  publishedAt: string | Date | null | undefined,
  halfLifeDays = RELEASE_RECENCY_HALF_LIFE_DAYS
): number {
  if (!publishedAt) return 0
  const t =
    publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(publishedAt)
  if (!Number.isFinite(t)) return 0
  const ageDays = (Date.now() - t) / 86_400_000
  if (ageDays <= 0) return 1
  return Math.exp((-Math.LN2 * ageDays) / halfLifeDays)
}

export function computeActivityScore(raw: ScoreInputs): ScoreBreakdown {
  const normalized = {
    newStars: normalizeSignal(raw.newStars, SOFT_CAPS.newStars),
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
  }

  const weighted =
    normalized.newStars * SCORE_WEIGHTS.newStars +
    normalized.releaseRecency * SCORE_WEIGHTS.releaseRecency +
    normalized.releaseFrequency * SCORE_WEIGHTS.releaseFrequency +
    normalized.recentCommits * SCORE_WEIGHTS.recentCommits +
    normalized.contributorGrowth * SCORE_WEIGHTS.contributorGrowth +
    normalized.issueActivity * SCORE_WEIGHTS.issueActivity

  const score = Math.round((weighted / WEIGHT_SUM) * 1000) / 10

  return {
    score,
    newStars: raw.newStars,
    releaseFrequency: raw.releaseFrequency,
    releaseRecency: raw.releaseRecency,
    recentCommits: raw.recentCommits,
    contributorGrowth: raw.contributorGrowth,
    issueActivity: raw.issueActivity,
    normalized,
  }
}

/** First-scrape proxy for “new stars”: stars per 30 days, capped. */
export function starVelocityProxy(
  stars: number,
  createdAt: Date | null
): number {
  if (!createdAt || stars <= 0) return 0
  const ageDays = Math.max(
    30,
    (Date.now() - createdAt.getTime()) / 86_400_000
  )
  const per30 = (stars / ageDays) * 30
  return Math.min(per30, SOFT_CAPS.newStars)
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
    return Math.min((delta / days) * 30, SOFT_CAPS.newStars)
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
    const ageDays = (Date.now() - t) / 86_400_000
    const weight = ageDays <= 30 ? 2 : ageDays <= 60 ? 1.5 : 1
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
  latestReleasePublishedAt: Date | string | null
  releasePublishedAts: Array<string | Date | null | undefined>
  recentCommits: number
  contributorsCount: number
  openIssues: number
}): RepositoryScoreFields {
  const newStars = starsGainedPer30Days(
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
    newStars,
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
