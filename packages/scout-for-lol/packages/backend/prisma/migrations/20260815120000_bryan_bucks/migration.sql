-- Bryan Bucks: a friendly, per-guild betting economy over the existing
-- prematch/postmatch match lifecycle. No monetary value; nothing transfers to
-- real goods.
--
-- Five tables, and the reasons the shapes are what they are:
--
-- BucksAccount.balance is a STORED column rather than a ledger sum. Checking
-- affordability has to be atomic, and `SELECT SUM(delta)` then `INSERT` is a
-- read-then-write inside a WAL transaction — the libsql adapter opens a
-- deferred BEGIN, so a concurrent committer yields SQLITE_BUSY_SNAPSHOT, which
-- `busy_timeout` does not retry. One guarded `UPDATE ... WHERE balance >= ?`
-- is the whole double-spend guard. The balance and its ledger row commit in a
-- single transaction, so they cannot disagree.
--
-- BucksLedgerEntry is append-only and is the source of truth; the balance
-- column is reconciled against it, never trusted over it.
--
-- BucksMatchPool is keyed (matchId, serverId) rather than matchId alone: one
-- Riot match can be announced in several guilds, and paying one guild's
-- winners out of another's losers would be wrong. Its `poolState` column is
-- the settlement idempotency token — every side effect of settlement is local,
-- so the state transition commits WITH the payouts and no separate marker
-- table is needed.
--
-- BucksMatchEarning does need a marker, because earnings have no natural
-- per-(match, guild) row. Its composite primary key is the race guard against
-- gap-detection replays reprocessing the same match.

-- CreateTable
CREATE TABLE "BucksAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BucksLedgerEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bucksAccountId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "matchId" TEXT,
    "betId" INTEGER,
    "predictedTeamId" INTEGER,
    "actualWinningTeamId" INTEGER,
    "context" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BucksLedgerEntry_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BucksLedgerEntry_betId_fkey" FOREIGN KEY ("betId") REFERENCES "BucksBet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BucksBet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "poolId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "predictedTeamId" INTEGER NOT NULL,
    "subjectPuuid" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "betOutcome" TEXT NOT NULL DEFAULT 'pending',
    "payout" INTEGER,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BucksBet_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "BucksMatchPool" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BucksBet_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BucksMatchPool" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL,
    "closesAt" DATETIME NOT NULL,
    "queueType" TEXT,
    "roster" TEXT NOT NULL,
    "messageRefs" TEXT NOT NULL DEFAULT '[]',
    "poolState" TEXT NOT NULL DEFAULT 'open',
    "winningTeamId" INTEGER,
    "voidReason" TEXT,
    "predictionJson" TEXT,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BucksMatchEarning" (
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryCount" INTEGER NOT NULL,

    PRIMARY KEY ("matchId", "serverId")
);

-- CreateIndex
CREATE INDEX "BucksAccount_serverId_balance_idx" ON "BucksAccount"("serverId", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "BucksAccount_serverId_discordId_key" ON "BucksAccount"("serverId", "discordId");

-- CreateIndex
CREATE INDEX "BucksLedgerEntry_bucksAccountId_createdAt_idx" ON "BucksLedgerEntry"("bucksAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "BucksLedgerEntry_matchId_idx" ON "BucksLedgerEntry"("matchId");

-- CreateIndex
CREATE INDEX "BucksBet_poolId_predictedTeamId_idx" ON "BucksBet"("poolId", "predictedTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "BucksBet_poolId_bucksAccountId_key" ON "BucksBet"("poolId", "bucksAccountId");

-- CreateIndex
CREATE INDEX "BucksMatchPool_poolState_closesAt_idx" ON "BucksMatchPool"("poolState", "closesAt");

-- CreateIndex
CREATE INDEX "BucksMatchPool_matchId_idx" ON "BucksMatchPool"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "BucksMatchPool_matchId_serverId_key" ON "BucksMatchPool"("matchId", "serverId");
