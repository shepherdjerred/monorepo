CREATE TYPE "FeedbackSource" AS ENUM ('WEB', 'DISCORD_DM');
CREATE TYPE "FeedbackReplyStatus" AS ENUM ('SENDING', 'SENT', 'FAILED', 'DM_DISABLED');

ALTER TABLE "Feedback"
  ADD COLUMN "source" "FeedbackSource" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "submissionId" TEXT,
  ADD COLUMN "discordMessageId" TEXT,
  ADD COLUMN "discordChannelId" TEXT,
  ADD COLUMN "discordUsername" TEXT,
  ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "readAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Feedback_submissionId_key" ON "Feedback"("submissionId");
CREATE UNIQUE INDEX "Feedback_discordMessageId_key" ON "Feedback"("discordMessageId");
CREATE INDEX "Feedback_readAt_id_idx" ON "Feedback"("readAt", "id");

CREATE TABLE "FeedbackReply" (
  "id" TEXT NOT NULL,
  "feedbackId" INTEGER NOT NULL,
  "operatorDiscordId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "FeedbackReplyStatus" NOT NULL DEFAULT 'SENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "FeedbackReply_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeedbackReply_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "FeedbackReply_feedbackId_createdAt_idx" ON "FeedbackReply"("feedbackId", "createdAt");
