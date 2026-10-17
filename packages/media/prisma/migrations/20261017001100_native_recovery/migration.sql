-- CreateTable
CREATE TABLE "NativeRecoveryPlan" (
    "id" TEXT NOT NULL,
    "restoreOperationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "requestHash" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "plan" JSONB,
    "planHash" TEXT,
    "state" TEXT NOT NULL DEFAULT 'preparing',
    "version" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NativeRecoveryPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeRecoveryObservation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeRecoveryObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeRecoveryReceipt" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "previousRuntimeVersion" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "selection" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeRecoveryReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NativeRecoveryObservation_planId_kind_createdAt_idx" ON "NativeRecoveryObservation"("planId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NativeRecoveryReceipt_planId_key" ON "NativeRecoveryReceipt"("planId");

-- AddForeignKey
ALTER TABLE "NativeRecoveryPlan" ADD CONSTRAINT "NativeRecoveryPlan_restoreOperationId_fkey" FOREIGN KEY ("restoreOperationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeRecoveryPlan" ADD CONSTRAINT "NativeRecoveryPlan_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeRecoveryObservation" ADD CONSTRAINT "NativeRecoveryObservation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "NativeRecoveryPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeRecoveryReceipt" ADD CONSTRAINT "NativeRecoveryReceipt_planId_fkey" FOREIGN KEY ("planId") REFERENCES "NativeRecoveryPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeRecoveryReceipt" ADD CONSTRAINT "NativeRecoveryReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NativeRecoveryPlan" ADD CONSTRAINT "NativeRecoveryPlan_authority_check"
CHECK ("recoveryEpoch" >= 0 AND "runtimeVersion" >= 0 AND "version" >= 0 AND "requestHash" ~ '^[a-f0-9]{64}$' AND ("planHash" IS NULL OR "planHash" ~ '^[a-f0-9]{64}$'));
ALTER TABLE "NativeRecoveryObservation" ADD CONSTRAINT "NativeRecoveryObservation_evidence_check"
CHECK ("kind" IN ('network', 'files') AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "observedAt");
ALTER TABLE "NativeRecoveryReceipt" ADD CONSTRAINT "NativeRecoveryReceipt_authority_check"
CHECK ("recoveryEpoch" >= 0 AND "runtimeVersion" > "previousRuntimeVersion" AND "planHash" ~ '^[a-f0-9]{64}$');
CREATE TRIGGER "NativeRecoveryObservation_immutable" BEFORE UPDATE OR DELETE ON "NativeRecoveryObservation"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE TRIGGER "NativeRecoveryReceipt_immutable" BEFORE UPDATE OR DELETE ON "NativeRecoveryReceipt"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE FUNCTION protect_native_recovery_plan() RETURNS trigger AS $$
BEGIN
 IF (NEW."restoreOperationId", NEW."actorId", NEW."recoveryEpoch", NEW."runtimeVersion", NEW."requestHash", NEW."scope")
 IS DISTINCT FROM (OLD."restoreOperationId", OLD."actorId", OLD."recoveryEpoch", OLD."runtimeVersion", OLD."requestHash", OLD."scope") THEN
  RAISE EXCEPTION 'Native recovery scope and authority are immutable';
 END IF;
 IF OLD."planHash" IS NOT NULL AND (NEW."plan", NEW."planHash", NEW."expiresAt") IS DISTINCT FROM (OLD."plan", OLD."planHash", OLD."expiresAt") THEN
  RAISE EXCEPTION 'Reviewed native recovery proof is immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "NativeRecoveryPlan_immutable_scope" BEFORE UPDATE ON "NativeRecoveryPlan"
FOR EACH ROW EXECUTE FUNCTION protect_native_recovery_plan();
