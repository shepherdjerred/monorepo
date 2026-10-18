CREATE TABLE "ForumBaselineIntent" (
  "id" TEXT PRIMARY KEY,
  "environmentId" TEXT NOT NULL REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "imageArtifactId" TEXT NOT NULL REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bundleArtifactId" TEXT NOT NULL REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expectedEnvironmentGeneration" INTEGER NOT NULL CHECK ("expectedEnvironmentGeneration" >= 0),
  "pipelineRevisionId" TEXT NOT NULL REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "configurationRevision" TEXT NOT NULL,
  "snapshotFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  "workflowId" TEXT NOT NULL UNIQUE,
  "submittedAt" TIMESTAMP(3),
  "proof" JSONB,
  "message" TEXT,
  "resultFingerprint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "ForumBaselineIntent_status_createdAt_idx" ON "ForumBaselineIntent"("status", "createdAt");
CREATE INDEX "ForumBaselineIntent_environmentId_createdAt_idx" ON "ForumBaselineIntent"("environmentId", "createdAt");
CREATE UNIQUE INDEX "ForumBaselineIntent_one_pending" ON "ForumBaselineIntent"("environmentId") WHERE "status" = 'pending';
ALTER TABLE "Environment" ADD COLUMN "acceptedForumBaselineIntentId" TEXT;
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_acceptedForumBaselineIntentId_fkey" FOREIGN KEY ("acceptedForumBaselineIntentId") REFERENCES "ForumBaselineIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD COLUMN "forumBaselineSnapshot" JSONB;
