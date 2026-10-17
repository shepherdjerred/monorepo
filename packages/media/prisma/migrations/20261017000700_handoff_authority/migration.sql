-- AlterTable
ALTER TABLE "MediaIntent" ADD COLUMN     "automationEpoch" INTEGER NOT NULL DEFAULT -1;

-- AlterTable
ALTER TABLE "Torrent" ADD COLUMN     "ownershipEpoch" INTEGER NOT NULL DEFAULT -1;

-- AlterTable
ALTER TABLE "LibraryAsset" ADD COLUMN     "ownershipEpoch" INTEGER NOT NULL DEFAULT -1;

-- CreateTable
CREATE TABLE "MediaHandoffPlan" (
    "id" TEXT NOT NULL,
    "bundleReviewId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "bundleReviewVersion" INTEGER NOT NULL,
    "requestHash" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "plan" JSONB,
    "planHash" TEXT,
    "state" TEXT NOT NULL DEFAULT 'preparing',
    "version" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaHandoffPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaHandoffObservation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaHandoffObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaHandoffReceipt" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "previousRuntimeVersion" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "selection" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaHandoffReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyWriterLease" (
    "id" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "targetsDigest" TEXT NOT NULL,
    "configurationDigest" TEXT NOT NULL,
    "observation" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LegacyWriterLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaHandoffObservation_planId_kind_createdAt_idx" ON "MediaHandoffObservation"("planId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaHandoffReceipt_planId_key" ON "MediaHandoffReceipt"("planId");

-- AddForeignKey
ALTER TABLE "MediaHandoffPlan" ADD CONSTRAINT "MediaHandoffPlan_bundleReviewId_fkey" FOREIGN KEY ("bundleReviewId") REFERENCES "MigrationBundleReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaHandoffPlan" ADD CONSTRAINT "MediaHandoffPlan_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaHandoffObservation" ADD CONSTRAINT "MediaHandoffObservation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MediaHandoffPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaHandoffReceipt" ADD CONSTRAINT "MediaHandoffReceipt_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MediaHandoffPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaHandoffReceipt" ADD CONSTRAINT "MediaHandoffReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaIntent" ADD CONSTRAINT "MediaIntent_epoch_check" CHECK ("automationEpoch" >= -1);
ALTER TABLE "LibraryAsset" ADD CONSTRAINT "LibraryAsset_epoch_check" CHECK ("ownershipEpoch" >= -1);
ALTER TABLE "Torrent" ADD CONSTRAINT "Torrent_epoch_check" CHECK ("ownershipEpoch" >= -1);
ALTER TABLE "MediaHandoffObservation" ADD CONSTRAINT "MediaHandoffObservation_evidence_check"
CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "observedAt");
ALTER TABLE "LegacyWriterLease" ADD CONSTRAINT "LegacyWriterLease_evidence_check"
CHECK ("recoveryEpoch" >= 0 AND "version" >= 0 AND "targetsDigest" ~ '^[a-f0-9]{64}$'
AND "configurationDigest" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "observedAt");
CREATE TRIGGER "MediaHandoffObservation_immutable" BEFORE UPDATE OR DELETE ON "MediaHandoffObservation"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE TRIGGER "MediaHandoffReceipt_immutable" BEFORE UPDATE OR DELETE ON "MediaHandoffReceipt"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE FUNCTION protect_media_handoff_plan() RETURNS trigger AS $$
BEGIN
 IF (NEW."bundleReviewId", NEW."actorId", NEW."recoveryEpoch", NEW."runtimeVersion", NEW."bundleReviewVersion", NEW."requestHash", NEW."scope")
 IS DISTINCT FROM (OLD."bundleReviewId", OLD."actorId", OLD."recoveryEpoch", OLD."runtimeVersion", OLD."bundleReviewVersion", OLD."requestHash", OLD."scope") THEN
  RAISE EXCEPTION 'Handoff plan scope and authority binding are immutable';
 END IF;
 IF OLD."planHash" IS NOT NULL AND (NEW."plan", NEW."planHash", NEW."expiresAt") IS DISTINCT FROM (OLD."plan", OLD."planHash", OLD."expiresAt") THEN
  RAISE EXCEPTION 'Published handoff plan evidence is immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MediaHandoffPlan_immutable_scope" BEFORE UPDATE ON "MediaHandoffPlan"
FOR EACH ROW EXECUTE FUNCTION protect_media_handoff_plan();

-- CreateTable
CREATE TABLE "RecoveryHold" (
    "mediaId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseEvidence" JSONB,

    CONSTRAINT "RecoveryHold_pkey" PRIMARY KEY ("mediaId")
);

-- AddForeignKey
ALTER TABLE "RecoveryHold" ADD CONSTRAINT "RecoveryHold_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryHold" ADD CONSTRAINT "RecoveryHold_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MediaStorageAuthority" (
    "rootPath" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "pvcUid" TEXT NOT NULL,
    "volumeName" TEXT NOT NULL,
    "volumePath" TEXT NOT NULL,
    "workerPodUid" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MediaStorageAuthority_pkey" PRIMARY KEY ("rootPath")
);
