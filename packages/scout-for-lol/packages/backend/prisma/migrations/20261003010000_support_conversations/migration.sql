CREATE TYPE "SupportDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "SupportConversationStatus" AS ENUM ('OPEN', 'WAITING_ON_USER', 'RESOLVED');
CREATE TYPE "SupportCategory" AS ENUM ('HELP', 'BUG', 'IDEA');
CREATE TYPE "SupportAttachmentStatus" AS ENUM ('PENDING', 'STORED', 'FAILED');
CREATE TYPE "SupportJobKind" AS ENUM ('ALERT', 'ACKNOWLEDGEMENT', 'REPLY', 'ARCHIVE', 'DELETE_OBJECT');
CREATE TYPE "SupportJobStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'BLOCKED', 'UNKNOWN', 'SKIPPED');
ALTER TYPE "FeedbackSource" ADD VALUE 'DISCORD_MODAL';
ALTER TYPE "FeedbackReplyStatus" ADD VALUE 'QUEUED';

CREATE TABLE "SupportConversation" (
  "id" TEXT PRIMARY KEY, "discordId" TEXT NOT NULL UNIQUE, "username" TEXT,
  "status" "SupportConversationStatus" NOT NULL DEFAULT 'OPEN', "category" "SupportCategory",
  "muted" BOOLEAN NOT NULL DEFAULT false, "operatorReadAt" TIMESTAMP(3), "userReadAt" TIMESTAMP(3), "userReadMessageId" INTEGER NOT NULL DEFAULT 0,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAlertAt" TIMESTAMP(3), "lastReceiptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportConversation_status_lastMessageAt_id_idx" ON "SupportConversation"("status", "lastMessageAt", "id");
ALTER TABLE "Feedback" ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "direction" "SupportDirection" NOT NULL DEFAULT 'INBOUND',
  ADD COLUMN "authorDiscordId" TEXT, ADD COLUMN "context" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Feedback_conversationId_createdAt_id_idx" ON "Feedback"("conversationId", "createdAt", "id");
ALTER TABLE "FeedbackReply" DROP CONSTRAINT "FeedbackReply_feedbackId_fkey";
ALTER TABLE "FeedbackReply" ADD CONSTRAINT "FeedbackReply_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve all historical feedback and read state; do not mint delivery jobs.
INSERT INTO "SupportConversation" ("id", "discordId", "username", "createdAt", "lastMessageAt", "operatorReadAt")
SELECT gen_random_uuid()::text, "discordId", max("discordUsername"), min("createdAt"), max("createdAt"),
 CASE WHEN bool_and("readAt" IS NOT NULL) THEN max("readAt") ELSE NULL END
FROM "Feedback" GROUP BY "discordId";
UPDATE "Feedback" f SET "conversationId" = c."id" FROM "SupportConversation" c WHERE f."discordId" = c."discordId";
-- Historical replies become first-class timeline messages, including failed DMs.
DO $$ DECLARE r RECORD; new_id INTEGER; BEGIN
 FOR r IN SELECT fr.*, f."discordId", f."conversationId" FROM "FeedbackReply" fr JOIN "Feedback" f ON f.id = fr."feedbackId" LOOP
  INSERT INTO "Feedback" ("discordId", "conversationId", body, "createdAt", "direction", "authorDiscordId")
  VALUES (r."discordId", r."conversationId", r.body, r."createdAt", 'OUTBOUND', r."operatorDiscordId") RETURNING id INTO new_id;
  UPDATE "FeedbackReply" SET "feedbackId" = new_id WHERE id = r.id;
 END LOOP;
END $$;
UPDATE "SupportConversation" c SET "lastMessageAt" = (SELECT max("createdAt") FROM "Feedback" WHERE "conversationId" = c.id);

CREATE TABLE "SupportAttachment" (
 "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "feedbackId" INTEGER REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "name" TEXT NOT NULL, "contentType" TEXT NOT NULL, "size" INTEGER NOT NULL, "sourceUrl" TEXT, "digest" TEXT,
 "objectKey" TEXT NOT NULL UNIQUE, "status" "SupportAttachmentStatus" NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportAttachment_feedbackId_idx" ON "SupportAttachment"("feedbackId");
CREATE INDEX "SupportAttachment_createdAt_idx" ON "SupportAttachment"("createdAt");
CREATE TABLE "SupportJob" (
 "id" TEXT PRIMARY KEY, "kind" "SupportJobKind" NOT NULL, "status" "SupportJobStatus" NOT NULL DEFAULT 'QUEUED',
 "conversationId" TEXT REFERENCES "SupportConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "attachmentId" TEXT REFERENCES "SupportAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "replyId" TEXT, "objectKey" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0, "errorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportJob_status_createdAt_idx" ON "SupportJob"("status", "createdAt");
CREATE TABLE "SupportTouchpoint" (
 "id" TEXT PRIMARY KEY, "surface" TEXT NOT NULL, "action" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportTouchpoint_createdAt_surface_action_idx" ON "SupportTouchpoint"("createdAt", "surface", "action");
