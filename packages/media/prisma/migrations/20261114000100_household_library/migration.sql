CREATE TYPE "KeepingPolicy" AS ENUM ('keep', 'temporary');
CREATE TYPE "RequestInterestState" AS ENUM ('following', 'finished', 'dropped', 'expired');

ALTER TABLE "MediaIntent" ADD COLUMN "libraryKeep" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MediaIntent" ADD COLUMN "libraryPolicyExplicit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MediaIntent" ADD COLUMN "libraryPolicyActorId" TEXT;
-- Existing library adoption never silently grants destructive authority.
UPDATE "MediaIntent" SET "libraryKeep" = true;

ALTER TABLE "MediaRequest"
  ADD COLUMN "keepingPolicy" "KeepingPolicy" NOT NULL DEFAULT 'temporary',
  ADD COLUMN "interestState" "RequestInterestState" NOT NULL DEFAULT 'following',
  ADD COLUMN "interestRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "interestRenewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "usableUnwatchedSince" TIMESTAMP(3),
  ADD COLUMN "lastMeaningfulProgressAt" TIMESTAMP(3),
  ADD COLUMN "interestNoticeEventId" TEXT,
  ADD COLUMN "interestNoticeRevision" INTEGER,
  ADD COLUMN "interestNoticeAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "interestNoticeViewedAt" TIMESTAMP(3),
  ADD COLUMN "interestReleasedAt" TIMESTAMP(3),
  ADD COLUMN "interestReleaseReason" TEXT;
-- Requester interests stay temporary; the existing library-level Keep above
-- protects every file without manufacturing permanent member pins.

ALTER TABLE "MediaItem"
  ADD COLUMN "seriesStatus" TEXT,
  ADD COLUMN "seriesStatusObservedAt" TIMESTAMP(3),
  ADD COLUMN "catalogCompletedAt" TIMESTAMP(3);

CREATE TABLE "MediaReleaseDate" (
  "id" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "date" TEXT,
  "precision" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaReleaseDate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaReleaseDate_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MediaReleaseDate_region_date_mediaId_idx" ON "MediaReleaseDate"("region", "date", "mediaId");
INSERT INTO "MediaReleaseDate" ("id", "mediaId", "region", "kind", "date", "precision", "observedAt")
SELECT 'episode:' || "id", "id", '', 'episode',
  to_char("airDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
  CASE WHEN "airDate" IS NULL THEN 'unknown' ELSE 'day' END, "updatedAt"
FROM "MediaItem" WHERE "kind" = 'episode';

CREATE TABLE "PlaybackSession" (
  "id" TEXT NOT NULL,
  "serverMachineId" TEXT NOT NULL,
  "serverAccountId" TEXT NOT NULL,
  "userId" TEXT,
  "ratingKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "seriesTitle" TEXT,
  "mediaType" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "stoppedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "watchedMs" INTEGER NOT NULL DEFAULT 0,
  "maxProgressMs" INTEGER NOT NULL DEFAULT 0,
  "lastProgressMs" INTEGER NOT NULL DEFAULT 0,
  "meaningfulProgressAt" TIMESTAMP(3),
  "reportingCompleted" BOOLEAN NOT NULL DEFAULT false,
  "state" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceSnapshotDigest" TEXT,
  CONSTRAINT "PlaybackSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlaybackSession_userId_startedAt_id_idx" ON "PlaybackSession"("userId", "startedAt", "id");
CREATE INDEX "PlaybackSession_serverMachineId_serverAccountId_ratingKey_s_idx" ON "PlaybackSession"("serverMachineId", "serverAccountId", "ratingKey", "startedAt");
CREATE INDEX "PlaybackSession_serverMachineId_state_lastSeenAt_idx" ON "PlaybackSession"("serverMachineId", "state", "lastSeenAt");

CREATE TABLE "PlaybackSessionIdentity" (
  "source" TEXT NOT NULL,
  "sourceInstanceId" TEXT NOT NULL,
  "sourceSessionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  CONSTRAINT "PlaybackSessionIdentity_pkey" PRIMARY KEY ("source", "sourceInstanceId", "sourceSessionId"),
  CONSTRAINT "PlaybackSessionIdentity_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlaybackSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PlaybackSessionIdentity_sessionId_idx" ON "PlaybackSessionIdentity"("sessionId");

CREATE TABLE "PlaybackCollector" (
  "serverMachineId" TEXT NOT NULL,
  "collectionStartedAt" TIMESTAMP(3),
  "observedAt" TIMESTAMP(3),
  "importedThrough" TIMESTAMP(3),
  "importSourceInstanceId" TEXT,
  "handoffEvidence" JSONB,
  "interestCursor" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PlaybackCollector_pkey" PRIMARY KEY ("serverMachineId")
);
