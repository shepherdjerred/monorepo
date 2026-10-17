BEGIN;

-- This checkpoint has no named producer. Never coerce unsupported historical coverage.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM "AssetCoverage" WHERE edition <> 'default') THEN
  RAISE EXCEPTION 'Edition migration requires explicit reconciliation of non-default or mixed historical coverage';
 END IF;
END;
$$;

-- DropForeignKey
ALTER TABLE "RequestCoverage" DROP CONSTRAINT "RequestCoverage_rootRequestId_fkey";

-- DropForeignKey
ALTER TABLE "RequestCoverage" DROP CONSTRAINT "RequestCoverage_requestId_fkey";

-- DropForeignKey
ALTER TABLE "AcquisitionReservation" DROP CONSTRAINT "AcquisitionReservation_attemptId_fkey";

-- DropForeignKey
ALTER TABLE "AssetCoverage" DROP CONSTRAINT "AssetCoverage_assetId_fkey";

-- DropIndex
DROP INDEX "MediaRequest_userId_mediaId_key";

-- DropIndex
DROP INDEX "MediaSubtitlePolicyVersion_mediaId_version_key";

-- DropIndex
DROP INDEX "RetentionHold_userId_mediaId_key";

-- DropIndex
DROP INDEX "RetentionDecision_mediaId_state_idx";

-- AlterTable
ALTER TABLE "MediaRequest" ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "RequestCoverage" ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "MediaIntent" DROP CONSTRAINT "MediaIntent_pkey",
ADD COLUMN     "availability" "Availability" NOT NULL DEFAULT 'wanted',
ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "editionRootId" TEXT,
ADD CONSTRAINT "MediaIntent_pkey" PRIMARY KEY ("mediaId", "edition");

-- AlterTable
ALTER TABLE "AcquisitionAttempt" ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "AcquisitionReservation" DROP CONSTRAINT "AcquisitionReservation_pkey",
ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default',
ADD CONSTRAINT "AcquisitionReservation_pkey" PRIMARY KEY ("mediaId", "edition");

-- AlterTable
ALTER TABLE "LibraryAsset" ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "editionRootId" TEXT;

-- AlterTable
ALTER TABLE "MediaSubtitlePolicyVersion" ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "WatchState" DROP CONSTRAINT "WatchState_pkey",
ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default',
ADD CONSTRAINT "WatchState_pkey" PRIMARY KEY ("userId", "mediaId", "edition");

-- AlterTable
ALTER TABLE "RetentionHold" ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "RetentionDecision" ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "RecoveryHold" DROP CONSTRAINT "RecoveryHold_pkey",
ADD COLUMN     "edition" TEXT NOT NULL DEFAULT 'default',
ADD CONSTRAINT "RecoveryHold_pkey" PRIMARY KEY ("mediaId", "edition");

-- CreateTable
CREATE TABLE "MediaEditionDefinition" (
    "rootMediaId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "pathLabel" TEXT NOT NULL,
    "plexLabel" TEXT NOT NULL,
    "definitionVersion" INTEGER NOT NULL DEFAULT 0,
    "displayLabel" TEXT NOT NULL,
    "displayVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MediaEditionDefinition_pkey" PRIMARY KEY ("rootMediaId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaRequest_userId_mediaId_edition_key" ON "MediaRequest"("userId", "mediaId", "edition");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRequest_id_edition_key" ON "MediaRequest"("id", "edition");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRequest_id_mediaId_edition_key" ON "MediaRequest"("id", "mediaId", "edition");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionAttempt_id_edition_key" ON "AcquisitionAttempt"("id", "edition");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryAsset_id_edition_key" ON "LibraryAsset"("id", "edition");

-- CreateIndex
CREATE UNIQUE INDEX "MediaSubtitlePolicyVersion_mediaId_edition_version_key" ON "MediaSubtitlePolicyVersion"("mediaId", "edition", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionHold_userId_mediaId_edition_key" ON "RetentionHold"("userId", "mediaId", "edition");

-- CreateIndex
CREATE INDEX "RetentionDecision_mediaId_edition_state_idx" ON "RetentionDecision"("mediaId", "edition", "state");


-- Only actual preexisting canonical ancestry establishes a root.
CREATE TEMP TABLE edition_roots ON COMMIT DROP AS
SELECT item.id,
 CASE WHEN item.kind IN ('movie', 'series') THEN item.id
      WHEN item.kind = 'season' AND parent.kind = 'series' THEN parent.id
      WHEN item.kind = 'episode' AND parent.kind = 'series' THEN parent.id
      WHEN item.kind = 'episode' AND parent.kind = 'season' AND grandparent.kind = 'series' THEN grandparent.id
      ELSE NULL END AS root_id
FROM "MediaItem" item
LEFT JOIN "MediaItem" parent ON parent.id = item."parentId"
LEFT JOIN "MediaItem" grandparent ON grandparent.id = parent."parentId";

INSERT INTO "MediaEditionDefinition" ("rootMediaId", key, policy, "pathLabel", "plexLabel", "displayLabel")
SELECT id, 'default', 'standard_unmarked', '', '', 'No specific edition'
FROM "MediaItem" WHERE kind IN ('movie', 'series');

-- Referenced metadata may legitimately have no prior acquisition intent.
INSERT INTO "MediaIntent" ("mediaId", edition, "editionRootId", availability,
 "automationEpoch", generation, "desiredPresence", monitoring, version, "updatedAt")
SELECT item.id, 'default', roots.root_id, item.availability, -1, 0, false, false, 0, CURRENT_TIMESTAMP
FROM "MediaItem" item JOIN edition_roots roots ON roots.id = item.id
WHERE item.id IN (
 SELECT "mediaId" FROM "MediaRequest" UNION SELECT "mediaId" FROM "RequestCoverage"
 UNION SELECT "mediaId" FROM "AcquisitionReservation" UNION SELECT "mediaId" FROM "AssetCoverage"
 UNION SELECT "mediaId" FROM "WatchState" UNION SELECT "mediaId" FROM "RetentionHold"
 UNION SELECT "mediaId" FROM "RecoveryHold" UNION SELECT "mediaId" FROM "RetentionDecision"
 UNION SELECT "mediaId" FROM "MediaSubtitlePolicyVersion"
)
ON CONFLICT ("mediaId", edition) DO NOTHING;

-- SQL backfill preserves existing version/generation/epoch and updatedAt.
UPDATE "MediaIntent" target SET "editionRootId" = roots.root_id, availability = item.availability
FROM edition_roots roots JOIN "MediaItem" item ON item.id = roots.id
WHERE target."mediaId" = roots.id;

UPDATE "LibraryAsset" asset SET "editionRootId" = grouped.root_id
FROM (
 SELECT coverage."assetId", CASE WHEN COUNT(roots.root_id) = COUNT(*) AND COUNT(DISTINCT roots.root_id) = 1
   THEN MIN(roots.root_id) ELSE NULL END AS root_id
 FROM "AssetCoverage" coverage JOIN edition_roots roots ON roots.id = coverage."mediaId"
 GROUP BY coverage."assetId"
) grouped WHERE asset.id = grouped."assetId";

-- AddForeignKey
ALTER TABLE "MediaRequest" ADD CONSTRAINT "MediaRequest_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition") REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCoverage" ADD CONSTRAINT "RequestCoverage_rootRequestId_edition_fkey" FOREIGN KEY ("rootRequestId", "edition") REFERENCES "MediaRequest"("id", "edition") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCoverage" ADD CONSTRAINT "RequestCoverage_requestId_mediaId_edition_fkey" FOREIGN KEY ("requestId", "mediaId", "edition") REFERENCES "MediaRequest"("id", "mediaId", "edition") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaEditionDefinition" ADD CONSTRAINT "MediaEditionDefinition_rootMediaId_fkey" FOREIGN KEY ("rootMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaIntent" ADD CONSTRAINT "MediaIntent_editionRootId_edition_fkey" FOREIGN KEY ("editionRootId", "edition") REFERENCES "MediaEditionDefinition"("rootMediaId", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionReservation" ADD CONSTRAINT "AcquisitionReservation_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition") REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionReservation" ADD CONSTRAINT "AcquisitionReservation_attemptId_edition_fkey" FOREIGN KEY ("attemptId", "edition") REFERENCES "AcquisitionAttempt"("id", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryAsset" ADD CONSTRAINT "LibraryAsset_editionRootId_edition_fkey" FOREIGN KEY ("editionRootId", "edition") REFERENCES "MediaEditionDefinition"("rootMediaId", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCoverage" ADD CONSTRAINT "AssetCoverage_assetId_edition_fkey" FOREIGN KEY ("assetId", "edition") REFERENCES "LibraryAsset"("id", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCoverage" ADD CONSTRAINT "AssetCoverage_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition") REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaSubtitlePolicyVersion" ADD CONSTRAINT "MediaSubtitlePolicyVersion_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition") REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchState" ADD CONSTRAINT "WatchState_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition") REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionHold" ADD CONSTRAINT "RetentionHold_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition") REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionDecision" ADD CONSTRAINT "RetentionDecision_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition") REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryHold" ADD CONSTRAINT "RecoveryHold_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition") REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nullable legacy lineage is retained; named targets cannot invent missing roots.
ALTER TABLE "MediaIntent" ADD CONSTRAINT "MediaIntent_named_root_check"
 CHECK (edition = 'default' OR "editionRootId" IS NOT NULL);
ALTER TABLE "LibraryAsset" ADD CONSTRAINT "LibraryAsset_named_root_check"
 CHECK (edition = 'default' OR "editionRootId" IS NOT NULL);

CREATE FUNCTION immutable_edition_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."rootMediaId", NEW.key, NEW.policy, NEW."pathLabel", NEW."plexLabel", NEW."definitionVersion")
  IS DISTINCT FROM ROW(OLD."rootMediaId", OLD.key, OLD.policy, OLD."pathLabel", OLD."plexLabel", OLD."definitionVersion") THEN
  RAISE EXCEPTION 'Edition definition authority is immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "MediaEditionDefinition_immutable_authority"
 BEFORE UPDATE ON "MediaEditionDefinition" FOR EACH ROW EXECUTE FUNCTION immutable_edition_definition();

CREATE FUNCTION immutable_attempt_edition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.edition IS DISTINCT FROM OLD.edition THEN
  RAISE EXCEPTION 'Acquisition attempt edition is immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "AcquisitionAttempt_immutable_edition"
 BEFORE UPDATE ON "AcquisitionAttempt" FOR EACH ROW EXECUTE FUNCTION immutable_attempt_edition();

COMMIT;
