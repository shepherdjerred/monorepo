-- CreateTable
CREATE TABLE "SubtitleReplacement" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "oldSubtitleId" TEXT NOT NULL,
    "candidateSubtitleId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "importOperationId" TEXT NOT NULL,
    "rollbackOperationId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'preparing',
    "version" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "reservationActive" BOOLEAN NOT NULL DEFAULT true,
    "appliedAt" TIMESTAMP(3),
    "archiveExpiresAt" TIMESTAMP(3),
    "cleanupState" TEXT NOT NULL DEFAULT 'pending',
    "cleanupReason" TEXT,
    "cleanupManifest" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubtitleReplacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtitleReplacementReview" (
    "id" TEXT NOT NULL,
    "replacementId" TEXT NOT NULL,
    "observation" JSONB NOT NULL,
    "observationHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtitleReplacementReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtitleReplacementReceipt" (
    "id" TEXT NOT NULL,
    "replacementId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtitleReplacementReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleReplacement_importOperationId_key" ON "SubtitleReplacement"("importOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleReplacement_rollbackOperationId_key" ON "SubtitleReplacement"("rollbackOperationId");

-- CreateIndex
CREATE INDEX "SubtitleReplacement_state_updatedAt_idx" ON "SubtitleReplacement"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "SubtitleReplacement_cleanupState_archiveExpiresAt_idx" ON "SubtitleReplacement"("cleanupState", "archiveExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleReplacementReview_replacementId_key" ON "SubtitleReplacementReview"("replacementId");

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleReplacementReceipt_replacementId_key" ON "SubtitleReplacementReceipt"("replacementId");

-- AddForeignKey
ALTER TABLE "SubtitleReplacement" ADD CONSTRAINT "SubtitleReplacement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleReplacement" ADD CONSTRAINT "SubtitleReplacement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "LibraryAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleReplacement" ADD CONSTRAINT "SubtitleReplacement_oldSubtitleId_fkey" FOREIGN KEY ("oldSubtitleId") REFERENCES "SubtitleAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleReplacement" ADD CONSTRAINT "SubtitleReplacement_candidateSubtitleId_fkey" FOREIGN KEY ("candidateSubtitleId") REFERENCES "SubtitleAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleReplacementReview" ADD CONSTRAINT "SubtitleReplacementReview_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "SubtitleReplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleReplacementReview" ADD CONSTRAINT "SubtitleReplacementReview_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleReplacementReceipt" ADD CONSTRAINT "SubtitleReplacementReceipt_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "SubtitleReplacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubtitleReplacement" ADD COLUMN "executionEvidence" JSONB;
ALTER TABLE "SubtitleReplacement" ADD COLUMN "coordinatorOperationId" TEXT;
ALTER TABLE "SubtitleReplacement" ADD CONSTRAINT "SubtitleReplacement_coordinatorOperationId_fkey" FOREIGN KEY ("coordinatorOperationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "SubtitleReplacement_active_asset_key" ON "SubtitleReplacement" ("assetId") WHERE "reservationActive" = true;
ALTER TABLE "SubtitleReplacement" ADD CONSTRAINT "SubtitleReplacement_authority_check" CHECK (
 "oldSubtitleId" <> "candidateSubtitleId" AND "recoveryEpoch" >= 0 AND "runtimeVersion" >= 0 AND "version" >= 0
 AND "snapshotHash" ~ '^[a-f0-9]{64}$'
 AND "state" IN ('preparing','awaiting_review','applying','reconciling','applied','rolled_back','protected','abandoned')
);
ALTER TABLE "SubtitleReplacementReview" ADD CONSTRAINT "SubtitleReplacementReview_check" CHECK (
 "observationHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "createdAt"
 AND (("approvedById" IS NULL AND "approvedAt" IS NULL) OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL))
);
ALTER TABLE "SubtitleReplacementReceipt" ADD CONSTRAINT "SubtitleReplacementReceipt_check" CHECK ("outcome" IN ('installed','compensated','abandoned'));
CREATE TRIGGER "SubtitleReplacementReceipt_immutable" BEFORE UPDATE OR DELETE ON "SubtitleReplacementReceipt"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE FUNCTION protect_subtitle_replacement() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Subtitle replacement records are durable'; END IF;
 IF (NEW."ownerId",NEW."assetId",NEW."oldSubtitleId",NEW."candidateSubtitleId",NEW."recoveryEpoch",NEW."runtimeVersion",NEW."snapshot",NEW."snapshotHash",NEW."importOperationId",NEW."rollbackOperationId",NEW."createdAt")
 IS DISTINCT FROM (OLD."ownerId",OLD."assetId",OLD."oldSubtitleId",OLD."candidateSubtitleId",OLD."recoveryEpoch",OLD."runtimeVersion",OLD."snapshot",OLD."snapshotHash",OLD."importOperationId",OLD."rollbackOperationId",OLD."createdAt") THEN
  RAISE EXCEPTION 'Subtitle replacement scope is immutable';
 END IF;
 IF OLD."executionEvidence" IS NOT NULL AND NEW."executionEvidence" IS DISTINCT FROM OLD."executionEvidence" THEN
  RAISE EXCEPTION 'Subtitle replacement execution identity is immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SubtitleReplacement_scope_immutable" BEFORE UPDATE OR DELETE ON "SubtitleReplacement"
FOR EACH ROW EXECUTE FUNCTION protect_subtitle_replacement();
CREATE FUNCTION protect_subtitle_replacement_review() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Subtitle replacement review is immutable'; END IF;
 IF (NEW."replacementId",NEW."observation",NEW."observationHash",NEW."expiresAt",NEW."createdAt")
 IS DISTINCT FROM (OLD."replacementId",OLD."observation",OLD."observationHash",OLD."expiresAt",OLD."createdAt")
 OR (OLD."approvedAt" IS NOT NULL AND (NEW."approvedAt",NEW."approvedById") IS DISTINCT FROM (OLD."approvedAt",OLD."approvedById")) THEN
  RAISE EXCEPTION 'Subtitle replacement review is immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SubtitleReplacementReview_immutable" BEFORE UPDATE OR DELETE ON "SubtitleReplacementReview"
FOR EACH ROW EXECUTE FUNCTION protect_subtitle_replacement_review();
