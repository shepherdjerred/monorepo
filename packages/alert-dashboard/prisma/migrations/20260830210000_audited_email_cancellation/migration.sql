-- AlterTable
ALTER TABLE "EmailOutbox" ADD COLUMN "canceledAtNs" BIGINT;
ALTER TABLE "EmailOutbox" ADD COLUMN "canceledBy" TEXT;
ALTER TABLE "EmailOutbox" ADD COLUMN "cancellationReason" TEXT;

-- ReplaceIndex
DROP INDEX "EmailOutbox_sentAtNs_nextAttemptAtNs_idx";
CREATE INDEX "EmailOutbox_sentAtNs_canceledAtNs_nextAttemptAtNs_idx"
ON "EmailOutbox"("sentAtNs", "canceledAtNs", "nextAttemptAtNs");
