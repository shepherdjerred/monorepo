ALTER TABLE "MatchNotificationIntent" ADD COLUMN "followUpCompletedAt" TIMESTAMP(3);
CREATE INDEX "MatchNotificationIntent_kind_state_followUpCompletedAt_idx"
ON "MatchNotificationIntent"("kind", "state", "followUpCompletedAt");

CREATE TABLE "ScoutOrchestrationCutover" (
  "id" TEXT PRIMARY KEY,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CustomNightOperation" (
  "id" TEXT PRIMARY KEY,
  "nightId" TEXT NOT NULL REFERENCES "CustomNight"("id") ON DELETE CASCADE,
  "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision" >= 0),
  "actorDiscordId" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('arrange', 'return', 'continue', 'void', 'end', 'expire')),
  "payload" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'queued' CHECK ("state" IN ('queued', 'running', 'held', 'completed', 'failed')),
  "progress" TEXT NOT NULL DEFAULT '{}',
  "outcome" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK (("state" IN ('completed', 'failed')) = ("outcome" IS NOT NULL))
);
CREATE INDEX "CustomNightOperation_state_createdAt_idx" ON "CustomNightOperation"("state", "createdAt");
CREATE INDEX "CustomNightOperation_nightId_createdAt_idx" ON "CustomNightOperation"("nightId", "createdAt");
CREATE UNIQUE INDEX "CustomNightOperation_active_night_key" ON "CustomNightOperation"("nightId")
  WHERE "state" IN ('queued', 'running', 'held');

CREATE TABLE "BucksWeeklyPublication" (
  "id" TEXT PRIMARY KEY,
  "serverId" TEXT NOT NULL,
  "runWeek" INTEGER NOT NULL,
  "entries" TEXT NOT NULL,
  "chunkCount" INTEGER NOT NULL CHECK ("chunkCount" > 0),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BucksWeeklyPublication_serverId_runWeek_key" ON "BucksWeeklyPublication"("serverId", "runWeek");

ALTER TABLE "MatchNotificationIntent" DROP CONSTRAINT "MatchNotificationIntent_subject_check";
ALTER TABLE "MatchNotificationIntent" ADD CONSTRAINT "MatchNotificationIntent_subject_check" CHECK (
  ("subjectKind" = 'match' AND "riotMatchId" IS NOT NULL
    AND "riotMatchId" ~ '^[A-Z0-9]+_[0-9]+$'
    AND ("subjectId" IS NULL OR "subjectId" = "riotMatchId"))
  OR ("subjectKind" IN ('duel', 'dare', 'announcement') AND "riotMatchId" IS NULL
    AND "subjectId" IS NOT NULL AND char_length("subjectId") > 0)
);
ALTER TABLE "MatchNotificationIntent" DROP CONSTRAINT "MatchNotificationIntent_kind_check";
ALTER TABLE "MatchNotificationIntent" ADD CONSTRAINT "MatchNotificationIntent_kind_check" CHECK (
  "kind" IN ('postmatch', 'prematch', 'settlement', 'hall-record-break', 'duel-status', 'dare-status', 'product-announcement')
);
ALTER TABLE "MatchNotificationIntent" ADD CONSTRAINT "MatchNotificationIntent_announcement_subject_check" CHECK (
  ("kind" = 'product-announcement') = ("subjectKind" = 'announcement')
  AND ("subjectKind" <> 'announcement' OR "originKind" = 'live')
);
ALTER TABLE "CustomNight" ADD COLUMN "recruitmentGeneration" INTEGER NOT NULL DEFAULT 0 CHECK ("recruitmentGeneration" >= 0);
ALTER TABLE "CustomNight" ADD COLUMN "publishedRevision" INTEGER NOT NULL DEFAULT -1 CHECK ("publishedRevision" >= -1);
UPDATE "CustomNight" SET "publishedRevision" = "revision";
