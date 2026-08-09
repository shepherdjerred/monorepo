-- Somewhere for feedback to actually land. Every previous path was a one-way
-- DM ending in "reply to a human", so nothing was ever captured.
CREATE TABLE "Feedback" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "discordId" TEXT NOT NULL,
  "serverId" TEXT,
  "rating" INTEGER,
  "body" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");
CREATE INDEX "Feedback_discordId_createdAt_idx" ON "Feedback"("discordId", "createdAt");
