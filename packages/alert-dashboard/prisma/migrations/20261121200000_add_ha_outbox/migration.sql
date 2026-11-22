-- AlterTable
ALTER TABLE "AlertOccurrence" ADD COLUMN "haNotifiedAtNs" BIGINT;

-- CreateTable
CREATE TABLE "HomeAssistantOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurrenceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "title" TEXT,
    "message" TEXT,
    "createdAtNs" BIGINT NOT NULL,
    "nextAttemptAtNs" BIGINT NOT NULL,
    "sentAtNs" BIGINT,
    "sendingAtNs" BIGINT,
    "sendClaimId" TEXT,
    "canceledAtNs" BIGINT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    CONSTRAINT "HomeAssistantOutbox_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "AlertOccurrence" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HomeAssistantOutbox_sentAtNs_canceledAtNs_sendingAtNs_nextAttemptAtNs_idx" ON "HomeAssistantOutbox"("sentAtNs", "canceledAtNs", "sendingAtNs", "nextAttemptAtNs");

-- CreateIndex
CREATE INDEX "HomeAssistantOutbox_occurrenceId_action_sentAtNs_canceledAtNs_idx" ON "HomeAssistantOutbox"("occurrenceId", "action", "sentAtNs", "canceledAtNs");
