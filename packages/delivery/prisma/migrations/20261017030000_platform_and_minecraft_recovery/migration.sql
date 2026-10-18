ALTER TABLE "Build" ADD COLUMN "platformChanges" JSONB;
ALTER TABLE "Build" ADD CONSTRAINT "Build_platform_changes_ci"
  CHECK ("platformChanges" IS NULL OR ("sourceKind" = 'ci' AND "serviceId" = 'gitops'));
ALTER TABLE "Deployment" ADD COLUMN "platformSnapshot" JSONB;
ALTER TABLE "Deployment" ADD COLUMN "platformSourceBuildId" TEXT REFERENCES "Build"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Environment" ADD COLUMN "acceptedPlatformDeploymentId" TEXT REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_platform_snapshot_kind"
  CHECK (
    ("kind" IN ('root-release', 'tofu-plan', 'tofu-apply') AND "platformSnapshot" IS NOT NULL AND "platformSourceBuildId" IS NOT NULL)
    OR ("kind" NOT IN ('root-release', 'tofu-plan', 'tofu-apply') AND "platformSnapshot" IS NULL AND "platformSourceBuildId" IS NULL)
  );

CREATE TABLE "PlatformArtifactReference" (
  "deploymentId" TEXT NOT NULL REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('root-chart', 'site-prerequisite')),
  "selector" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("deploymentId", "kind", "selector")
);
CREATE INDEX "PlatformArtifactReference_artifactId_idx" ON "PlatformArtifactReference"("artifactId");

CREATE TABLE "PlatformPlan" (
  "deploymentId" TEXT PRIMARY KEY REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "receipt" JSONB NOT NULL,
  "encryptedPlan" JSONB NOT NULL CHECK (octet_length("encryptedPlan"::text) <= 16777216),
  "fingerprint" TEXT NOT NULL,
  "applyDeploymentId" TEXT UNIQUE REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PlatformLock" (
  "id" TEXT PRIMARY KEY CHECK ("id" = 'shared-resources'),
  "deploymentId" TEXT NOT NULL UNIQUE REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MinecraftRecoveryIntent" (
  "id" TEXT PRIMARY KEY,
  "deploymentId" TEXT NOT NULL REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expectedEnvironmentGeneration" INTEGER NOT NULL CHECK ("expectedEnvironmentGeneration" >= 0),
  "snapshotFingerprint" TEXT NOT NULL,
  "controllerReceipt" JSONB,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  "workflowId" TEXT NOT NULL UNIQUE,
  "submittedAt" TIMESTAMP(3),
  "message" TEXT,
  "resultFingerprint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "MinecraftRecoveryIntent_status_createdAt_idx" ON "MinecraftRecoveryIntent"("status", "createdAt");
CREATE INDEX "MinecraftRecoveryIntent_deploymentId_createdAt_idx" ON "MinecraftRecoveryIntent"("deploymentId", "createdAt");
CREATE UNIQUE INDEX "MinecraftRecoveryIntent_one_pending" ON "MinecraftRecoveryIntent"("deploymentId") WHERE "status" = 'pending';
