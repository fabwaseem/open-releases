/**
 * Directory ranking score (components normalized 0–1, then weighted).
 *
 * score =
 *   (new stars × 0.3) +
 *   (release frequency × 0.2) +
 *   (recent commits × 0.2) +
 *   (contributor growth × 0.1) +
 *   (issues/discussions activity × 0.1)
 *
 * Weights sum to 0.9 — result is scaled to 0–100.
 */

export const SCORE_WEIGHTS = {
  newStars: 0.3,
  releaseFrequency: 0.2,
  recentCommits: 0.2,
  contributorGrowth: 0.1,
  issueActivity: 0.1,
} as const

const WEIGHT_SUM =
  SCORE_WEIGHTS.newStars +
  SCORE_WEIGHTS.releaseFrequency +
  SCORE_WEIGHTS.recentCommits +
  SCORE_WEIGHTS.contributorGrowth +
  SCORE_WEIGHTS.issueActivity

/** Soft-caps for log normalization (values near cap → ~1.0). */
const SOFT_CAPS = {
  newStars: 400,
  /** releases per month */
  releaseFrequency: 4,
  recentCommits: 80,
  contributorGrowth: 40,
  issueActivity: 200,
} as const

export type ScoreInputs = {
  /** Stars gained since last scrape (or velocity proxy on first scrape). */
  newStars: number
  /** Releases per month over the recent window. */
  releaseFrequency: number
  /** Commits in the last ~30 days (capped by API page size). */
  recentCommits: number
  /** New contributors since last scrape (or count proxy on first scrape). */
  contributorGrowth: number
  /** Open issues / discussion-adjacent activity signal. */
  issueActivity: number
}

export type ScoreBreakdown = {
  score: number
  newStars: number
  releaseFrequency: number
  recentCommits: number
  contributorGrowth: number
  issueActivity: number
  normalized: {
    newStars: number
    releaseFrequency: number
    recentCommits: number
    contributorGrowth: number
    issueActivity: number
  }
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

export function computeActivityScore(raw: ScoreInputs): ScoreBreakdown {
  const normalized = {
    newStars: normalizeSignal(raw.newStars, SOFT_CAPS.newStars),
    releaseFrequency: normalizeSignal(
      raw.releaseFrequency,
      SOFT_CAPS.releaseFrequency
    ),
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
    normalized.releaseFrequency * SCORE_WEIGHTS.releaseFrequency +
    normalized.recentCommits * SCORE_WEIGHTS.recentCommits +
    normalized.contributorGrowth * SCORE_WEIGHTS.contributorGrowth +
    normalized.issueActivity * SCORE_WEIGHTS.issueActivity

  const score = Math.round((weighted / WEIGHT_SUM) * 1000) / 10

  return {
    score,
    newStars: raw.newStars,
    releaseFrequency: raw.releaseFrequency,
    recentCommits: raw.recentCommits,
    contributorGrowth: raw.contributorGrowth,
    issueActivity: raw.issueActivity,
    normalized,
  }
}

/** First-scrape proxy for “new stars”: stars per year, capped. */
export function starVelocityProxy(stars: number, createdAt: Date | null): number {
  if (!createdAt || stars <= 0) return 0
  const ageDays = Math.max(
    30,
    (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
  )
  return (stars / ageDays) * 30 // ~stars gained per 30 days
}

export function releaseFrequencyPerMonth(
  publishedAts: Array<string | null | undefined>,
  windowDays = 180
): number {
  const cutoff = Date.now() - windowDays * 86_400_000
  const recent = publishedAts.filter((iso) => {
    if (!iso) return false
    const t = Date.parse(iso)
    return Number.isFinite(t) && t >= cutoff
  }).length
  const months = windowDays / 30
  return recent / months
}
