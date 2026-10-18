CREATE TABLE "PlatformRecoveryIntent" (
  "id" TEXT PRIMARY KEY,
  "deploymentId" TEXT NOT NULL REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expectedEnvironmentGeneration" INTEGER NOT NULL CHECK ("expectedEnvironmentGeneration" >= 0),
  "snapshotFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  "workflowId" TEXT NOT NULL UNIQUE,
  "submittedAt" TIMESTAMP(3),
  "message" TEXT,
  "resultFingerprint" TEXT,
  "nativeReceipts" JSONB NOT NULL DEFAULT '[]',
  "planReceipt" JSONB,
  "encryptedPlan" JSONB,
  "planFingerprint" TEXT,
  "planApproval" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "PlatformRecoveryIntent_status_createdAt_idx" ON "PlatformRecoveryIntent"("status", "createdAt");
CREATE INDEX "PlatformRecoveryIntent_deploymentId_createdAt_idx" ON "PlatformRecoveryIntent"("deploymentId", "createdAt");
CREATE UNIQUE INDEX "PlatformRecoveryIntent_one_pending" ON "PlatformRecoveryIntent"("deploymentId") WHERE "status" = 'pending';
