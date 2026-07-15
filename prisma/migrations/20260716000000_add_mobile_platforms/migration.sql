-- AlterTable
ALTER TABLE "Repository" ADD COLUMN "hasAndroid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Repository" ADD COLUMN "hasIos" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Release" ADD COLUMN "hasAndroid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Release" ADD COLUMN "hasIos" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Repository_hasAndroid_idx" ON "Repository"("hasAndroid");

-- CreateIndex
CREATE INDEX "Repository_hasIos_idx" ON "Repository"("hasIos");
