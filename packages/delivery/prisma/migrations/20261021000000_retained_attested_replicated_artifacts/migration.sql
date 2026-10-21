-- Chart content identity with the version string excluded (X10). Producers
-- stamp it so an unchanged chart is retained instead of republished.
ALTER TABLE "Artifact" ADD COLUMN "contentFingerprint" TEXT;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_content_fingerprint_check" CHECK ("contentFingerprint" IS NULL OR "contentFingerprint" ~ '^sha256:[a-f0-9]{64}$');
-- Off-cluster replica receipt for bytes in a self-hosted store (PC1).
ALTER TABLE "Artifact" ADD COLUMN "replication" JSONB;
-- Registration order for every new build; the order key of an attested build
-- (B4). Existing rows stay NULL: the default is attached after the column so
-- PostgreSQL does not backfill a volatile sequence value in physical order.
CREATE SEQUENCE "Build_registrationSequence_seq" AS INTEGER START WITH 1;
ALTER TABLE "Build" ADD COLUMN "registrationSequence" INTEGER;
ALTER TABLE "Build" ALTER COLUMN "registrationSequence" SET DEFAULT nextval('"Build_registrationSequence_seq"');
ALTER SEQUENCE "Build_registrationSequence_seq" OWNED BY "Build"."registrationSequence";
CREATE INDEX "Build_serviceId_registrationSequence_idx" ON "Build"("serviceId", "registrationSequence");
-- Acquisitions carry the acquiring pipeline's identity (B3); attested builds
-- are operator registrations with no pipeline. Licensed-bundle rows predate
-- the attested kind and keep their shape.
ALTER TABLE "Build" DROP CONSTRAINT "Build_source_identity_check";
ALTER TABLE "Build" ADD CONSTRAINT "Build_source_identity_check" CHECK (
  ("sourceKind" = 'ci' AND "ciUrl" IS NOT NULL AND "repositoryId" IS NOT NULL AND "pipelineNumber" IS NOT NULL)
  OR ("sourceKind" = 'upstream' AND "ciUrl" IS NULL AND (("repositoryId" IS NULL AND "pipelineNumber" IS NULL) OR ("repositoryId" IS NOT NULL AND "pipelineNumber" IS NOT NULL)))
  OR ("sourceKind" IN ('licensed-bundle', 'attested') AND "ciUrl" IS NULL AND "repositoryId" IS NULL AND "pipelineNumber" IS NULL)
);
ALTER TABLE "Build" ADD CONSTRAINT "Build_attested_sequence_check" CHECK ("sourceKind" <> 'attested' OR "registrationSequence" IS NOT NULL);
