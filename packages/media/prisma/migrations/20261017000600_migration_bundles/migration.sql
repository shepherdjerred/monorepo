-- CreateTable
CREATE TABLE "MigrationBundle" (
    "id" TEXT NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationBundleCapture" (
    "bundleId" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,

    CONSTRAINT "MigrationBundleCapture_pkey" PRIMARY KEY ("bundleId","captureId")
);

-- CreateTable
CREATE TABLE "MigrationBundleReview" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "reportHash" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "selection" JSONB NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "actorId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationBundleReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MigrationBundle_bundleHash_key" ON "MigrationBundle"("bundleHash");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationBundleReview_bundleId_reportHash_recoveryEpoch_run_key" ON "MigrationBundleReview"("bundleId", "reportHash", "recoveryEpoch", "runtimeVersion");

-- AddForeignKey
ALTER TABLE "MigrationBundleCapture" ADD CONSTRAINT "MigrationBundleCapture_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "MigrationBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationBundleCapture" ADD CONSTRAINT "MigrationBundleCapture_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "MigrationCapture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationBundleReview" ADD CONSTRAINT "MigrationBundleReview_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "MigrationBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationBundleReview" ADD CONSTRAINT "MigrationBundleReview_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MigrationBundle" ADD CONSTRAINT "MigrationBundle_hash_check"
CHECK ("bundleHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "MigrationBundleReview" ADD CONSTRAINT "MigrationBundleReview_state_check"
CHECK ("status" IN ('protected','awaiting_review','approved','revoked')
 AND "reportHash" ~ '^[a-f0-9]{64}$' AND "recoveryEpoch" >= 0 AND "runtimeVersion" >= 0 AND "version" >= 0
 AND ("status" <> 'approved' OR ("actorId" IS NOT NULL AND "approvedAt" IS NOT NULL)));
CREATE TRIGGER "MigrationBundle_immutable" BEFORE UPDATE OR DELETE ON "MigrationBundle"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE TRIGGER "MigrationBundleCapture_immutable" BEFORE UPDATE OR DELETE ON "MigrationBundleCapture"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE FUNCTION protect_migration_bundle_report() RETURNS trigger AS $$
BEGIN
 IF (NEW."bundleId", NEW."reportHash", NEW."report", NEW."recoveryEpoch", NEW."runtimeVersion")
 IS DISTINCT FROM (OLD."bundleId", OLD."reportHash", OLD."report", OLD."recoveryEpoch", OLD."runtimeVersion") THEN
  RAISE EXCEPTION 'Migration bundle report evidence is immutable';
 END IF;
 IF OLD."status" = 'approved' AND NEW."status" = 'approved' AND NEW."selection" IS DISTINCT FROM OLD."selection" THEN
  RAISE EXCEPTION 'Approved migration selection is immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MigrationBundleReview_immutable_report" BEFORE UPDATE ON "MigrationBundleReview"
FOR EACH ROW EXECUTE FUNCTION protect_migration_bundle_report();
