-- CreateTable: MatchAiAttempt
-- Persistent dedup record: one row per matchId for which the AI review
-- pipeline has been entered. Inserted before the first OpenAI call so that
-- a mid-pipeline crash still leaves the row, preventing duplicate spend
-- on retry.
CREATE TABLE "MatchAiAttempt" (
    "matchId" TEXT NOT NULL PRIMARY KEY,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
