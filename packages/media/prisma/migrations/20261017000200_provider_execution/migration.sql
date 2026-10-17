ALTER TABLE "ReleaseCandidate" ADD COLUMN "encryptedSource" TEXT;
ALTER TABLE "AcquisitionAttempt" ADD COLUMN "filePlan" JSONB;
CREATE TABLE "MediaProvider" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "configuration" JSONB NOT NULL DEFAULT '{}',
  "seedingPolicy" JSONB NOT NULL DEFAULT '{"kind":"unknown"}',
  "credentialId" TEXT,
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaProvider_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProviderLease" (
  "providerId" TEXT NOT NULL,
  "ownerId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "nextAllowedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderLease_pkey" PRIMARY KEY ("providerId")
);
CREATE TABLE "MediaRuntimeState" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'observe',
  "recoveryEpoch" INTEGER NOT NULL DEFAULT 0,
  "ownershipConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaRuntimeState_pkey" PRIMARY KEY ("id")
);
INSERT INTO "MediaRuntimeState" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP);
ALTER TABLE "AcquisitionAttempt" ADD COLUMN "recoveryEpoch" INTEGER NOT NULL DEFAULT 0;
