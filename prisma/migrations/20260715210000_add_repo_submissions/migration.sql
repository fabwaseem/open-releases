-- CreateTable
CREATE TABLE "repo_submission" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "reviewNote" TEXT,
    "preview" JSONB NOT NULL,
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "repositoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repo_submission_status_createdAt_idx" ON "repo_submission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "repo_submission_fullName_idx" ON "repo_submission"("fullName");

-- CreateIndex
CREATE INDEX "repo_submission_submittedById_idx" ON "repo_submission"("submittedById");

-- AddForeignKey
ALTER TABLE "repo_submission" ADD CONSTRAINT "repo_submission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_submission" ADD CONSTRAINT "repo_submission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_submission" ADD CONSTRAINT "repo_submission_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
