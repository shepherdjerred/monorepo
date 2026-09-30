CREATE TABLE "MatchMvpReportTarget" (
  "matchId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MatchMvpReportTarget_pkey" PRIMARY KEY ("matchId", "channelId", "messageId")
);

CREATE INDEX "MatchMvpReportTarget_matchId_serverId_idx"
ON "MatchMvpReportTarget"("matchId", "serverId");
