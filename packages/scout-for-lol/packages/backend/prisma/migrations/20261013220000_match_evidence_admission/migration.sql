ALTER TABLE "MatchObservation" DROP CONSTRAINT "MatchObservation_policy_check";
ALTER TABLE "MatchObservation" ADD CONSTRAINT "MatchObservation_policy_check"
  CHECK ("processingPolicy" IN ('ARCHIVE_ONLY', 'HISTORY_ONLY', 'FULL'));

CREATE TABLE "MatchEvidenceAdmission" (
  "riotMatchId" TEXT PRIMARY KEY,
  "policy" TEXT NOT NULL CHECK ("policy" IN ('FULL', 'HISTORY_ONLY')),
  "reason" TEXT NOT NULL CHECK ("reason" IN ('live-completion', 'history-discovery', 'late-discovery', 'legacy-live', 'legacy-history')),
  "firstDiscoveredAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "riotHistoryListed" BOOLEAN NOT NULL DEFAULT false,
  "timelineDeadlineAt" TIMESTAMP(3),
  "timelineFinalizedAt" TIMESTAMP(3),
  "timelineMissing" BOOLEAN NOT NULL DEFAULT false,
  "historyReportComplete" BOOLEAN NOT NULL DEFAULT false,
  "historyTimelineRecovered" BOOLEAN NOT NULL DEFAULT false,
  "recoveryNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recoveryClaimId" TEXT,
  "recoveryError" TEXT,
  "legacyPolicy" TEXT,
  "legacyPromotedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchEvidenceAdmission_timeline_missing_check"
    CHECK (NOT "timelineMissing" OR "timelineFinalizedAt" IS NOT NULL)
);
CREATE INDEX "MatchEvidenceAdmission_recovery_idx"
  ON "MatchEvidenceAdmission"("historyReportComplete", "recoveryNextAttemptAt");

CREATE TABLE "RiotPayloadCapture" (
  "id" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archiveKey" TEXT,
  "archiveDigest" TEXT,
  "archiveBytes" BIGINT,
  "archivedAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimId" TEXT,
  "lastError" TEXT,
  CONSTRAINT "RiotPayloadCapture_archive_check" CHECK (
    "archivedAt" IS NULL OR ("archiveKey" IS NOT NULL AND "archiveDigest" IS NOT NULL AND "archiveBytes" IS NOT NULL AND "archiveDigest" ~ '^[0-9a-f]{64}$' AND "archiveBytes" >= 0)
  )
);
CREATE INDEX "RiotPayloadCapture_archivedAt_nextAttemptAt_idx" ON "RiotPayloadCapture"("archivedAt", "nextAttemptAt");

CREATE TABLE "MatchResultEvidence" (
  "source" TEXT NOT NULL CHECK ("source" IN ('RIOT', 'SCOUT_CLIENT')),
  "sourceId" TEXT NOT NULL,
  "riotMatchId" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "clientObservationId" TEXT UNIQUE REFERENCES "ScoutClientObservation"("observationId") ON DELETE CASCADE ON UPDATE CASCADE,
  "riotCaptureId" TEXT UNIQUE REFERENCES "RiotPayloadCapture"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY ("source", "sourceId"),
  CHECK (("source" = 'SCOUT_CLIENT' AND "clientObservationId" = "sourceId" AND "clientObservationId" IS NOT NULL AND "riotCaptureId" IS NULL)
    OR ("source" = 'RIOT' AND "riotCaptureId" = "sourceId" AND "riotCaptureId" IS NOT NULL AND "clientObservationId" IS NULL)),
  CHECK ("result" ?& ARRAY['source', 'sourceId', 'matchId'] AND "result"->>'source' = "source" AND "result"->>'sourceId' = "sourceId" AND "result"->>'matchId' = "riotMatchId")
);
CREATE INDEX "MatchResultEvidence_riotMatchId_idx" ON "MatchResultEvidence"("riotMatchId");
INSERT INTO "MatchResultEvidence" ("source", "sourceId", "riotMatchId", "result", "capturedAt", "clientObservationId")
  SELECT 'SCOUT_CLIENT', "observationId", "riotMatchId", "result", "capturedAt", "observationId" FROM "ScoutClientGameResult";
