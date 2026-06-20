-- The Account table previously stored only a user-chosen `alias` plus the
-- PUUID, so the web UI could not show the real Riot ID (gameName#tagLine) —
-- several accounts under one player all rendered the same alias. Cache the
-- resolved Riot ID here (nullable until first resolved; refreshed on read
-- when older than 24h). Resolves the long-standing schema TODO #186.
ALTER TABLE "Account" ADD COLUMN "riotGameName" TEXT;
ALTER TABLE "Account" ADD COLUMN "riotTagLine" TEXT;
ALTER TABLE "Account" ADD COLUMN "riotIdUpdatedAt" DATETIME;
