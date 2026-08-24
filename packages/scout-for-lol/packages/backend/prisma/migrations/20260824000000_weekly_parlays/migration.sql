-- Weekly cross-game Bryan Bucks parlays use separate immutable definitions,
-- guild markets, positions, contributions, and delivery markers. Existing
-- match-bound parlay rows remain unchanged.
CREATE TABLE "BucksWeeklyParlayDefinition" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "openAt" TIMESTAMP(3) NOT NULL,
    "bettingClosesAt" TIMESTAMP(3) NOT NULL,
    "scoringStartsAt" TIMESTAMP(3) NOT NULL,
    "scoringEndsAt" TIMESTAMP(3) NOT NULL,
    "subjects" TEXT NOT NULL,
    "eligibleQueues" TEXT NOT NULL,
    "proposal" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "historySample" TEXT NOT NULL,
    "pricing" TEXT NOT NULL,
    "yesProbabilityBps" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "generationContext" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "resolvedModel" TEXT,
    "usage" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BucksWeeklyParlayDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksWeeklyParlayMarket" (
    "id" SERIAL NOT NULL,
    "definitionId" INTEGER NOT NULL,
    "serverId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "bettingClosesAt" TIMESTAMP(3) NOT NULL,
    "scoringEndsAt" TIMESTAMP(3) NOT NULL,
    "messageRefs" TEXT NOT NULL DEFAULT '[]',
    "marketState" TEXT NOT NULL DEFAULT 'publishing',
    "yesResult" BOOLEAN,
    "legResults" TEXT,
    "voidReason" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BucksWeeklyParlayMarket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksWeeklyParlayBet" (
    "id" SERIAL NOT NULL,
    "marketId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "houseReserve" INTEGER NOT NULL,
    "grossPayout" INTEGER NOT NULL,
    "betOutcome" TEXT NOT NULL DEFAULT 'pending',
    "payout" INTEGER,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BucksWeeklyParlayBet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksWeeklyParlayContribution" (
    "id" SERIAL NOT NULL,
    "definitionId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL,
    "queueType" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BucksWeeklyParlayContribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BucksWeeklyParlayDelivery" (
    "id" SERIAL NOT NULL,
    "marketId" INTEGER NOT NULL,
    "actionKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "deliveryState" TEXT NOT NULL DEFAULT 'pending',
    "messageRefs" TEXT NOT NULL DEFAULT '[]',
    "attemptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BucksWeeklyParlayDelivery_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BucksLedgerEntry" ADD COLUMN "weeklyParlayBetId" INTEGER;

CREATE UNIQUE INDEX "BucksWeeklyParlayDefinition_serverId_scoringStartsAt_slot_key" ON "BucksWeeklyParlayDefinition"("serverId", "scoringStartsAt", "slot");
CREATE UNIQUE INDEX "BucksWeeklyParlayDefinition_serverId_periodKey_slot_key" ON "BucksWeeklyParlayDefinition"("serverId", "periodKey", "slot");
CREATE INDEX "BucksWeeklyParlayDefinition_scoringStartsAt_scoringEndsAt_idx" ON "BucksWeeklyParlayDefinition"("scoringStartsAt", "scoringEndsAt");
CREATE UNIQUE INDEX "BucksWeeklyParlayMarket_definitionId_key" ON "BucksWeeklyParlayMarket"("definitionId");
CREATE UNIQUE INDEX "BucksWeeklyParlayMarket_serverId_periodKey_slot_key" ON "BucksWeeklyParlayMarket"("serverId", "periodKey", "slot");
CREATE INDEX "BucksWeeklyParlayMarket_marketState_bettingClosesAt_idx" ON "BucksWeeklyParlayMarket"("marketState", "bettingClosesAt");
CREATE INDEX "BucksWeeklyParlayMarket_marketState_scoringEndsAt_idx" ON "BucksWeeklyParlayMarket"("marketState", "scoringEndsAt");
CREATE UNIQUE INDEX "BucksWeeklyParlayBet_marketId_bucksAccountId_key" ON "BucksWeeklyParlayBet"("marketId", "bucksAccountId");
CREATE INDEX "BucksWeeklyParlayBet_marketId_side_idx" ON "BucksWeeklyParlayBet"("marketId", "side");
CREATE UNIQUE INDEX "BucksWeeklyParlayContribution_definitionId_matchId_subjectKey_key" ON "BucksWeeklyParlayContribution"("definitionId", "matchId", "subjectKey");
CREATE INDEX "BucksWeeklyParlayContribution_definitionId_completedAt_idx" ON "BucksWeeklyParlayContribution"("definitionId", "completedAt");
CREATE INDEX "BucksWeeklyParlayContribution_matchId_idx" ON "BucksWeeklyParlayContribution"("matchId");
CREATE UNIQUE INDEX "BucksWeeklyParlayDelivery_marketId_actionKey_key" ON "BucksWeeklyParlayDelivery"("marketId", "actionKey");
CREATE INDEX "BucksWeeklyParlayDelivery_deliveryState_scheduledAt_idx" ON "BucksWeeklyParlayDelivery"("deliveryState", "scheduledAt");

ALTER TABLE "BucksWeeklyParlayMarket" ADD CONSTRAINT "BucksWeeklyParlayMarket_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "BucksWeeklyParlayDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksWeeklyParlayBet" ADD CONSTRAINT "BucksWeeklyParlayBet_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "BucksWeeklyParlayMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksWeeklyParlayBet" ADD CONSTRAINT "BucksWeeklyParlayBet_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksWeeklyParlayContribution" ADD CONSTRAINT "BucksWeeklyParlayContribution_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "BucksWeeklyParlayDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksWeeklyParlayDelivery" ADD CONSTRAINT "BucksWeeklyParlayDelivery_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "BucksWeeklyParlayMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucksLedgerEntry" ADD CONSTRAINT "BucksLedgerEntry_weeklyParlayBetId_fkey" FOREIGN KEY ("weeklyParlayBetId") REFERENCES "BucksWeeklyParlayBet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
