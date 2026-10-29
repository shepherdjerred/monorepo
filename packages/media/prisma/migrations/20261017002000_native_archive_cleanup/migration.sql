CREATE TABLE "NativeArchiveCleanupContinuation" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "originalCleanupId" TEXT NOT NULL,
  "recoveryEpoch" INTEGER NOT NULL,
  "descriptor" JSONB NOT NULL,
  "descriptorHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "version" INTEGER NOT NULL DEFAULT 0,
  "coordinatorOperationId" TEXT,
  "executionEvidence" JSONB,
  "completion" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NativeArchiveCleanupContinuation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NativeArchiveCleanupContinuation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "NativeRecoveryReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NativeArchiveCleanupContinuation_originalCleanupId_fkey" FOREIGN KEY ("originalCleanupId") REFERENCES "UpgradeCleanup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NativeArchiveCleanupContinuation_coordinatorOperationId_fkey" FOREIGN KEY ("coordinatorOperationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NativeArchiveCleanupContinuation_valid" CHECK (
    "recoveryEpoch" >= 0 AND "version" >= 0 AND "descriptorHash" ~ '^[a-f0-9]{64}$'
    AND "state" IN ('pending','cleaning','protected','cleaned')
  )
);
CREATE UNIQUE INDEX "native_archive_receipt_cleanup_key" ON "NativeArchiveCleanupContinuation"("receiptId", "originalCleanupId");
CREATE INDEX "NativeArchiveCleanupContinuation_state_recoveryEpoch_idx" ON "NativeArchiveCleanupContinuation"("state", "recoveryEpoch");
CREATE FUNCTION protect_native_archive_continuation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Native archive continuation cannot be deleted'; END IF;
  IF ROW(NEW."id",NEW."receiptId",NEW."originalCleanupId",NEW."recoveryEpoch",NEW."descriptor",NEW."descriptorHash",NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."id",OLD."receiptId",OLD."originalCleanupId",OLD."recoveryEpoch",OLD."descriptor",OLD."descriptorHash",OLD."createdAt") OR
     (OLD."executionEvidence" IS NOT NULL AND NEW."executionEvidence" IS DISTINCT FROM OLD."executionEvidence") OR
     (OLD."completion" IS NOT NULL AND NEW."completion" IS DISTINCT FROM OLD."completion") THEN
    RAISE EXCEPTION 'Native archive authority and completed evidence are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "NativeArchiveCleanupContinuation_immutable" BEFORE UPDATE OR DELETE ON "NativeArchiveCleanupContinuation"
FOR EACH ROW EXECUTE FUNCTION protect_native_archive_continuation();

ALTER TABLE "NativeRecoveryObservation" DROP CONSTRAINT "NativeRecoveryObservation_evidence_check";
ALTER TABLE "NativeRecoveryObservation" ADD CONSTRAINT "NativeRecoveryObservation_evidence_check"
CHECK ("kind" IN ('network', 'files', 'archive_cleanup_network') AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "observedAt");

ALTER TABLE "NativeRecoveryReceipt" DROP CONSTRAINT "NativeRecoveryReceipt_authority_check";
ALTER TABLE "NativeRecoveryReceipt" ADD CONSTRAINT "NativeRecoveryReceipt_authority_check"
CHECK (
  "recoveryEpoch" >= 0 AND "planHash" ~ '^[a-f0-9]{64}$' AND (
    "runtimeVersion" > "previousRuntimeVersion" OR COALESCE((
      "runtimeVersion" = "previousRuntimeVersion" AND
      "selection" #> '{scope,schemaVersion}' = '2'::jsonb AND
      "selection" #>> '{scope,lifecycleKind}' = 'superseded_archive' AND
      "selection" #>> '{scope,request,activation}' = 'extend' AND
      "selection" -> 'bindings' = '[]'::jsonb AND
      CASE WHEN jsonb_typeof("selection" -> 'reusedBindings') = 'array'
        THEN jsonb_array_length("selection" -> 'reusedBindings') BETWEEN 1 AND 25
        ELSE FALSE END
    ), FALSE)
  )
);
