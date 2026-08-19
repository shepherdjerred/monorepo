-- One match-global, deterministically-settled parlay definition generated from
-- the frozen prematch lobby. The model may choose only from the versioned
-- criteria catalog stored in `criteria`.
CREATE TABLE "BucksParlayDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "matchId" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "selectedTeamId" INTEGER NOT NULL,
    "subjects" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "yesProbabilityBps" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "generationContext" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "resolvedModel" TEXT,
    "usage" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "BucksParlayDefinition_matchId_key"
ON "BucksParlayDefinition"("matchId");

-- One independently-timed publication per existing guild outcome pool.
CREATE TABLE "BucksParlayMarket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "definitionId" INTEGER NOT NULL,
    "outcomePoolId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "closesAt" DATETIME NOT NULL,
    "messageRefs" TEXT NOT NULL DEFAULT '[]',
    "marketState" TEXT NOT NULL DEFAULT 'publishing',
    "yesResult" BOOLEAN,
    "legResults" TEXT,
    "voidReason" TEXT,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BucksParlayMarket_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "BucksParlayDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BucksParlayMarket_outcomePoolId_fkey" FOREIGN KEY ("outcomePoolId") REFERENCES "BucksMatchPool" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BucksParlayMarket_outcomePoolId_key"
ON "BucksParlayMarket"("outcomePoolId");
CREATE UNIQUE INDEX "BucksParlayMarket_matchId_serverId_key"
ON "BucksParlayMarket"("matchId", "serverId");
CREATE INDEX "BucksParlayMarket_marketState_closesAt_idx"
ON "BucksParlayMarket"("marketState", "closesAt");
CREATE INDEX "BucksParlayMarket_matchId_idx"
ON "BucksParlayMarket"("matchId");

-- Fixed-odds positions reserve their full maximum house liability at
-- placement, so every accepted wager remains funded even if later placements
-- exhaust the house account.
CREATE TABLE "BucksParlayBet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "houseReserve" INTEGER NOT NULL,
    "grossPayout" INTEGER NOT NULL,
    "betOutcome" TEXT NOT NULL DEFAULT 'pending',
    "payout" INTEGER,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BucksParlayBet_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "BucksParlayMarket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BucksParlayBet_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BucksParlayBet_marketId_bucksAccountId_key"
ON "BucksParlayBet"("marketId", "bucksAccountId");
CREATE INDEX "BucksParlayBet_marketId_side_idx"
ON "BucksParlayBet"("marketId", "side");

-- Ledger links are optional because cancelling a position deletes the mutable
-- position row while its append-only movement history remains.
ALTER TABLE "BucksLedgerEntry"
ADD COLUMN "parlayBetId" INTEGER REFERENCES "BucksParlayBet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
