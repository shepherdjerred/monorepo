-- The League client and Riot's API name the same player differently: a
-- 36-character UUID locally, a 78-character PUUID encrypted per API key
-- remotely. Every Scout Client observation was quarantined as
-- `unverified_local_puuid` because ingress compared the two by equality.
CREATE TABLE "LeagueIdentityAlias" (
  "lcuUuid" TEXT NOT NULL,
  "puuid" TEXT NOT NULL,
  "gameName" TEXT NOT NULL,
  "tagLine" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  -- The PUUID belongs to the reporting device's owner. A verified alias may
  -- replace an unverified one; nothing replaces a verified alias.
  "ownerVerified" BOOLEAN NOT NULL DEFAULT false,
  "learnedFromDeviceId" TEXT,
  "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LeagueIdentityAlias_pkey" PRIMARY KEY ("lcuUuid"),
  CONSTRAINT "LeagueIdentityAlias_source_check" CHECK ("source" IN ('riot_id')),
  CONSTRAINT "LeagueIdentityAlias_puuid_check" CHECK (length("puuid") = 78)
);

CREATE INDEX "LeagueIdentityAlias_puuid_idx" ON "LeagueIdentityAlias"("puuid");

-- Keep the identity the client actually sent beside the translated one.
ALTER TABLE "ScoutClientObservation" ADD COLUMN "localLcuUuid" TEXT;
