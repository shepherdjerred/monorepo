-- AlterTable
ALTER TABLE "ApplicationEvent" ADD COLUMN     "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "NotificationDelivery" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "recipientFingerprint" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "NotificationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "providerReceipt" TEXT,
    "recipientFingerprint" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDeliveryAttempt_deliveryId_attemptNumber_key" ON "NotificationDeliveryAttempt"("deliveryId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationEvent_dedupeKey_key" ON "ApplicationEvent"("dedupeKey");

-- AddForeignKey
ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_sequence_check"
CHECK ("attemptNumber" > 0 AND "recoveryEpoch" >= 0 AND ("finishedAt" IS NULL OR "finishedAt" >= "startedAt"));
CREATE FUNCTION protect_notification_attempt_identity() RETURNS trigger AS $$
BEGIN
 IF (NEW."deliveryId", NEW."attemptNumber", NEW."recoveryEpoch", NEW."recipientFingerprint", NEW."startedAt")
 IS DISTINCT FROM (OLD."deliveryId", OLD."attemptNumber", OLD."recoveryEpoch", OLD."recipientFingerprint", OLD."startedAt") THEN
  RAISE EXCEPTION 'Notification attempt identity is immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "NotificationDeliveryAttempt_immutable_identity" BEFORE UPDATE ON "NotificationDeliveryAttempt"
FOR EACH ROW EXECUTE FUNCTION protect_notification_attempt_identity();
CREATE TRIGGER "NotificationDeliveryAttempt_no_delete" BEFORE DELETE ON "NotificationDeliveryAttempt"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
