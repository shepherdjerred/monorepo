-- Append-only Clash membership and game sightings. Current snapshot tables
-- stay replace-on-poll; these rows are never deleted by the Clash snapshot.
CREATE TABLE "ClashMembershipHistory" (
    "id" SERIAL NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "tournamentRiotId" INTEGER NOT NULL,
    "teamRiotId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "teamAbbreviation" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "nameKeySecondary" TEXT NOT NULL,
    "windowStartAt" TIMESTAMP(3) NOT NULL,
    "windowEndAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClashMembershipHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClashMembershipHistory_puuid_platform_tournamentRiotId_key" ON "ClashMembershipHistory"("puuid", "platform", "tournamentRiotId");
CREATE INDEX "ClashMembershipHistory_puuid_idx" ON "ClashMembershipHistory"("puuid");
CREATE INDEX "ClashMembershipHistory_platform_windowStartAt_windowEndAt_idx" ON "ClashMembershipHistory"("platform", "windowStartAt", "windowEndAt");

CREATE TABLE "ClashGameSighting" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "win" BOOLEAN,
    "teamRiotId" TEXT,
    "cupKey" TEXT,
    "cupDay" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClashGameSighting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClashGameSighting_platform_gameId_puuid_key" ON "ClashGameSighting"("platform", "gameId", "puuid");
CREATE INDEX "ClashGameSighting_puuid_observedAt_idx" ON "ClashGameSighting"("puuid", "observedAt");
CREATE INDEX "ClashGameSighting_cupKey_cupDay_idx" ON "ClashGameSighting"("cupKey", "cupDay");
