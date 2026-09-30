-- Community MVP votes for Flex post-match reports.
--
-- The contest freezes the 10-player roster once per Riot match so Discord
-- custom IDs can name a participant by index. Votes are guild-scoped: the
-- same match has independent ballots in every Discord server.

CREATE TABLE "MatchMvpContest" (
    "matchId" TEXT NOT NULL,
    "roster" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchMvpContest_pkey" PRIMARY KEY ("matchId")
);

CREATE TABLE "MatchMvpVote" (
    "id" SERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "voterDiscordId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "nomineeIndex" INTEGER NOT NULL,
    "voterPuuid" TEXT NOT NULL,
    "voterTeamId" INTEGER NOT NULL,
    "justification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchMvpVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchMvpVote_matchId_serverId_voterDiscordId_category_key"
    ON "MatchMvpVote"("matchId", "serverId", "voterDiscordId", "category");

CREATE INDEX "MatchMvpVote_matchId_serverId_category_idx"
    ON "MatchMvpVote"("matchId", "serverId", "category");
