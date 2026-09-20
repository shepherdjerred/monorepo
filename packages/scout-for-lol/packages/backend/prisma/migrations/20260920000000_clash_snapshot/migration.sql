-- Clash-v1 current snapshots. Replaced on each poll; empty when Clash is inactive.
CREATE TABLE "ClashTournament" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "riotId" INTEGER NOT NULL,
    "themeId" INTEGER NOT NULL,
    "nameKey" TEXT NOT NULL,
    "nameKeySecondary" TEXT NOT NULL,
    "scheduleJson" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClashTournament_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClashTournament_platform_riotId_key" ON "ClashTournament"("platform", "riotId");

CREATE TABLE "ClashTeam" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "riotId" TEXT NOT NULL,
    "tournamentRiotId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "iconId" INTEGER NOT NULL,
    "tier" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClashTeam_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClashTeam_platform_riotId_key" ON "ClashTeam"("platform", "riotId");
CREATE INDEX "ClashTeam_platform_tournamentRiotId_idx" ON "ClashTeam"("platform", "tournamentRiotId");

CREATE TABLE "ClashRegistration" (
    "id" SERIAL NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "teamRiotId" TEXT NOT NULL,
    "tournamentRiotId" INTEGER NOT NULL,
    "position" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClashRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClashRegistration_puuid_region_tournamentRiotId_key" ON "ClashRegistration"("puuid", "region", "tournamentRiotId");
CREATE INDEX "ClashRegistration_puuid_idx" ON "ClashRegistration"("puuid");
CREATE INDEX "ClashRegistration_platform_teamRiotId_idx" ON "ClashRegistration"("platform", "teamRiotId");
