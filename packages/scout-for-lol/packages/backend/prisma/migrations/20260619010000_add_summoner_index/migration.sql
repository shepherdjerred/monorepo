-- Global cache of known summoners powering prefix autocomplete in the web
-- "add player" flow. Self-maintained: upserted on confirmed Riot resolutions
-- (and a one-off backfill from Account / PrematchParticipantFact), evicted
-- when Riot can no longer resolve a Riot ID.
CREATE TABLE "SummonerIndex" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "puuid" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lastVerifiedAt" DATETIME NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "SummonerIndex_puuid_key" ON "SummonerIndex"("puuid");

-- Prefix-autocomplete on gameName (SQLite LIKE 'q%').
CREATE INDEX "SummonerIndex_gameName_idx" ON "SummonerIndex"("gameName");
