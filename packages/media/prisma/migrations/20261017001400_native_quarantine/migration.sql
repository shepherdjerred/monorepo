CREATE TABLE "NativeQuarantineContinuation" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "groupHash" TEXT NOT NULL,
  "recoveryEpoch" INTEGER NOT NULL,
  "descriptor" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "version" INTEGER NOT NULL DEFAULT 0,
  "coordinatorOperationId" TEXT,
  "executionEvidence" JSONB,
  "restoration" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NativeQuarantineContinuation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NativeQuarantineContinuation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "NativeRecoveryReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NativeQuarantineContinuation_coordinatorOperationId_fkey" FOREIGN KEY ("coordinatorOperationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NativeQuarantineContinuation_valid" CHECK (
    "recoveryEpoch" >= 0 AND "groupHash" ~ '^[a-f0-9]{64}$'
    AND "state" IN ('pending','restoring','restored','protected')
  )
);
CREATE UNIQUE INDEX "NativeQuarantineContinuation_receiptId_groupHash_key" ON "NativeQuarantineContinuation"("receiptId", "groupHash");
CREATE INDEX "NativeQuarantineContinuation_state_recoveryEpoch_idx" ON "NativeQuarantineContinuation"("state", "recoveryEpoch");
CREATE FUNCTION protect_native_quarantine_continuation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Native quarantine continuation cannot be deleted'; END IF;
  IF ROW(NEW."receiptId",NEW."groupHash",NEW."recoveryEpoch",NEW."descriptor",NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."receiptId",OLD."groupHash",OLD."recoveryEpoch",OLD."descriptor",OLD."createdAt") OR
     (OLD."executionEvidence" IS NOT NULL AND NEW."executionEvidence" IS DISTINCT FROM OLD."executionEvidence") OR
     (OLD."restoration" IS NOT NULL AND NEW."restoration" IS DISTINCT FROM OLD."restoration") THEN
    RAISE EXCEPTION 'Native quarantine authority and completed evidence are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "NativeQuarantineContinuation_immutable" BEFORE UPDATE OR DELETE ON "NativeQuarantineContinuation"
FOR EACH ROW EXECUTE FUNCTION protect_native_quarantine_continuation();
