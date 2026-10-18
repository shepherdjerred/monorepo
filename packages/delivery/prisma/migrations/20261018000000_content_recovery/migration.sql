CREATE TABLE "ContentRecoveryIntent" (
  "id" TEXT PRIMARY KEY,
  "deploymentId" TEXT NOT NULL REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetKind" TEXT NOT NULL CHECK ("targetKind" IN ('static-site', 'forum')),
  "requestedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expectedEnvironmentGeneration" INTEGER NOT NULL CHECK ("expectedEnvironmentGeneration" >= 0),
  "snapshotFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  "nativeReceipts" JSONB NOT NULL DEFAULT '[]',
  "dispatchBarrier" JSONB,
  "barrierRestoredAt" TIMESTAMP(3),
  "message" TEXT,
  "resultFingerprint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "ContentRecoveryIntent_status_createdAt_idx" ON "ContentRecoveryIntent"("status", "createdAt");
CREATE INDEX "ContentRecoveryIntent_deploymentId_createdAt_idx" ON "ContentRecoveryIntent"("deploymentId", "createdAt");
CREATE UNIQUE INDEX "ContentRecoveryIntent_one_pending" ON "ContentRecoveryIntent"("deploymentId") WHERE "status" = 'pending';
