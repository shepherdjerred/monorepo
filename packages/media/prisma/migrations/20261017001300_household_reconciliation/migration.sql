-- AlterTable
CREATE TABLE "LegacyClaimKnowledge" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LegacyClaimKnowledge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LegacyClaimKnowledge_singleton" CHECK ("id" = 'singleton' AND "version" >= 0)
);
INSERT INTO "LegacyClaimKnowledge" ("id") VALUES ('singleton');

ALTER TABLE "RecoveryReleaseReceipt" ADD COLUMN     "claimAccounting" JSONB;

-- CreateTable
CREATE TABLE "LegacyRequesterBinding" (
    "id" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceInstanceId" TEXT NOT NULL,
    "requesterSourceId" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "captureHash" TEXT NOT NULL,
    "requesterEvidenceHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identitySnapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "previousId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyRequesterBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegacyRequesterBinding_previousId_key" ON "LegacyRequesterBinding"("previousId");

-- CreateIndex
CREATE INDEX "LegacyRequesterBinding_captureId_idx" ON "LegacyRequesterBinding"("captureId");

-- CreateIndex
CREATE INDEX "LegacyRequesterBinding_userId_idx" ON "LegacyRequesterBinding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyRequesterBinding_sourceKind_sourceInstanceId_requeste_key" ON "LegacyRequesterBinding"("sourceKind", "sourceInstanceId", "requesterSourceId", "revision");

-- AddForeignKey
ALTER TABLE "LegacyRequesterBinding" ADD CONSTRAINT "LegacyRequesterBinding_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "MigrationCapture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyRequesterBinding" ADD CONSTRAINT "LegacyRequesterBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyRequesterBinding" ADD CONSTRAINT "LegacyRequesterBinding_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyRequesterBinding" ADD CONSTRAINT "LegacyRequesterBinding_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "LegacyRequesterBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegacyRequesterBinding" ADD CONSTRAINT "LegacyRequesterBinding_evidence_check"
CHECK ("revision" > 0 AND "captureHash" ~ '^[a-f0-9]{64}$' AND "requesterEvidenceHash" ~ '^[a-f0-9]{64}$'
  AND (("revision" = 1 AND "previousId" IS NULL) OR ("revision" > 1 AND "previousId" IS NOT NULL)));
CREATE TRIGGER "LegacyRequesterBinding_immutable" BEFORE UPDATE OR DELETE ON "LegacyRequesterBinding"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
