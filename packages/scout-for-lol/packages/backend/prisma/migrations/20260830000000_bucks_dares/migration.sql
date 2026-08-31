-- Free-text dare bounties: a one-sided pot contributors fund and targets win
-- by achieving a translated, code-evaluated condition off ingested match
-- data. Targets, contributions, and captured games hang off the dare and
-- cascade with it; existing Bucks rows remain unchanged.
-- CreateTable
CREATE TABLE "BucksDare" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "challengerDiscordId" TEXT NOT NULL,
    "horizonKind" TEXT NOT NULL,
    "windowDays" INTEGER,
    "windowEndsAt" TIMESTAMP(3),
    "conditions" TEXT NOT NULL,
    "conditionVersion" INTEGER NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "translation" TEXT,
    "potTotal" INTEGER NOT NULL DEFAULT 0,
    "dareState" TEXT NOT NULL DEFAULT 'proposed',
    "proposalExpiresAt" TIMESTAMP(3) NOT NULL,
    "acceptDeadline" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "messageRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucksDare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksDareTarget" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
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

    CONSTRAINT "BucksDareTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksDareContribution" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "discordId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BucksDareContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucksDareGame" (
    "id" SERIAL NOT NULL,
    "dareId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "gameStartAt" TIMESTAMP(3) NOT NULL,
    "gameEndAt" TIMESTAMP(3) NOT NULL,
    "queueType" TEXT NOT NULL,
    "leafHits" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BucksDareGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BucksDare_dareState_proposalExpiresAt_idx" ON "BucksDare"("dareState", "proposalExpiresAt");

-- CreateIndex
CREATE INDEX "BucksDare_dareState_acceptDeadline_idx" ON "BucksDare"("dareState", "acceptDeadline");

-- CreateIndex
CREATE INDEX "BucksDare_dareState_windowEndsAt_idx" ON "BucksDare"("dareState", "windowEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "BucksDareTarget_dareId_discordId_key" ON "BucksDareTarget"("dareId", "discordId");

-- CreateIndex
CREATE INDEX "BucksDareContribution_dareId_idx" ON "BucksDareContribution"("dareId");

-- CreateIndex
CREATE INDEX "BucksDareContribution_bucksAccountId_idx" ON "BucksDareContribution"("bucksAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BucksDareGame_dareId_matchId_key" ON "BucksDareGame"("dareId", "matchId");

-- AddForeignKey
ALTER TABLE "BucksDareTarget" ADD CONSTRAINT "BucksDareTarget_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksDareContribution" ADD CONSTRAINT "BucksDareContribution_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksDareContribution" ADD CONSTRAINT "BucksDareContribution_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucksDareGame" ADD CONSTRAINT "BucksDareGame_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

