-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Repository_hidden_featured_activityScore_idx" ON "Repository"("hidden", "featured", "activityScore");

-- CreateIndex
CREATE INDEX "Repository_featured_idx" ON "Repository"("featured");
