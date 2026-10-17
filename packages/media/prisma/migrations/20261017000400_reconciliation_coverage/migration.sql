ALTER TABLE "MediaItem" ADD COLUMN "runtimeMinutes" INTEGER,
  ADD COLUMN "originalLanguage" TEXT,
  ADD COLUMN "airDate" TIMESTAMP(3),
  ADD COLUMN "catalogState" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "MediaRequest" ADD COLUMN "direct" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false;
UPDATE "MediaRequest" SET "direct" = false WHERE "sponsorRequestId" IS NOT NULL;
ALTER TABLE "MediaProvider" ADD COLUMN "lastFeedAt" TIMESTAMP(3),
  ADD COLUMN "feedState" TEXT NOT NULL DEFAULT 'unconfigured';

CREATE TABLE "PlexIdentityMapping" (
  "userId" TEXT PRIMARY KEY REFERENCES "MediaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "serverMachineId" TEXT NOT NULL,
  "serverAccountId" TEXT,
  "homeUserId" TEXT,
  "kind" TEXT NOT NULL,
  "permittedSectionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "permittedMediaKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "plexRestricted" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "PlexIdentityMapping_serverMachineId_serverAccountId_key" ON "PlexIdentityMapping"("serverMachineId", "serverAccountId");
CREATE UNIQUE INDEX "PlexIdentityMapping_serverMachineId_homeUserId_key" ON "PlexIdentityMapping"("serverMachineId", "homeUserId");

CREATE TABLE "QualityProfileDefault" (
  "kind" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "QualityProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "RequestCoverage" (
  "rootRequestId" TEXT NOT NULL REFERENCES "MediaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" TEXT NOT NULL REFERENCES "MediaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "mediaId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sourceVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("rootRequestId", "mediaId")
);
CREATE INDEX "RequestCoverage_requestId_active_idx" ON "RequestCoverage"("requestId", "active");
INSERT INTO "RequestCoverage" ("rootRequestId", "requestId", "mediaId", "active", "sourceVersion")
SELECT parent."id", child."id", child."mediaId", child."active", parent."version"
FROM "MediaRequest" child JOIN "MediaRequest" parent ON child."sponsorRequestId" = parent."id";

CREATE TABLE "PlexInventoryObservation" (
  "sectionId" TEXT NOT NULL, "ratingKey" TEXT NOT NULL, "path" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "guids" JSONB NOT NULL,
  "seasonNumber" INTEGER, "episodeNumber" INTEGER,
  "scanId" TEXT NOT NULL, "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("sectionId", "ratingKey", "path")
);
CREATE INDEX "PlexInventoryObservation_path_idx" ON "PlexInventoryObservation"("path");
CREATE INDEX "PlexInventoryObservation_scanId_idx" ON "PlexInventoryObservation"("scanId");
CREATE TABLE "ReconciliationScan" (
  "id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'running', "progress" JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3)
);
ALTER TABLE "NotificationDelivery" ADD COLUMN "recoveryEpoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MediaRequest" ADD COLUMN "coverageCompletedAt" TIMESTAMP(3);
