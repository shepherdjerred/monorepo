ALTER TABLE "Build" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'ci';
ALTER TABLE "Build" ALTER COLUMN "ciUrl" DROP NOT NULL;
ALTER TABLE "Build" ALTER COLUMN "repositoryId" DROP NOT NULL;
ALTER TABLE "Build" ALTER COLUMN "pipelineNumber" DROP NOT NULL;
ALTER TABLE "Build" ADD CONSTRAINT "Build_source_identity_check" CHECK (("sourceKind" = 'ci' AND "ciUrl" IS NOT NULL AND "repositoryId" IS NOT NULL AND "pipelineNumber" IS NOT NULL) OR ("sourceKind" IN ('upstream', 'licensed-bundle') AND "ciUrl" IS NULL AND "repositoryId" IS NULL AND "pipelineNumber" IS NULL));
ALTER TABLE "Artifact" ADD COLUMN "origin" JSONB NOT NULL DEFAULT '{"kind":"first-party"}';
ALTER TABLE "Artifact" ADD COLUMN "originKey" TEXT;
CREATE UNIQUE INDEX "Artifact_originKey_key" ON "Artifact"("originKey");
CREATE TABLE "BuildArtifactSelection" (
  "buildId" TEXT NOT NULL,
  "component" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  CONSTRAINT "BuildArtifactSelection_pkey" PRIMARY KEY ("buildId", "component"),
  CONSTRAINT "BuildArtifactSelection_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "Build"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BuildArtifactSelection_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BuildArtifactSelection_artifactId_idx" ON "BuildArtifactSelection"("artifactId");
INSERT INTO "BuildArtifactSelection" ("buildId", "component", "artifactId") SELECT "buildId", "component", "id" FROM "Artifact";
CREATE TABLE "WorkerRecoveryIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deploymentId" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expectedEnvironmentGeneration" INTEGER NOT NULL,
  "snapshotFingerprint" TEXT NOT NULL,
  "poolFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "workflowId" TEXT NOT NULL UNIQUE,
  "submittedAt" TIMESTAMP(3),
  "message" TEXT,
  "resultFingerprint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "WorkerRecoveryIntent_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkerRecoveryIntent_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT "WorkerRecoveryIntent_generation_check" CHECK ("expectedEnvironmentGeneration" >= 0)
);
CREATE INDEX "WorkerRecoveryIntent_status_createdAt_idx" ON "WorkerRecoveryIntent"("status", "createdAt");
CREATE INDEX "WorkerRecoveryIntent_deploymentId_createdAt_idx" ON "WorkerRecoveryIntent"("deploymentId", "createdAt");
CREATE UNIQUE INDEX "WorkerRecoveryIntent_one_pending" ON "WorkerRecoveryIntent"("deploymentId") WHERE "status" = 'pending';
