-- AlterTable
ALTER TABLE "RecoveryHold" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;


-- CreateTable
CREATE TABLE "RecoveryReview" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "scope" JSONB NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'awaiting_responses',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryResponse" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryReleaseReceipt" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "responseHash" TEXT NOT NULL,
    "releasedHoldIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryReleaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryResponse_reviewId_userId_key" ON "RecoveryResponse"("reviewId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryReleaseReceipt_reviewId_key" ON "RecoveryReleaseReceipt"("reviewId");

-- AddForeignKey
ALTER TABLE "RecoveryReview" ADD CONSTRAINT "RecoveryReview_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryResponse" ADD CONSTRAINT "RecoveryResponse_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "RecoveryReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryResponse" ADD CONSTRAINT "RecoveryResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryResponse" ADD CONSTRAINT "RecoveryResponse_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryReleaseReceipt" ADD CONSTRAINT "RecoveryReleaseReceipt_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "RecoveryReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryReleaseReceipt" ADD CONSTRAINT "RecoveryReleaseReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "RecoveryResponse_immutable" BEFORE UPDATE OR DELETE ON "RecoveryResponse"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE TRIGGER "RecoveryReleaseReceipt_immutable" BEFORE UPDATE OR DELETE ON "RecoveryReleaseReceipt"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE FUNCTION protect_recovery_review() RETURNS trigger AS $$
BEGIN
 IF (NEW."actorId", NEW."recoveryEpoch", NEW."runtimeVersion", NEW."scope", NEW."scopeHash", NEW."createdAt", NEW."expiresAt")
 IS DISTINCT FROM (OLD."actorId", OLD."recoveryEpoch", OLD."runtimeVersion", OLD."scope", OLD."scopeHash", OLD."createdAt", OLD."expiresAt") THEN
  RAISE EXCEPTION 'Recovery review authority and scope are immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "RecoveryReview_immutable_scope" BEFORE UPDATE ON "RecoveryReview"
FOR EACH ROW EXECUTE FUNCTION protect_recovery_review();
