-- AlterTable
ALTER TABLE "EmailOutbox" ADD COLUMN "sendingAtNs" BIGINT;

-- ReplaceIndex
DROP INDEX "EmailOutbox_sentAtNs_canceledAtNs_nextAttemptAtNs_idx";
CREATE INDEX "EmailOutbox_sentAtNs_canceledAtNs_sendingAtNs_nextAttemptAtNs_idx"
ON "EmailOutbox"("sentAtNs", "canceledAtNs", "sendingAtNs", "nextAttemptAtNs");
