-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "homepage" TEXT,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT,
    "topics" JSONB NOT NULL DEFAULT '[]',
    "license" TEXT,
    "avatarUrl" TEXT,
    "pushedAt" TIMESTAMP(3),
    "releasesCount" INTEGER,
    "platforms" JSONB NOT NULL DEFAULT '[]',
    "hasWindows" BOOLEAN NOT NULL DEFAULT false,
    "hasMacos" BOOLEAN NOT NULL DEFAULT false,
    "hasLinux" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT,
    "publishedAt" TIMESTAMP(3),
    "url" TEXT,
    "prerelease" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT,
    "platforms" JSONB NOT NULL DEFAULT '[]',
    "hasWindows" BOOLEAN NOT NULL DEFAULT false,
    "hasMacos" BOOLEAN NOT NULL DEFAULT false,
    "hasLinux" BOOLEAN NOT NULL DEFAULT false,
    "assets" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRecord" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "repositoryId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- CreateIndex
CREATE INDEX "Repository_hidden_stars_idx" ON "Repository"("hidden", "stars");

-- CreateIndex
CREATE INDEX "Repository_pushedAt_idx" ON "Repository"("pushedAt");

-- CreateIndex
CREATE INDEX "Repository_hasWindows_idx" ON "Repository"("hasWindows");

-- CreateIndex
CREATE INDEX "Repository_hasMacos_idx" ON "Repository"("hasMacos");

-- CreateIndex
CREATE INDEX "Repository_hasLinux_idx" ON "Repository"("hasLinux");

-- CreateIndex
CREATE INDEX "Repository_language_idx" ON "Repository"("language");

-- CreateIndex
CREATE UNIQUE INDEX "Release_repositoryId_key" ON "Release"("repositoryId");

-- CreateIndex
CREATE INDEX "Release_tag_idx" ON "Release"("tag");

-- CreateIndex
CREATE INDEX "Release_publishedAt_idx" ON "Release"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapeRecord_fullName_key" ON "ScrapeRecord"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapeRecord_repositoryId_key" ON "ScrapeRecord"("repositoryId");

-- CreateIndex
CREATE INDEX "ScrapeRecord_status_idx" ON "ScrapeRecord"("status");

-- CreateIndex
CREATE INDEX "ScrapeRecord_lastSeenAt_idx" ON "ScrapeRecord"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeRecord" ADD CONSTRAINT "ScrapeRecord_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
