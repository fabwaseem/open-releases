-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "activityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "contributorsCount" INTEGER,
ADD COLUMN     "previousContributors" INTEGER,
ADD COLUMN     "previousStars" INTEGER,
ADD COLUMN     "scoreContributorGrowth" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scoreIssueActivity" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scoreNewStars" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scoreRecentCommits" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scoreReleaseFrequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Repository_hidden_activityScore_idx" ON "Repository"("hidden", "activityScore");
