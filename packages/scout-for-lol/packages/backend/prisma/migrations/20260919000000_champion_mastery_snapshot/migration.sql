CREATE TABLE "ChampionMasterySnapshot" (
    "puuid" TEXT NOT NULL,
    "entriesJson" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChampionMasterySnapshot_pkey" PRIMARY KEY ("puuid")
);
