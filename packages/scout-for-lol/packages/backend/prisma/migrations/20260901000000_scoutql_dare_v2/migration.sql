-- ScoutQL-backed Dare v2 lives beside the frozen v1 tables. Draft revisions
-- are append-only; funding freezes one revision and begins the consent flow.
CREATE TABLE "BucksDareV2" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "challengerDiscordId" TEXT NOT NULL,
    "originConversationId" TEXT,
    "dareState" TEXT NOT NULL DEFAULT 'draft',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "fundedRevision" INTEGER,
    "contractJson" TEXT,
    "openingStake" INTEGER NOT NULL,
    "potTotal" INTEGER NOT NULL DEFAULT 0,
    "proposalExpiresAt" TIMESTAMP(3),
    "acceptDeadline" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "finalValue" BOOLEAN,
    "proofJson" TEXT,
    "voidReason" TEXT,
    "messageRef" TEXT,
    "calloutClaimId" TEXT,
    "calloutClaimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BucksDareV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksDareV2Revision" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "originalText" TEXT NOT NULL,
    "canonicalScoutQl" TEXT NOT NULL,
    "compiledPlan" TEXT NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "targetsJson" TEXT NOT NULL,
    "deadlineSpecJson" TEXT NOT NULL,
    "openingStake" INTEGER NOT NULL,
    "plainLanguage" TEXT NOT NULL,
    "semanticProofPlan" TEXT NOT NULL,
    "translationJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BucksDareV2Revision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksDareV2Target" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
    "targetKey" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "accounts" TEXT NOT NULL,
    "bucksAccountId" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "payout" INTEGER,
    "fee" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BucksDareV2Target_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksDareV2Contribution" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "discordId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BucksDareV2Contribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksDareV2Evidence" (
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
    CONSTRAINT "BucksDareV2Evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksDareV2ConfirmationIntent" (
    "id" TEXT NOT NULL,
    "dareId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actionPayload" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "resultJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BucksDareV2ConfirmationIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BucksDareV2_challengerDiscordId_dareState_updatedAt_idx" ON "BucksDareV2"("challengerDiscordId", "dareState", "updatedAt");
CREATE INDEX "BucksDareV2_serverId_dareState_updatedAt_idx" ON "BucksDareV2"("serverId", "dareState", "updatedAt");
CREATE INDEX "BucksDareV2_dareState_acceptDeadline_idx" ON "BucksDareV2"("dareState", "acceptDeadline");
CREATE INDEX "BucksDareV2_dareState_deadlineAt_idx" ON "BucksDareV2"("dareState", "deadlineAt");
CREATE UNIQUE INDEX "BucksDareV2Revision_dareId_revision_key" ON "BucksDareV2Revision"("dareId", "revision");
CREATE UNIQUE INDEX "BucksDareV2Target_dareId_targetKey_key" ON "BucksDareV2Target"("dareId", "targetKey");
CREATE UNIQUE INDEX "BucksDareV2Target_dareId_discordId_key" ON "BucksDareV2Target"("dareId", "discordId");
CREATE INDEX "BucksDareV2Contribution_dareId_idx" ON "BucksDareV2Contribution"("dareId");
CREATE INDEX "BucksDareV2Contribution_bucksAccountId_idx" ON "BucksDareV2Contribution"("bucksAccountId");
CREATE UNIQUE INDEX "BucksDareV2Evidence_dareId_matchId_key" ON "BucksDareV2Evidence"("dareId", "matchId");
CREATE INDEX "BucksDareV2Evidence_dareId_gameEndAt_matchId_idx" ON "BucksDareV2Evidence"("dareId", "gameEndAt", "matchId");
CREATE UNIQUE INDEX "BucksDareV2ConfirmationIntent_idempotencyKey_key" ON "BucksDareV2ConfirmationIntent"("idempotencyKey");
CREATE INDEX "BucksDareV2ConfirmationIntent_dareId_expiresAt_idx" ON "BucksDareV2ConfirmationIntent"("dareId", "expiresAt");

ALTER TABLE "BucksDareV2Revision" ADD CONSTRAINT "BucksDareV2Revision_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDareV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksDareV2Target" ADD CONSTRAINT "BucksDareV2Target_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDareV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksDareV2Contribution" ADD CONSTRAINT "BucksDareV2Contribution_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDareV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksDareV2Contribution" ADD CONSTRAINT "BucksDareV2Contribution_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksDareV2Evidence" ADD CONSTRAINT "BucksDareV2Evidence_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDareV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksDareV2ConfirmationIntent" ADD CONSTRAINT "BucksDareV2ConfirmationIntent_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDareV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
