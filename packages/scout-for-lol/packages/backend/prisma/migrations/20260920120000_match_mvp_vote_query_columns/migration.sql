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

CREATE INDEX "MatchMvpContest_gameCreationAt_idx"
    ON "MatchMvpContest"("gameCreationAt");

CREATE INDEX "MatchMvpContest_queueType_gameCreationAt_idx"
    ON "MatchMvpContest"("queueType", "gameCreationAt");

CREATE INDEX "MatchMvpVote_serverId_nomineePuuid_idx"
    ON "MatchMvpVote"("serverId", "nomineePuuid");
