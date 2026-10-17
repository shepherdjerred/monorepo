-- AlterTable
ALTER TABLE "Torrent" ADD COLUMN     "qbittorrentId" TEXT;

-- AlterTable
ALTER TABLE "LibraryAsset" ADD COLUMN     "plexPublishedAt" TIMESTAMP(3),
ADD COLUMN     "rollbackExpiresAt" TIMESTAMP(3),
ADD COLUMN     "supersededByAssetId" TEXT;

-- CreateTable
CREATE TABLE "MigrationCapture" (
    "id" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "sourceInstanceId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "stable" BOOLEAN NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationRecord" (
    "captureId" TEXT NOT NULL,
    "provenanceKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "observationHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "MigrationRecord_pkey" PRIMARY KEY ("captureId","provenanceKey")
);

-- CreateTable
CREATE TABLE "AdoptionProposal" (
    "id" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "reportHash" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "actorId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdoptionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlexExclusionRun" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "runtimeVersion" INTEGER NOT NULL,
    "planDigest" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "journal" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlexExclusionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlexExclusionProof" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "serverMachineId" TEXT NOT NULL,
    "serverVersion" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "sectionUuid" TEXT NOT NULL,
    "libraryRoot" TEXT NOT NULL,
    "controlRoot" TEXT NOT NULL,
    "rootMarkerSha256" TEXT NOT NULL,
    "controlMarkerSha256" TEXT NOT NULL,
    "configurationDigest" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PlexExclusionProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpgradeCleanup" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "successorAssetId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "manifest" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpgradeCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MigrationCapture_manifestHash_key" ON "MigrationCapture"("manifestHash");

-- CreateIndex
CREATE INDEX "MigrationCapture_sourceInstanceId_completedAt_idx" ON "MigrationCapture"("sourceInstanceId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdoptionProposal_captureId_reportHash_recoveryEpoch_runtime_key" ON "AdoptionProposal"("captureId", "reportHash", "recoveryEpoch", "runtimeVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PlexExclusionProof_runId_key" ON "PlexExclusionProof"("runId");

-- CreateIndex
CREATE INDEX "PlexExclusionProof_serverMachineId_sectionId_libraryRoot_re_idx" ON "PlexExclusionProof"("serverMachineId", "sectionId", "libraryRoot", "recoveryEpoch");

-- CreateIndex
CREATE UNIQUE INDEX "UpgradeCleanup_assetId_successorAssetId_key" ON "UpgradeCleanup"("assetId", "successorAssetId");
CREATE INDEX "UpgradeCleanup_assetId_idx" ON "UpgradeCleanup"("assetId");

-- CreateIndex
CREATE INDEX "UpgradeCleanup_state_expiresAt_idx" ON "UpgradeCleanup"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "LibraryAsset_supersededByAssetId_idx" ON "LibraryAsset"("supersededByAssetId");

-- AddForeignKey
ALTER TABLE "MigrationRecord" ADD CONSTRAINT "MigrationRecord_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "MigrationCapture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdoptionProposal" ADD CONSTRAINT "AdoptionProposal_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "MigrationCapture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdoptionProposal" ADD CONSTRAINT "AdoptionProposal_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlexExclusionRun" ADD CONSTRAINT "PlexExclusionRun_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlexExclusionProof" ADD CONSTRAINT "PlexExclusionProof_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PlexExclusionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpgradeCleanup" ADD CONSTRAINT "UpgradeCleanup_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "LibraryAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Torrent" ADD CONSTRAINT "Torrent_qbittorrentId_check"
CHECK ("qbittorrentId" IS NULL OR "qbittorrentId" ~ '^[a-f0-9]{40}$');
ALTER TABLE "MigrationCapture" ADD CONSTRAINT "MigrationCapture_integrity_check"
CHECK ("schemaVersion" = 1 AND "completedAt" >= "startedAt"
 AND (NOT "stable" OR "complete") AND "manifestHash" ~ '^[a-f0-9]{64}$'
 AND "sourceInstanceId" ~ '^[a-f0-9]{64}$');
ALTER TABLE "AdoptionProposal" ADD CONSTRAINT "AdoptionProposal_state_check"
CHECK ("status" IN ('protected','awaiting_review','approved','revoked')
 AND "recoveryEpoch" >= 0 AND "runtimeVersion" >= 0 AND "version" >= 0
 AND ("status" <> 'approved' OR ("actorId" IS NOT NULL AND "approvedAt" IS NOT NULL)));

CREATE FUNCTION reject_migration_capture_mutation() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'Migration captures and records are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MigrationCapture_immutable" BEFORE UPDATE OR DELETE ON "MigrationCapture"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
CREATE TRIGGER "MigrationRecord_immutable" BEFORE UPDATE OR DELETE ON "MigrationRecord"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();

CREATE FUNCTION protect_adoption_report() RETURNS trigger AS $$
BEGIN
 IF (NEW."captureId", NEW."reportHash", NEW."report", NEW."recoveryEpoch", NEW."runtimeVersion")
 IS DISTINCT FROM (OLD."captureId", OLD."reportHash", OLD."report", OLD."recoveryEpoch", OLD."runtimeVersion") THEN
  RAISE EXCEPTION 'Adoption report evidence is immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AdoptionProposal_immutable_report" BEFORE UPDATE ON "AdoptionProposal"
FOR EACH ROW EXECUTE FUNCTION protect_adoption_report();
