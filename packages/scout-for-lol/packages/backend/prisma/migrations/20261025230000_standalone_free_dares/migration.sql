BEGIN;

-- Refuse a cutover that would strand a position created after the inventory.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "BucksBet" WHERE "betOutcome" = 'pending')
     OR EXISTS (SELECT 1 FROM "BucksParlayBet" WHERE "betOutcome" = 'pending')
     OR EXISTS (SELECT 1 FROM "BucksDare" WHERE "dareState" IN ('pending_accept', 'activating', 'active')) THEN
    RAISE EXCEPTION 'Open legacy positions remain; drain them before retiring the economy';
  END IF;
END $$;

-- Reset legacy Dare confirmations without touching shared creation/operations intents.
DELETE FROM "ConfirmationIntent" WHERE "dareId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "ConfirmationIntent" DROP CONSTRAINT "ConfirmationIntent_dareId_fkey";

-- CreateTable
CREATE TABLE "Dare" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "challengerDiscordId" TEXT NOT NULL,
    "originConversationId" TEXT,
    "dareState" TEXT NOT NULL DEFAULT 'draft',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "publishedRevision" INTEGER,
    "contractJson" TEXT,
    "proposalExpiresAt" TIMESTAMP(3),
    "acceptDeadline" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "settledMatchId" TEXT,
    "finalValue" BOOLEAN,
    "proofJson" TEXT,
    "voidReason" TEXT,
    "messageRef" TEXT,
    "calloutClaimId" TEXT,
    "calloutClaimedAt" TIMESTAMP(3),
    "calloutRefreshPending" BOOLEAN NOT NULL DEFAULT false,
    "calloutRefreshVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DareActivation" (
    "dareId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "snapshotJson" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DareActivation_pkey" PRIMARY KEY ("dareId")
);

-- CreateTable
CREATE TABLE "DareRevision" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "originalText" TEXT NOT NULL,
    "canonicalScoutQl" TEXT NOT NULL,
    "compiledPlan" TEXT NOT NULL,
    "scoutQlImmutableAst" TEXT,
    "scoutQlPlanHash" TEXT,
    "compilerVersion" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "targetsJson" TEXT NOT NULL,
    "deadlineSpecJson" TEXT NOT NULL,
    "plainLanguage" TEXT NOT NULL,
    "semanticProofPlan" TEXT NOT NULL,
    "displayTitle" TEXT,
    "statusPhrasesJson" TEXT,
    "translationJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DareRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DareTarget" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
    "targetKey" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "accounts" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DareTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DareEvidence" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "gameStartAt" TIMESTAMP(3) NOT NULL,
    "gameEndAt" TIMESTAMP(3) NOT NULL,
    "queueType" TEXT NOT NULL,
    "candidateMembership" TEXT NOT NULL,
    "sourceReferences" TEXT NOT NULL,
    "evaluationOutput" TEXT NOT NULL,
    "coverageState" TEXT NOT NULL,
    "targetDependencies" TEXT NOT NULL,
    "evaluationTrace" TEXT NOT NULL,
    "planVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DareEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DareNotificationPreference" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "dareLifecycleDms" BOOLEAN NOT NULL DEFAULT true,
    "dareProgressDms" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DareNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dare_challengerDiscordId_dareState_updatedAt_idx" ON "Dare"("challengerDiscordId", "dareState", "updatedAt");

-- CreateIndex
CREATE INDEX "Dare_serverId_dareState_updatedAt_idx" ON "Dare"("serverId", "dareState", "updatedAt");

-- CreateIndex
CREATE INDEX "Dare_dareState_acceptDeadline_idx" ON "Dare"("dareState", "acceptDeadline");

-- CreateIndex
CREATE INDEX "Dare_dareState_deadlineAt_idx" ON "Dare"("dareState", "deadlineAt");

-- CreateIndex
CREATE INDEX "Dare_calloutRefreshPending_updatedAt_idx" ON "Dare"("calloutRefreshPending", "updatedAt");

-- CreateIndex
CREATE INDEX "Dare_settledMatchId_idx" ON "Dare"("settledMatchId");

-- CreateIndex
CREATE INDEX "DareActivation_completedAt_nextAttemptAt_requestedAt_idx" ON "DareActivation"("completedAt", "nextAttemptAt", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DareRevision_dareId_revision_key" ON "DareRevision"("dareId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "DareTarget_dareId_targetKey_key" ON "DareTarget"("dareId", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "DareTarget_dareId_discordId_key" ON "DareTarget"("dareId", "discordId");

-- CreateIndex
CREATE INDEX "DareEvidence_dareId_gameEndAt_matchId_idx" ON "DareEvidence"("dareId", "gameEndAt", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "DareEvidence_dareId_matchId_key" ON "DareEvidence"("dareId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "DareNotificationPreference_serverId_discordId_key" ON "DareNotificationPreference"("serverId", "discordId");

-- AddForeignKey
ALTER TABLE "ConfirmationIntent" ADD CONSTRAINT "ConfirmationIntent_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "Dare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DareActivation" ADD CONSTRAINT "DareActivation_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "Dare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DareRevision" ADD CONSTRAINT "DareRevision_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "Dare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DareTarget" ADD CONSTRAINT "DareTarget_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "Dare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DareEvidence" ADD CONSTRAINT "DareEvidence_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "Dare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Old Discord controls must never target a new Dare by a reused ID.
SELECT setval(pg_get_serial_sequence('"Dare"', 'id'), COALESCE((SELECT MAX(id) FROM "BucksDare"), 0) + 1, false);

-- Preserve inbox preferences independently of the retired wallet.
INSERT INTO "DareNotificationPreference" ("serverId", "discordId", "dareLifecycleDms", "dareProgressDms", "createdAt", "updatedAt")
SELECT "serverId", "discordId", "dareLifecycleDms", "dareProgressDms", "createdAt", "updatedAt" FROM "BucksNotificationPreference";

-- Retire durable economic work without touching unrelated match processing.
UPDATE "ScoutTemporalWork" SET "state" = 'failed', "failedAt" = CURRENT_TIMESTAMP, "lastError" = 'feature-retired', "updatedAt" = CURRENT_TIMESTAMP WHERE "kind" = 'parlay-generation' AND "state" IN ('queued', 'running');

-- New Dare IDs are disjoint from the archived history. No old notification may
-- be reinterpreted as a free Dare or sent as a monetary recap.
DELETE FROM "MatchNotificationIntent" WHERE "subjectKind" = 'dare';
UPDATE "MatchNotificationIntent"
SET "state" = 'suppressed',
    "suppressedReason" = 'feature-disabled',
    "payload" = jsonb_set("payload"::jsonb, '{data,state}', '{"kind":"suppressed","reason":"feature-disabled"}'::jsonb)::text,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "kind" = 'settlement' AND "state" IN ('pending', 'ready');

-- Only definitely unsent presentations may be rebuilt. Return their tip claims
-- before removing old betting controls or transfer tips from the frozen copy.
-- Delivered and uncertain attempts retain their original evidence.
DELETE FROM "FeatureTipImpression" impression
USING "NotificationPresentation" presentation, "MatchNotificationIntent" intent
WHERE intent."intentKey" = presentation."intentKey"
  AND intent."state" IN ('pending', 'ready')
  AND (intent."kind" = 'prematch' OR presentation."tipKey" = 'transfers')
  AND impression."serverId" = presentation."serverId"
  AND impression."audienceId" = ''
  AND impression."tipKey" = presentation."tipKey"
  AND impression."claimedAt" IS NOT NULL;

UPDATE "NotificationPresentation" presentation
SET "messageJson" = NULL, "tipKey" = NULL, "tipText" = NULL, "updatedAt" = CURRENT_TIMESTAMP
FROM "MatchNotificationIntent" intent
WHERE intent."intentKey" = presentation."intentKey"
  AND intent."state" IN ('pending', 'ready')
  AND (intent."kind" = 'prematch' OR presentation."tipKey" = 'transfers');

COMMIT;
