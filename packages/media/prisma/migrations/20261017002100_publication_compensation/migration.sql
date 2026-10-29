CREATE TABLE "MediaPublicationTransition" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "birthEpoch" INTEGER NOT NULL,
  "filePlanHash" TEXT NOT NULL,
  "intent" JSONB NOT NULL,
  "intentHash" TEXT NOT NULL,
  "outcome" JSONB,
  "outcomeHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_pub_transition_pk" PRIMARY KEY ("id"),
  CONSTRAINT "media_pub_transition_attempt_fk" FOREIGN KEY ("attemptId") REFERENCES "AcquisitionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "media_pub_transition_valid" CHECK (
    "birthEpoch" >= 0 AND "filePlanHash" ~ '^[a-f0-9]{64}$' AND "intentHash" ~ '^[a-f0-9]{64}$'
    AND COALESCE("intent"->'schemaVersion' = '1'::jsonb AND "intent"->>'transitionId' = "id"
      AND "intent"->>'attemptId' = "attemptId" AND "intent"->'birthEpoch' = to_jsonb("birthEpoch")
      AND "intent"->>'filePlanHash' = "filePlanHash", FALSE)
    AND (("outcome" IS NULL AND "outcomeHash" IS NULL) OR
      ("outcome" IS NOT NULL AND "outcomeHash" IS NOT NULL AND "outcomeHash" ~ '^[a-f0-9]{64}$'
       AND COALESCE("outcome"->'schemaVersion' = '1'::jsonb AND "outcome"->>'transitionId' = "id"
         AND "outcome"->>'intentHash' = "intentHash" AND "outcome"->>'kind' IN ('published','compensated'), FALSE)))
  )
);
CREATE UNIQUE INDEX "media_pub_transition_attempt_key" ON "MediaPublicationTransition"("attemptId");
CREATE FUNCTION protect_media_publication_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Publication transitions cannot be deleted'; END IF;
  IF ROW(NEW."id",NEW."attemptId",NEW."birthEpoch",NEW."filePlanHash",NEW."intent",NEW."intentHash",NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."id",OLD."attemptId",OLD."birthEpoch",OLD."filePlanHash",OLD."intent",OLD."intentHash",OLD."createdAt") OR
     (OLD."outcome" IS NOT NULL AND ROW(NEW."outcome",NEW."outcomeHash") IS DISTINCT FROM ROW(OLD."outcome",OLD."outcomeHash")) THEN
    RAISE EXCEPTION 'Publication intent and completed outcome are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "media_pub_transition_immutable" BEFORE UPDATE OR DELETE ON "MediaPublicationTransition"
FOR EACH ROW EXECUTE FUNCTION protect_media_publication_transition();

CREATE TABLE "NativePublicationCompensationContinuation" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "transitionId" TEXT NOT NULL,
  "recoveryEpoch" INTEGER NOT NULL,
  "mediaIds" TEXT[] NOT NULL,
  "assetIds" TEXT[] NOT NULL,
  "descriptor" JSONB NOT NULL,
  "descriptorHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "version" INTEGER NOT NULL DEFAULT 0,
  "coordinatorOperationId" TEXT,
  "executionEvidence" JSONB,
  "completion" JSONB,
  "publicationCoordinatorOperationId" TEXT,
  "verifiedPublication" JSONB,
  "fenceRelease" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "native_pub_comp_pk" PRIMARY KEY ("id"),
  CONSTRAINT "native_pub_comp_receipt_fk" FOREIGN KEY ("receiptId") REFERENCES "NativeRecoveryReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "native_pub_comp_transition_fk" FOREIGN KEY ("transitionId") REFERENCES "MediaPublicationTransition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "native_pub_comp_execution_op_fk" FOREIGN KEY ("coordinatorOperationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "native_pub_comp_publication_op_fk" FOREIGN KEY ("publicationCoordinatorOperationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "native_pub_comp_valid" CHECK (
    "recoveryEpoch" >= 0 AND "version" >= 0 AND "descriptorHash" ~ '^[a-f0-9]{64}$'
    AND cardinality("mediaIds") BETWEEN 1 AND 100 AND cardinality("assetIds") BETWEEN 1 AND 25
    AND "state" IN ('pending','compensating','protected','compensated')
    AND (("state" = 'compensated') = ("completion" IS NOT NULL))
    AND COALESCE("descriptor"->'schemaVersion' = '1'::jsonb AND "descriptor"->>'allowedAction' = 'compensate', FALSE)
    AND ("executionEvidence" IS NULL OR COALESCE(
      "executionEvidence"->'schemaVersion' = '1'::jsonb AND "executionEvidence"->>'continuationId' = "id"
      AND "executionEvidence"->>'descriptorHash' = "descriptorHash" AND "executionEvidence"->'recoveryEpoch' = to_jsonb("recoveryEpoch"), FALSE))
    AND ("completion" IS NULL OR ("executionEvidence" IS NOT NULL AND COALESCE(
      "completion"->'schemaVersion' = '1'::jsonb AND "completion"->>'continuationId' = "id"
      AND "completion"->>'receiptId' = "receiptId" AND "completion"->>'descriptorHash' = "descriptorHash"
      AND "completion"->'recoveryEpoch' = to_jsonb("recoveryEpoch"), FALSE)))
    AND ("verifiedPublication" IS NULL OR ("completion" IS NOT NULL AND "fenceRelease" IS NOT NULL
      AND "publicationCoordinatorOperationId" IS NOT NULL AND COALESCE(
        "verifiedPublication"->'schemaVersion' = '1'::jsonb AND "verifiedPublication"->>'continuationId' = "id"
        AND "verifiedPublication"->>'operationId' = "publicationCoordinatorOperationId"
        AND "verifiedPublication"->'recoveryEpoch' = to_jsonb("recoveryEpoch"), FALSE)))
    AND ("fenceRelease" IS NULL OR COALESCE(
      "fenceRelease"->'schemaVersion' = '1'::jsonb AND "fenceRelease"->>'continuationId' = "id"
      AND "fenceRelease"->>'transitionId' = "transitionId"
      AND "fenceRelease"->>'publicationHash' ~ '^[a-f0-9]{64}$', FALSE))
  )
);
CREATE UNIQUE INDEX "native_pub_comp_receipt_key" ON "NativePublicationCompensationContinuation"("receiptId");
CREATE UNIQUE INDEX "native_comp_transition_epoch_key" ON "NativePublicationCompensationContinuation"("transitionId","recoveryEpoch");
CREATE INDEX "native_pub_comp_state_epoch_idx" ON "NativePublicationCompensationContinuation"("state","recoveryEpoch");
CREATE INDEX "native_pub_comp_media_idx" ON "NativePublicationCompensationContinuation" USING GIN ("mediaIds");
CREATE INDEX "native_pub_comp_asset_idx" ON "NativePublicationCompensationContinuation" USING GIN ("assetIds");
CREATE FUNCTION protect_native_publication_compensation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Compensation authority cannot be deleted'; END IF;
  IF ROW(NEW."id",NEW."receiptId",NEW."transitionId",NEW."recoveryEpoch",NEW."mediaIds",NEW."assetIds",NEW."descriptor",NEW."descriptorHash",NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."id",OLD."receiptId",OLD."transitionId",OLD."recoveryEpoch",OLD."mediaIds",OLD."assetIds",OLD."descriptor",OLD."descriptorHash",OLD."createdAt") OR
     (OLD."executionEvidence" IS NOT NULL AND NEW."executionEvidence" IS DISTINCT FROM OLD."executionEvidence") OR
     (OLD."completion" IS NOT NULL AND NEW."completion" IS DISTINCT FROM OLD."completion") OR
     (OLD."verifiedPublication" IS NOT NULL AND NEW."verifiedPublication" IS DISTINCT FROM OLD."verifiedPublication") OR
     (OLD."fenceRelease" IS NOT NULL AND NEW."fenceRelease" IS DISTINCT FROM OLD."fenceRelease") OR
     (OLD."state" = 'compensated' AND ROW(NEW."state",NEW."coordinatorOperationId") IS DISTINCT FROM ROW(OLD."state",OLD."coordinatorOperationId")) OR
     (OLD."fenceRelease" IS NOT NULL AND ROW(NEW."state",NEW."coordinatorOperationId",NEW."publicationCoordinatorOperationId",NEW."executionEvidence",NEW."completion",NEW."verifiedPublication") IS DISTINCT FROM ROW(OLD."state",OLD."coordinatorOperationId",OLD."publicationCoordinatorOperationId",OLD."executionEvidence",OLD."completion",OLD."verifiedPublication")) THEN
    RAISE EXCEPTION 'Compensation authority and recorded outcomes are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "native_pub_comp_immutable" BEFORE UPDATE OR DELETE ON "NativePublicationCompensationContinuation"
FOR EACH ROW EXECUTE FUNCTION protect_native_publication_compensation();

ALTER TABLE "NativeArchiveCleanupContinuation" ADD COLUMN "supersession" JSONB;
ALTER TABLE "NativeArchiveCleanupContinuation" DROP CONSTRAINT "NativeArchiveCleanupContinuation_valid";
ALTER TABLE "NativeArchiveCleanupContinuation" ADD CONSTRAINT "NativeArchiveCleanupContinuation_valid" CHECK (
  "recoveryEpoch" >= 0 AND "version" >= 0 AND "descriptorHash" ~ '^[a-f0-9]{64}$'
  AND "state" IN ('pending','cleaning','protected','cleaned','superseded')
  AND (("state" = 'superseded') = ("supersession" IS NOT NULL))
  AND ("supersession" IS NULL OR ("completion" IS NULL AND COALESCE(
    "supersession"->'schemaVersion' = '1'::jsonb AND "supersession"->>'continuationId' = "id"
    AND "supersession"->>'descriptorHash' = "descriptorHash", FALSE)))
);
CREATE OR REPLACE FUNCTION protect_native_archive_continuation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Native archive continuation cannot be deleted'; END IF;
  IF ROW(NEW."id",NEW."receiptId",NEW."originalCleanupId",NEW."recoveryEpoch",NEW."descriptor",NEW."descriptorHash",NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."id",OLD."receiptId",OLD."originalCleanupId",OLD."recoveryEpoch",OLD."descriptor",OLD."descriptorHash",OLD."createdAt") OR
     (OLD."executionEvidence" IS NOT NULL AND NEW."executionEvidence" IS DISTINCT FROM OLD."executionEvidence") OR
     (OLD."completion" IS NOT NULL AND NEW."completion" IS DISTINCT FROM OLD."completion") OR
     (OLD."supersession" IS NOT NULL AND NEW."supersession" IS DISTINCT FROM OLD."supersession") OR
     (OLD."state" = 'superseded' AND ROW(NEW."state",NEW."coordinatorOperationId",NEW."executionEvidence",NEW."completion") IS DISTINCT FROM ROW(OLD."state",OLD."coordinatorOperationId",OLD."executionEvidence",OLD."completion")) THEN
    RAISE EXCEPTION 'Native archive authority and completed evidence are immutable';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE "NativeRecoveryObservation" DROP CONSTRAINT "NativeRecoveryObservation_evidence_check";
ALTER TABLE "NativeRecoveryObservation" ADD CONSTRAINT "NativeRecoveryObservation_evidence_check"
CHECK ("kind" IN ('network','files','archive_cleanup_network','compensation_network') AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "observedAt");
