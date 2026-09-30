-- Denormalize contest time/queue and vote nominee identity so guild-scoped
-- leaderboards and match tallies do not parse frozen roster JSON at query time.

ALTER TABLE "MatchMvpContest" ADD COLUMN "gameCreationAt" TIMESTAMP(3);
ALTER TABLE "MatchMvpContest" ADD COLUMN "queueType" TEXT;

ALTER TABLE "MatchMvpVote" ADD COLUMN "nomineePuuid" TEXT;
ALTER TABLE "MatchMvpVote" ADD COLUMN "nomineeTeamId" INTEGER;

UPDATE "MatchMvpVote" AS v
SET
    "nomineePuuid" = c.roster -> 'participants' -> v."nomineeIndex" ->> 'puuid',
    "nomineeTeamId" = (c.roster -> 'participants' -> v."nomineeIndex" ->> 'teamId')::integer
FROM "MatchMvpContest" AS c
WHERE c."matchId" = v."matchId";

-- Existing contests were created before these columns. Date-bounded
-- leaderboards filter on gameCreationAt, so leave no pre-migration row null
-- when MatchObservation already holds the Riot game-creation timestamp.
UPDATE "MatchMvpContest" AS c
SET "gameCreationAt" = o."gameCreatedAt"
FROM "MatchObservation" AS o
WHERE o."riotMatchId" = c."matchId"
  AND c."gameCreationAt" IS NULL;

UPDATE "MatchMvpContest" AS c
SET "gameCreationAt" = r."matchGameCreationAt"
FROM (
    SELECT DISTINCT ON ("matchId")
        "matchId",
        "matchGameCreationAt"
    FROM "MatchRankHistory"
    WHERE "matchGameCreationAt" IS NOT NULL
    ORDER BY "matchId"
) AS r
WHERE r."matchId" = c."matchId"
  AND c."gameCreationAt" IS NULL;

-- Contests only existed for Flex attach before this column.
UPDATE "MatchMvpContest"
SET "queueType" = 'flex'
WHERE "queueType" IS NULL;

CREATE INDEX "MatchMvpContest_gameCreationAt_idx"
    ON "MatchMvpContest"("gameCreationAt");

CREATE INDEX "MatchMvpContest_queueType_gameCreationAt_idx"
    ON "MatchMvpContest"("queueType", "gameCreationAt");

CREATE INDEX "MatchMvpVote_serverId_nomineePuuid_idx"
    ON "MatchMvpVote"("serverId", "nomineePuuid");
