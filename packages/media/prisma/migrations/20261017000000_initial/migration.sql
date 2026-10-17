-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
-- Only one published file may own an item's current edition. Defined after tables below.
CREATE TYPE "MediaKind" AS ENUM ('movie', 'series', 'season', 'episode');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('wanted', 'searching', 'downloading', 'validating', 'importing', 'available', 'quarantined', 'removed');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'reconciling');

-- CreateTable
CREATE TABLE "MediaUser" (
    "id" TEXT NOT NULL,
    "plexAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "email" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "discordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlexLogin" (
    "id" TEXT NOT NULL,
    "pinId" TEXT NOT NULL,
    "pinCode" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "encryptedDevice" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlexLogin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaItem" (
    "id" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "parentId" TEXT,
    "seasonNumber" INTEGER,
    "episodeNumber" INTEGER,
    "tmdbId" INTEGER,
    "externalIds" JSONB NOT NULL DEFAULT '{}',
    "availability" "Availability" NOT NULL DEFAULT 'wanted',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "subtitleLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeFutureEpisodes" BOOLEAN NOT NULL DEFAULT false,
    "includeSpecials" BOOLEAN NOT NULL DEFAULT false,
    "sponsorRequestId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityProfileVersion" (
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityProfileVersion_pkey" PRIMARY KEY ("profileId","version")
);

-- CreateTable
CREATE TABLE "MediaIntent" (
    "mediaId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "desiredPresence" BOOLEAN NOT NULL DEFAULT true,
    "monitoring" BOOLEAN NOT NULL DEFAULT true,
    "profileId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "intentionallyRemovedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaIntent_pkey" PRIMARY KEY ("mediaId")
);

-- CreateTable
CREATE TABLE "ReleaseCandidate" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerReleaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "evaluation" JSONB NOT NULL,
    "mediaIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionAttempt" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "sponsorRequestId" TEXT NOT NULL,
    "mediaIds" TEXT[],
    "generations" JSONB NOT NULL,
    "state" TEXT NOT NULL,
    "torrentId" TEXT,
    "operationId" TEXT NOT NULL,
    "failure" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquisitionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionReservation" (
    "mediaId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionReservation_pkey" PRIMARY KEY ("mediaId")
);

-- CreateTable
CREATE TABLE "Torrent" (
    "id" TEXT NOT NULL,
    "infoHash" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "owned" BOOLEAN NOT NULL DEFAULT false,
    "seedingPolicy" JSONB NOT NULL,
    "observation" JSONB,
    "observedAt" TIMESTAMP(3),
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Torrent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryAsset" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sourcePath" TEXT,
    "torrentId" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "properties" JSONB NOT NULL,
    "owned" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCoverage" (
    "assetId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "edition" TEXT NOT NULL DEFAULT 'default',
    "current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AssetCoverage_pkey" PRIMARY KEY ("assetId","mediaId")
);

-- CreateTable
CREATE TABLE "SubtitleAsset" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "matchingEvidence" JSONB NOT NULL,
    "content" BYTEA,
    "path" TEXT,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtitleAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchState" (
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "watched" BOOLEAN NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "WatchState_pkey" PRIMARY KEY ("userId","mediaId")
);

-- CreateTable
CREATE TABLE "RetentionHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "isPin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionDecision" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "warningAcceptedAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "quarantinedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "manifest" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxCommand" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "providerReceipt" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaUser_plexAccountId_key" ON "MediaUser"("plexAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaUser_discordId_key" ON "MediaUser"("discordId");

-- CreateIndex
CREATE INDEX "MediaSession_expiresAt_idx" ON "MediaSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_userId_kind_key" ON "Credential"("userId", "kind");

-- CreateIndex
CREATE INDEX "MediaItem_parentId_seasonNumber_episodeNumber_idx" ON "MediaItem"("parentId", "seasonNumber", "episodeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MediaItem_kind_tmdbId_key" ON "MediaItem"("kind", "tmdbId");

-- CreateIndex
CREATE INDEX "MediaRequest_mediaId_active_idx" ON "MediaRequest"("mediaId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRequest_userId_mediaId_key" ON "MediaRequest"("userId", "mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseCandidate_providerId_providerReleaseId_key" ON "ReleaseCandidate"("providerId", "providerReleaseId");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionAttempt_operationId_key" ON "AcquisitionAttempt"("operationId");

-- CreateIndex
CREATE INDEX "AcquisitionReservation_attemptId_idx" ON "AcquisitionReservation"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "Torrent_infoHash_key" ON "Torrent"("infoHash");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryAsset_path_key" ON "LibraryAsset"("path");

-- CreateIndex
CREATE INDEX "AssetCoverage_mediaId_current_idx" ON "AssetCoverage"("mediaId", "current");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionHold_userId_mediaId_key" ON "RetentionHold"("userId", "mediaId");

-- CreateIndex
CREATE INDEX "RetentionDecision_mediaId_state_idx" ON "RetentionDecision"("mediaId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_idempotencyKey_key" ON "Operation"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxCommand_operationId_key" ON "OutboxCommand"("operationId");

-- CreateIndex
CREATE INDEX "OutboxCommand_dispatchedAt_availableAt_idx" ON "OutboxCommand"("dispatchedAt", "availableAt");

-- CreateIndex
CREATE INDEX "ApplicationEvent_mediaId_createdAt_idx" ON "ApplicationEvent"("mediaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_eventId_userId_channel_key" ON "NotificationDelivery"("eventId", "userId", "channel");

-- AddForeignKey
ALTER TABLE "MediaSession" ADD CONSTRAINT "MediaSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaItem" ADD CONSTRAINT "MediaItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MediaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRequest" ADD CONSTRAINT "MediaRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRequest" ADD CONSTRAINT "MediaRequest_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityProfileVersion" ADD CONSTRAINT "QualityProfileVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "QualityProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaIntent" ADD CONSTRAINT "MediaIntent_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaIntent" ADD CONSTRAINT "MediaIntent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "QualityProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionAttempt" ADD CONSTRAINT "AcquisitionAttempt_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ReleaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionAttempt" ADD CONSTRAINT "AcquisitionAttempt_torrentId_fkey" FOREIGN KEY ("torrentId") REFERENCES "Torrent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionReservation" ADD CONSTRAINT "AcquisitionReservation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AcquisitionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryAsset" ADD CONSTRAINT "LibraryAsset_torrentId_fkey" FOREIGN KEY ("torrentId") REFERENCES "Torrent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCoverage" ADD CONSTRAINT "AssetCoverage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "LibraryAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCoverage" ADD CONSTRAINT "AssetCoverage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleAsset" ADD CONSTRAINT "SubtitleAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "LibraryAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchState" ADD CONSTRAINT "WatchState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchState" ADD CONSTRAINT "WatchState_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionHold" ADD CONSTRAINT "RetentionHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionHold" ADD CONSTRAINT "RetentionHold_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionDecision" ADD CONSTRAINT "RetentionDecision_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxCommand" ADD CONSTRAINT "OutboxCommand_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ApplicationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A multi-episode file can be current for several items, but an item/edition has one current file.
CREATE UNIQUE INDEX "AssetCoverage_current_edition_key"
ON "AssetCoverage" ("mediaId", "edition") WHERE "current" = true;

ALTER TABLE "AcquisitionReservation" ADD CONSTRAINT "AcquisitionReservation_mediaId_fkey"
FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaIntent" ADD CONSTRAINT "MediaIntent_generation_nonnegative" CHECK ("generation" >= 0);
ALTER TABLE "LibraryAsset" ADD CONSTRAINT "LibraryAsset_size_positive" CHECK ("sizeBytes" > 0);

-- Profile snapshots are immutable: edits create a new numbered version.
CREATE FUNCTION reject_quality_profile_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Quality profile versions are immutable';
END;
$$;
CREATE TRIGGER "QualityProfileVersion_immutable"
BEFORE UPDATE OR DELETE ON "QualityProfileVersion"
FOR EACH ROW EXECUTE FUNCTION reject_quality_profile_version_mutation();
