-- AlterTable
ALTER TABLE "SubtitleAsset" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "codec" TEXT,
ADD COLUMN     "forced" BOOLEAN,
ADD COLUMN     "hearingImpaired" BOOLEAN,
ADD COLUMN     "ownershipEpoch" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "qualityStatus" TEXT NOT NULL DEFAULT 'unverified',
ADD COLUMN     "storageKind" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "streamIndex" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "videoChecksum" TEXT,
ADD COLUMN     "videoVersion" INTEGER;

-- CreateTable
CREATE TABLE "MediaSubtitlePolicyVersion" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "recoveryEpoch" INTEGER NOT NULL,
    "source" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaSubtitlePolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaSubtitlePolicyVersion_mediaId_version_key" ON "MediaSubtitlePolicyVersion"("mediaId", "version");

-- CreateIndex
CREATE INDEX "SubtitleAsset_assetId_ownershipEpoch_state_idx" ON "SubtitleAsset"("assetId", "ownershipEpoch", "state");

-- AddForeignKey
ALTER TABLE "MediaSubtitlePolicyVersion" ADD CONSTRAINT "MediaSubtitlePolicyVersion_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSubtitlePolicyVersion" ADD CONSTRAINT "MediaSubtitlePolicyVersion_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubtitleAsset" ADD CONSTRAINT "SubtitleAsset_quality_contract" CHECK (
 "qualityStatus" IN ('unverified', 'accepted', 'rejected') AND
 "storageKind" IN ('unknown', 'sidecar', 'embedded') AND "ownershipEpoch" >= -1 AND
 ("qualityStatus" <> 'accepted' OR
  ("ownershipEpoch" >= 0 AND "videoChecksum" IS NOT NULL AND "videoChecksum" ~ '^[a-f0-9]{64}$' AND "videoVersion" IS NOT NULL AND "videoVersion" >= 0 AND
   (("storageKind" = 'sidecar' AND "checksum" IS NOT NULL AND "checksum" ~ '^[a-f0-9]{64}$') OR
    ("storageKind" = 'embedded' AND "streamIndex" IS NOT NULL AND "streamIndex" >= 0 AND "codec" IS NOT NULL))))
);
CREATE TRIGGER "MediaSubtitlePolicyVersion_immutable" BEFORE UPDATE OR DELETE ON "MediaSubtitlePolicyVersion"
FOR EACH ROW EXECUTE FUNCTION reject_migration_capture_mutation();
