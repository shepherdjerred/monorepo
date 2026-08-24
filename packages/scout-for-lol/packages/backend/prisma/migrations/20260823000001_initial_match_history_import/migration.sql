CREATE TABLE "InitialMatchHistoryImport" (
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "matchIdsJson" TEXT,
    "snapshotAt" TIMESTAMP(3),
    "nextMatchIndex" INTEGER NOT NULL DEFAULT 0,
    "newestMatchId" TEXT,
    "newestMatchTime" TIMESTAMP(3),
    "cursorHandedOffAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "lastImportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InitialMatchHistoryImport_pkey" PRIMARY KEY ("puuid"),
    CONSTRAINT "InitialMatchHistoryImport_phase_check"
      CHECK ("phase" IN ('queued', 'matches', 'rank', 'publish', 'complete', 'failed')),
    CONSTRAINT "InitialMatchHistoryImport_progress_check"
      CHECK ("nextMatchIndex" >= 0 AND "nextMatchIndex" <= 20),
    CONSTRAINT "InitialMatchHistoryImport_attempt_count_check"
      CHECK ("attemptCount" >= 0),
    CONSTRAINT "InitialMatchHistoryImport_error_code_check"
      CHECK (
        "errorCode" IS NULL OR
        "errorCode" IN (
          'rate_limit', 'upstream', 'transport', 'storage', 'staging',
          'authentication', 'contract', 'untracked'
        )
      )
);

CREATE TABLE "CurrentRankSnapshot" (
    "puuid" TEXT NOT NULL,
    "soloRank" TEXT,
    "flexRank" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentRankSnapshot_pkey" PRIMARY KEY ("puuid")
);

CREATE INDEX "InitialMatchHistoryImport_phase_nextAttemptAt_requestedAt_idx"
ON "InitialMatchHistoryImport"("phase", "nextAttemptAt", "requestedAt");
