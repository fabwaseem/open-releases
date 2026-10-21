-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "latestReleaseGithubId" TEXT,
ADD COLUMN     "releasesEtag" TEXT;

-- AlterTable
ALTER TABLE "ScrapeRecord" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryShard" (
    "id" TEXT NOT NULL,
    "sweepKey" TEXT NOT NULL,
    "shardId" TEXT NOT NULL,
    "shard" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryShard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapeRun_kind_startedAt_idx" ON "ScrapeRun"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "DiscoveryShard_sweepKey_status_position_idx" ON "DiscoveryShard"("sweepKey", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryShard_sweepKey_shardId_key" ON "DiscoveryShard"("sweepKey", "shardId");

-- CreateIndex
CREATE INDEX "Repository_releaseCheckedAt_idx" ON "Repository"("releaseCheckedAt");
