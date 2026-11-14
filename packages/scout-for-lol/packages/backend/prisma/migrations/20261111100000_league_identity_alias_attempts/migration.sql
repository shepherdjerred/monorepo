-- CreateTable
CREATE TABLE "LeagueIdentityAliasAttempt" (
    "lcuUuid" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "gameName" TEXT,
    "tagLine" TEXT,
    "platformId" TEXT,
    "learnedFromDeviceId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorClass" TEXT,
    "observationIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueIdentityAliasAttempt_pkey" PRIMARY KEY ("lcuUuid")
);

-- CreateIndex
CREATE INDEX "LeagueIdentityAliasAttempt_state_nextAttemptAt_idx" ON "LeagueIdentityAliasAttempt"("state", "nextAttemptAt");

-- A mapping proven against a game Riot also published outranks a Riot ID lookup.
ALTER TABLE "LeagueIdentityAlias" DROP CONSTRAINT "LeagueIdentityAlias_source_check";
ALTER TABLE "LeagueIdentityAlias" ADD CONSTRAINT "LeagueIdentityAlias_source_check" CHECK ("source" IN ('riot_id', 'riot_match'));

ALTER TABLE "LeagueIdentityAliasAttempt" ADD CONSTRAINT "LeagueIdentityAliasAttempt_state_check" CHECK ("state" IN ('pending', 'resolved', 'not_found', 'no_riot_id'));
