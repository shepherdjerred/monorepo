CREATE TABLE "MatchReportSnapshot" (
  "riotMatchId" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "MatchReportSnapshot_pkey" PRIMARY KEY ("riotMatchId")
);
