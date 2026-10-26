CREATE TABLE "PlexAssociationEvidence" (
  "id" TEXT NOT NULL, "mediaId" TEXT NOT NULL, "edition" TEXT NOT NULL,
  "assetId" TEXT NOT NULL, "serverMachineId" TEXT NOT NULL,
  "associationHash" TEXT NOT NULL, "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlexAssociationEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plex_evidence_shape" CHECK (COALESCE(
    "associationHash" ~ '^[a-f0-9]{64}$' AND evidence->'schemaVersion' = '1'::jsonb
    AND evidence #>> '{scope,mediaId}' = "mediaId" AND evidence #>> '{scope,edition}' = edition
    AND evidence #>> '{group,assetId}' = "assetId"
    AND evidence #>> '{access,serverMachineId}' = "serverMachineId", false))
);
CREATE UNIQUE INDEX "plex_evidence_scope_hash" ON "PlexAssociationEvidence"("mediaId","edition","associationHash");
CREATE UNIQUE INDEX "plex_evidence_scope_id" ON "PlexAssociationEvidence"("id","mediaId","edition","associationHash");
CREATE INDEX "plex_evidence_asset_idx" ON "PlexAssociationEvidence"("assetId");
ALTER TABLE "PlexAssociationEvidence" ADD CONSTRAINT "PlexAssociationEvidence_mediaId_edition_fkey" FOREIGN KEY ("mediaId","edition") REFERENCES "MediaIntent"("mediaId","edition") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PlexAssociationEvidence" ADD CONSTRAINT "PlexAssociationEvidence_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "LibraryAsset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "PlexBindingCurrent" (
  "mediaId" TEXT NOT NULL, "edition" TEXT NOT NULL,
  "evidenceId" TEXT, "associationHash" TEXT, "revision" INTEGER NOT NULL DEFAULT 0,
  "verifiedStartedAt" TIMESTAMP(3), "verifiedCompletedAt" TIMESTAMP(3),
  CONSTRAINT "plex_binding_current_pk" PRIMARY KEY ("mediaId","edition"),
  CONSTRAINT "plex_current_shape" CHECK (revision >= 0 AND (
    ("evidenceId" IS NULL AND "associationHash" IS NULL AND "verifiedStartedAt" IS NULL AND "verifiedCompletedAt" IS NULL)
    OR ("evidenceId" IS NOT NULL AND "associationHash" IS NOT NULL AND revision > 0
      AND "verifiedStartedAt" IS NOT NULL AND "verifiedCompletedAt" IS NOT NULL
      AND "verifiedCompletedAt" >= "verifiedStartedAt")))
);
CREATE INDEX "plex_current_evidence_idx" ON "PlexBindingCurrent"("evidenceId");
ALTER TABLE "PlexBindingCurrent" ADD CONSTRAINT "PlexBindingCurrent_mediaId_edition_fkey" FOREIGN KEY ("mediaId","edition") REFERENCES "MediaIntent"("mediaId","edition") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PlexBindingCurrent" ADD CONSTRAINT "plex_current_evidence_fk" FOREIGN KEY ("evidenceId","mediaId","edition","associationHash") REFERENCES "PlexAssociationEvidence"("id","mediaId","edition","associationHash") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "PlexClaimGroup" (
  "id" TEXT NOT NULL, "serverMachineId" TEXT NOT NULL, "groupHash" TEXT NOT NULL, "group" JSONB NOT NULL,
  CONSTRAINT "PlexClaimGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plex_group_shape" CHECK (COALESCE("groupHash" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("group"->'coverage') = 'array' AND jsonb_array_length("group"->'coverage') > 0, false))
);
CREATE UNIQUE INDEX "plex_claim_group_key" ON "PlexClaimGroup"("serverMachineId","groupHash");
CREATE TABLE "PlexClaimGroupMember" (
  "groupId" TEXT NOT NULL, "mediaId" TEXT NOT NULL, "edition" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL, "associationHash" TEXT NOT NULL,
  CONSTRAINT "plex_claim_member_pk" PRIMARY KEY ("groupId","mediaId","edition")
);
CREATE UNIQUE INDEX "plex_claim_member_scope" ON "PlexClaimGroupMember"("mediaId","edition");
ALTER TABLE "PlexClaimGroupMember" ADD CONSTRAINT "PlexClaimGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PlexClaimGroup"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PlexClaimGroupMember" ADD CONSTRAINT "plex_member_evidence_fk" FOREIGN KEY ("evidenceId","mediaId","edition","associationHash") REFERENCES "PlexAssociationEvidence"("id","mediaId","edition","associationHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "PlexItemClaim" (
  "serverMachineId" TEXT NOT NULL, "sectionId" TEXT NOT NULL, "ratingKey" TEXT NOT NULL,
  "groupId" TEXT NOT NULL, "mediaId" TEXT NOT NULL, "edition" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL, "associationHash" TEXT NOT NULL,
  CONSTRAINT "plex_item_claim_pk" PRIMARY KEY ("serverMachineId","sectionId","ratingKey")
);
CREATE UNIQUE INDEX "plex_item_member_key" ON "PlexItemClaim"("groupId","mediaId","edition");
ALTER TABLE "PlexItemClaim" ADD CONSTRAINT "plex_item_member_fk" FOREIGN KEY ("groupId","mediaId","edition") REFERENCES "PlexClaimGroupMember"("groupId","mediaId","edition") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PlexItemClaim" ADD CONSTRAINT "plex_item_evidence_fk" FOREIGN KEY ("evidenceId","mediaId","edition","associationHash") REFERENCES "PlexAssociationEvidence"("id","mediaId","edition","associationHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "PlexPartClaim" (
  "serverMachineId" TEXT NOT NULL, "partId" TEXT NOT NULL, "groupId" TEXT NOT NULL, "canonicalPath" TEXT NOT NULL,
  CONSTRAINT "plex_part_claim_pk" PRIMARY KEY ("serverMachineId","partId")
);
CREATE INDEX "plex_part_group_idx" ON "PlexPartClaim"("groupId");
ALTER TABLE "PlexPartClaim" ADD CONSTRAINT "PlexPartClaim_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PlexClaimGroup"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "PlexPathClaim" (
  "serverMachineId" TEXT NOT NULL, "canonicalPathHash" TEXT NOT NULL,
  "canonicalPath" TEXT NOT NULL, "groupId" TEXT NOT NULL,
  CONSTRAINT "plex_path_claim_pk" PRIMARY KEY ("serverMachineId","canonicalPathHash"),
  CONSTRAINT "plex_path_hash" CHECK ("canonicalPathHash" = encode(sha256(convert_to("canonicalPath",'UTF8')),'hex'))
);
CREATE INDEX "plex_path_group_idx" ON "PlexPathClaim"("groupId");
ALTER TABLE "PlexPathClaim" ADD CONSTRAINT "PlexPathClaim_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PlexClaimGroup"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "PlexWatchProjection" (
  "userId" TEXT NOT NULL, "mediaId" TEXT NOT NULL, "edition" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL, "associationHash" TEXT NOT NULL, "bindingRevision" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL, "watchBatchRevision" BIGINT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL, "watched" BOOLEAN NOT NULL, "source" TEXT NOT NULL,
  "authority" JSONB NOT NULL, "authorityHash" TEXT NOT NULL,
  CONSTRAINT "plex_watch_projection_pk" PRIMARY KEY ("userId","mediaId","edition"),
  CONSTRAINT "plex_watch_shape" CHECK (COALESCE(
    purpose IN ('current_serving','quarantined') AND source = 'plex' AND "bindingRevision" > 0 AND "watchBatchRevision" > 0
    AND "authorityHash" ~ '^[a-f0-9]{64}$' AND authority->>'purpose' = purpose
    AND authority #>> '{binding,evidenceId}' = "evidenceId"
    AND authority #>> '{binding,associationHash}' = "associationHash"
    AND authority #> '{binding,revision}' = to_jsonb("bindingRevision")
    AND authority #>> '{binding,scope,mediaId}' = "mediaId"
    AND authority #>> '{binding,scope,edition}' = edition, false))
);
ALTER TABLE "PlexWatchProjection" ADD CONSTRAINT "PlexWatchProjection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PlexWatchProjection" ADD CONSTRAINT "PlexWatchProjection_mediaId_edition_fkey" FOREIGN KEY ("mediaId","edition") REFERENCES "MediaIntent"("mediaId","edition") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PlexWatchProjection" ADD CONSTRAINT "plex_watch_evidence_fk" FOREIGN KEY ("evidenceId","mediaId","edition","associationHash") REFERENCES "PlexAssociationEvidence"("id","mediaId","edition","associationHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "RetentionPlexProjection" (
  "decisionId" TEXT NOT NULL, "projection" JSONB NOT NULL, "projectionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionPlexProjection_pkey" PRIMARY KEY ("decisionId"),
  CONSTRAINT "plex_retention_shape" CHECK (COALESCE("projectionHash" ~ '^[a-f0-9]{64}$'
    AND projection->'schemaVersion' = '1'::jsonb AND projection->>'decisionId' = "decisionId", false))
);
ALTER TABLE "RetentionPlexProjection" ADD CONSTRAINT "RetentionPlexProjection_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "RetentionDecision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "PlexBindingVerificationRequest" (
  "operationId" TEXT NOT NULL, "expected" JSONB NOT NULL, "expectedHash" TEXT NOT NULL,
  "recoveryEpoch" INTEGER NOT NULL, "assetIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlexBindingVerificationRequest_pkey" PRIMARY KEY ("operationId"),
  CONSTRAINT "plex_verify_request_shape" CHECK (COALESCE("expectedHash" ~ '^[a-f0-9]{64}$'
    AND "recoveryEpoch" >= 0 AND cardinality("assetIds") BETWEEN 1 AND 100
    AND expected->'schemaVersion' = '1'::jsonb AND expected->'recoveryEpoch' = to_jsonb("recoveryEpoch"), false))
);
CREATE UNIQUE INDEX "plex_verify_request_hash" ON "PlexBindingVerificationRequest"("operationId","expectedHash");
ALTER TABLE "PlexBindingVerificationRequest" ADD CONSTRAINT "PlexBindingVerificationRequest_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "PlexBindingVerificationReceipt" (
  "operationId" TEXT NOT NULL, "expectedHash" TEXT NOT NULL, "completion" JSONB NOT NULL, "completionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plex_verify_receipt_pk" PRIMARY KEY ("operationId"),
  CONSTRAINT "plex_verify_receipt_shape" CHECK (COALESCE("completionHash" ~ '^[a-f0-9]{64}$'
    AND completion->'schemaVersion' = '1'::jsonb AND completion->>'operationId' = "operationId"
    AND completion->>'expectedHash' = "expectedHash"
    AND jsonb_typeof(completion->'bindings') = 'array'
    AND jsonb_array_length(completion->'bindings') BETWEEN 1 AND 10000
    AND completion->'bindingCount' = to_jsonb(jsonb_array_length(completion->'bindings')), false))
);
ALTER TABLE "PlexBindingVerificationReceipt" ADD CONSTRAINT "plex_verify_receipt_request_fk" FOREIGN KEY ("operationId","expectedHash") REFERENCES "PlexBindingVerificationRequest"("operationId","expectedHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "plex_verify_receipt_parent" ON "PlexBindingVerificationReceipt"("operationId","expectedHash");

CREATE TABLE "NativePlexProofBatch" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "operationId" TEXT NOT NULL,
  "networkObservationId" TEXT NOT NULL, "plexObservationId" TEXT NOT NULL,
  "batch" JSONB NOT NULL, "batchHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativePlexProofBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "native_plex_batch_shape" CHECK (COALESCE("batchHash" ~ '^[a-f0-9]{64}$'
    AND batch->'schemaVersion' = '1'::jsonb AND batch->>'batchId' = id
    AND batch #>> '{parent,planId}' = "planId" AND batch #>> '{parent,operationId}' = "operationId"
    AND batch #>> '{network,observationId}' = "networkObservationId"
    AND batch #>> '{plex,observationId}' = "plexObservationId", false))
);
CREATE UNIQUE INDEX "native_plex_network_key" ON "NativePlexProofBatch"("networkObservationId");
CREATE UNIQUE INDEX "native_plex_observation_key" ON "NativePlexProofBatch"("plexObservationId");
CREATE INDEX "native_plex_plan_idx" ON "NativePlexProofBatch"("planId");
CREATE INDEX "native_plex_operation_idx" ON "NativePlexProofBatch"("operationId");
ALTER TABLE "NativePlexProofBatch" ADD CONSTRAINT "NativePlexProofBatch_planId_fkey" FOREIGN KEY ("planId") REFERENCES "NativeRecoveryPlan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NativePlexProofBatch" ADD CONSTRAINT "NativePlexProofBatch_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NativePlexProofBatch" ADD CONSTRAINT "NativePlexProofBatch_networkObservationId_fkey" FOREIGN KEY ("networkObservationId") REFERENCES "NativeRecoveryObservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NativePlexProofBatch" ADD CONSTRAINT "NativePlexProofBatch_plexObservationId_fkey" FOREIGN KEY ("plexObservationId") REFERENCES "NativeRecoveryObservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION media_plex_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Plex authority history is immutable'; END;
$$;
CREATE TRIGGER plex_evidence_immutable BEFORE UPDATE OR DELETE ON "PlexAssociationEvidence" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER plex_retention_immutable BEFORE UPDATE OR DELETE ON "RetentionPlexProjection" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER plex_verify_request_immutable BEFORE UPDATE OR DELETE ON "PlexBindingVerificationRequest" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER plex_verify_receipt_immutable BEFORE UPDATE OR DELETE ON "PlexBindingVerificationReceipt" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER native_plex_batch_immutable BEFORE UPDATE OR DELETE ON "NativePlexProofBatch" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER plex_group_immutable BEFORE UPDATE ON "PlexClaimGroup" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER plex_member_immutable BEFORE UPDATE ON "PlexClaimGroupMember" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER plex_item_immutable BEFORE UPDATE ON "PlexItemClaim" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER plex_part_immutable BEFORE UPDATE ON "PlexPartClaim" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();
CREATE TRIGGER plex_path_immutable BEFORE UPDATE ON "PlexPathClaim" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();

CREATE FUNCTION media_plex_pointer_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Plex binding revision cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> (CASE WHEN NEW."evidenceId" IS NULL THEN 0 ELSE 1 END) THEN
      RAISE EXCEPTION 'Plex pointer starts at its first revision';
    END IF;
  ELSIF (NEW."mediaId",NEW.edition) IS DISTINCT FROM (OLD."mediaId",OLD.edition) THEN
    RAISE EXCEPTION 'Plex pointer scope is immutable';
  ELSIF (NEW."evidenceId",NEW."associationHash") IS DISTINCT FROM (OLD."evidenceId",OLD."associationHash") THEN
    IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Plex pointer change requires next revision'; END IF;
  ELSIF NEW.revision <> OLD.revision OR NEW."verifiedStartedAt" < OLD."verifiedStartedAt"
    OR NEW."verifiedCompletedAt" < OLD."verifiedCompletedAt" THEN
    RAISE EXCEPTION 'Plex verification cannot regress';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER plex_pointer_revision BEFORE INSERT OR UPDATE OR DELETE ON "PlexBindingCurrent" FOR EACH ROW EXECUTE FUNCTION media_plex_pointer_revision();

-- This table is transaction-local work deduplication, never product authority.
-- A deferred event still validates its group if a caller deletes the work row.
CREATE TABLE "PlexClaimValidation" (
  "transactionId" BIGINT NOT NULL, "groupId" TEXT NOT NULL,
  CONSTRAINT "plex_claim_validation_pk" PRIMARY KEY ("transactionId","groupId")
);
CREATE FUNCTION media_plex_assert_deadline() RETURNS void LANGUAGE plpgsql AS $$
DECLARE deadline TEXT := current_setting('media.plex_deadline_ms', true);
BEGIN
  IF deadline IS NULL OR deadline !~ '^[0-9]{1,16}$'
    OR deadline::numeric > 9007199254740991
    OR deadline::numeric > extract(epoch FROM transaction_timestamp()) * 1000 + 60000
    OR extract(epoch FROM clock_timestamp()) * 1000 >= deadline::numeric THEN
    RAISE EXCEPTION 'Plex authority deadline missing or expired';
  END IF;
END;
$$;
CREATE FUNCTION media_plex_enqueue_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_id TEXT; new_id TEXT;
BEGIN
  PERFORM media_plex_assert_deadline();
  IF TG_OP <> 'INSERT' THEN
    old_id := CASE WHEN TG_TABLE_NAME = 'PlexClaimGroup' THEN to_jsonb(OLD)->>'id' ELSE to_jsonb(OLD)->>'groupId' END;
    INSERT INTO "PlexClaimValidation" VALUES (txid_current(),old_id) ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_id := CASE WHEN TG_TABLE_NAME = 'PlexClaimGroup' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'groupId' END;
    INSERT INTO "PlexClaimValidation" VALUES (txid_current(),new_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER plex_group_queue AFTER INSERT OR UPDATE OR DELETE ON "PlexClaimGroup" FOR EACH ROW EXECUTE FUNCTION media_plex_enqueue_group();
CREATE TRIGGER plex_member_queue AFTER INSERT OR UPDATE OR DELETE ON "PlexClaimGroupMember" FOR EACH ROW EXECUTE FUNCTION media_plex_enqueue_group();
CREATE TRIGGER plex_item_queue AFTER INSERT OR UPDATE OR DELETE ON "PlexItemClaim" FOR EACH ROW EXECUTE FUNCTION media_plex_enqueue_group();
CREATE TRIGGER plex_part_queue AFTER INSERT OR UPDATE OR DELETE ON "PlexPartClaim" FOR EACH ROW EXECUTE FUNCTION media_plex_enqueue_group();
CREATE TRIGGER plex_path_queue AFTER INSERT OR UPDATE OR DELETE ON "PlexPathClaim" FOR EACH ROW EXECUTE FUNCTION media_plex_enqueue_group();

CREATE FUNCTION media_plex_validate_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope_media TEXT; scope_edition TEXT; pointer "PlexBindingCurrent"; member "PlexClaimGroupMember";
BEGIN
  PERFORM media_plex_assert_deadline();
  scope_media := CASE WHEN TG_OP = 'DELETE' THEN OLD."mediaId" ELSE NEW."mediaId" END;
  scope_edition := CASE WHEN TG_OP = 'DELETE' THEN OLD.edition ELSE NEW.edition END;
  SELECT * INTO pointer FROM "PlexBindingCurrent" WHERE "mediaId"=scope_media AND edition=scope_edition;
  SELECT * INTO member FROM "PlexClaimGroupMember" WHERE "mediaId"=scope_media AND edition=scope_edition;
  IF (pointer."evidenceId" IS NULL) <> (member."evidenceId" IS NULL)
    OR (pointer."evidenceId",pointer."associationHash") IS DISTINCT FROM (member."evidenceId",member."associationHash") THEN
    RAISE EXCEPTION 'Plex pointer and complete group membership disagree';
  END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER plex_pointer_membership AFTER INSERT OR UPDATE ON "PlexBindingCurrent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_plex_validate_scope();
CREATE CONSTRAINT TRIGGER plex_member_pointer AFTER INSERT OR UPDATE OR DELETE ON "PlexClaimGroupMember" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_plex_validate_scope();

CREATE FUNCTION media_plex_validate_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g "PlexClaimGroup"; coverage JSONB;
BEGIN
  PERFORM media_plex_assert_deadline();
  IF NEW."transactionId" <> txid_current() THEN RAISE EXCEPTION 'Plex validation transaction changed'; END IF;
  SELECT * INTO g FROM "PlexClaimGroup" WHERE id=NEW."groupId";
  IF FOUND THEN
    SELECT jsonb_agg(jsonb_build_object('mediaId',"mediaId",'edition',edition) ORDER BY "mediaId",edition)
      INTO coverage FROM "PlexClaimGroupMember" WHERE "groupId"=g.id;
    IF coverage IS DISTINCT FROM g."group"->'coverage' THEN
      RAISE EXCEPTION 'Plex claims require the complete physical coverage';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "PlexClaimGroupMember" m
      JOIN "PlexAssociationEvidence" e ON e.id=m."evidenceId"
      LEFT JOIN "PlexItemClaim" i ON i."groupId"=m."groupId" AND i."mediaId"=m."mediaId" AND i.edition=m.edition
      WHERE m."groupId"=g.id AND (
        e."serverMachineId" IS DISTINCT FROM g."serverMachineId"
        OR e.evidence->'group' IS DISTINCT FROM g."group"
        OR i."evidenceId" IS DISTINCT FROM m."evidenceId"
        OR i."associationHash" IS DISTINCT FROM m."associationHash"
        OR i."serverMachineId" IS DISTINCT FROM g."serverMachineId"
        OR i."sectionId" IS DISTINCT FROM e.evidence #>> '{access,sectionId}'
        OR i."ratingKey" IS DISTINCT FROM e.evidence #>> '{item,ratingKey}')) THEN
      RAISE EXCEPTION 'Plex item claims disagree with exact member evidence';
    END IF;
    IF EXISTS (
      WITH expected AS (
        SELECT DISTINCT g."serverMachineId" AS server,
          e.evidence #>> '{item,media,0,parts,0,id}' AS part,
          e.evidence #>> '{item,media,0,parts,0,file}' AS path
        FROM "PlexClaimGroupMember" m JOIN "PlexAssociationEvidence" e ON e.id=m."evidenceId" WHERE m."groupId"=g.id
      ), actual AS (
        SELECT "serverMachineId" AS server,"partId" AS part,"canonicalPath" AS path FROM "PlexPartClaim" WHERE "groupId"=g.id
      ) SELECT * FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual)
        UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) difference
    ) THEN RAISE EXCEPTION 'Plex Part claims are incomplete or changed'; END IF;
    IF (SELECT count(*) FROM "PlexPathClaim" WHERE "groupId"=g.id) <> 1
      OR NOT EXISTS (SELECT 1 FROM "PlexPathClaim" WHERE "groupId"=g.id
        AND "serverMachineId"=g."serverMachineId" AND "canonicalPath"=g."group"->>'canonicalPath') THEN
      RAISE EXCEPTION 'Plex canonical path claim is incomplete or changed';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "PlexClaimGroupMember" WHERE "groupId"=NEW."groupId")
    OR EXISTS (SELECT 1 FROM "PlexPartClaim" WHERE "groupId"=NEW."groupId")
    OR EXISTS (SELECT 1 FROM "PlexPathClaim" WHERE "groupId"=NEW."groupId") THEN
    RAISE EXCEPTION 'Deleted Plex group retains claims';
  END IF;
  DELETE FROM "PlexClaimValidation" WHERE "transactionId"=NEW."transactionId" AND "groupId"=NEW."groupId";
  PERFORM media_plex_assert_deadline();
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER plex_validate_group AFTER INSERT ON "PlexClaimValidation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_plex_validate_group();
CREATE TRIGGER plex_validation_key_immutable BEFORE UPDATE ON "PlexClaimValidation" FOR EACH ROW EXECUTE FUNCTION media_plex_immutable();

CREATE FUNCTION media_plex_verification_request_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation";
BEGIN
  IF jsonb_typeof(NEW.expected->'targets') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.expected->'previous') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.expected->'oldGroups') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.expected->'newGroups') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.expected->'parents') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Plex verification expected arrays are required';
  END IF;
  IF jsonb_array_length(NEW.expected->'targets') NOT BETWEEN 1 AND 10000
    OR jsonb_array_length(NEW.expected->'previous') <> jsonb_array_length(NEW.expected->'targets')
    OR jsonb_array_length(NEW.expected->'oldGroups') > 100
    OR jsonb_array_length(NEW.expected->'newGroups') NOT BETWEEN 1 AND 100
    OR jsonb_array_length(NEW.expected->'parents') NOT BETWEEN 1 AND 100
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.expected->'targets') target
      WHERE target #>> '{scope,edition}' IS DISTINCT FROM 'default'
        OR target #>> '{definition,key}' IS DISTINCT FROM 'default'
        OR target #>> '{scope,mediaId}' IS NULL
        OR target->>'editionRootId' IS NULL
        OR target #>> '{definition,rootMediaId}' IS DISTINCT FROM target->>'editionRootId')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.expected->'previous') pointer
      WHERE pointer #>> '{scope,edition}' IS DISTINCT FROM 'default') THEN
    RAISE EXCEPTION 'Cold Plex verification admits complete default targets only';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements((NEW.expected->'oldGroups') || (NEW.expected->'newGroups')) physical
    WHERE physical->>'edition' IS DISTINCT FROM 'default'
      OR jsonb_typeof(physical->'coverage') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Cold Plex verification admits complete default groups only';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements((NEW.expected->'oldGroups') || (NEW.expected->'newGroups')) physical
    WHERE jsonb_array_length(physical->'coverage') NOT BETWEEN 1 AND 10000
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(physical->'coverage') member
        WHERE member->>'edition' IS DISTINCT FROM 'default' OR member->>'mediaId' IS NULL))
    OR NEW."assetIds" IS DISTINCT FROM ARRAY(SELECT physical->>'assetId'
      FROM jsonb_array_elements(NEW.expected->'newGroups') physical ORDER BY physical->>'assetId')
    OR NEW."assetIds" IS DISTINCT FROM ARRAY(SELECT DISTINCT asset FROM unnest(NEW."assetIds") asset ORDER BY asset) THEN
    RAISE EXCEPTION 'Cold Plex verification command coverage changed';
  END IF;
  SELECT * INTO STRICT command FROM "Operation" WHERE id=NEW."operationId";
  IF command.kind <> 'reverify_plex_binding'
    OR command.payload IS DISTINCT FROM jsonb_build_object(
      'schemaVersion',1,'kind','reverify_plex_binding','operationId',NEW."operationId",
      'recoveryEpoch',NEW."recoveryEpoch",'assetIds',to_jsonb(NEW."assetIds")) THEN
    RAISE EXCEPTION 'Plex verification request does not match its exact command';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER plex_verify_request_parent BEFORE INSERT ON "PlexBindingVerificationRequest" FOR EACH ROW EXECUTE FUNCTION media_plex_verification_request_parent();

CREATE FUNCTION media_plex_verification_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request "PlexBindingVerificationRequest"; expected_scopes JSONB; actual_scopes JSONB;
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT request FROM "PlexBindingVerificationRequest" WHERE "operationId"=NEW."operationId";
  IF NEW.completion->'recoveryEpoch' IS DISTINCT FROM to_jsonb(request."recoveryEpoch") THEN
    RAISE EXCEPTION 'Plex completion epoch changed';
  END IF;
  SELECT jsonb_agg(member ORDER BY member->>'mediaId',member->>'edition')
    INTO expected_scopes FROM jsonb_array_elements(request.expected->'newGroups') physical,
      LATERAL jsonb_array_elements(physical->'coverage') member;
  SELECT jsonb_agg(value->'scope' ORDER BY value #>> '{scope,mediaId}', value #>> '{scope,edition}')
    INTO actual_scopes FROM jsonb_array_elements(NEW.completion->'bindings');
  IF actual_scopes IS DISTINCT FROM expected_scopes OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.completion->'bindings') b
    LEFT JOIN "PlexBindingCurrent" c ON c."mediaId"=b #>> '{scope,mediaId}' AND c.edition=b #>> '{scope,edition}'
    WHERE c."evidenceId" IS DISTINCT FROM b->>'evidenceId'
      OR c."associationHash" IS DISTINCT FROM b->>'associationHash'
      OR to_jsonb(c.revision) IS DISTINCT FROM b->'revision'
  ) THEN RAISE EXCEPTION 'Plex completion requires the complete atomically committed bindings'; END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER plex_verify_receipt_commit AFTER INSERT ON "PlexBindingVerificationReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_plex_verification_commit();

CREATE FUNCTION media_native_plex_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan "NativeRecoveryPlan"; network "NativeRecoveryObservation"; plex "NativeRecoveryObservation";
BEGIN
  SELECT * INTO STRICT plan FROM "NativeRecoveryPlan" WHERE id=NEW."planId";
  SELECT * INTO STRICT network FROM "NativeRecoveryObservation" WHERE id=NEW."networkObservationId";
  SELECT * INTO STRICT plex FROM "NativeRecoveryObservation" WHERE id=NEW."plexObservationId";
  IF network."planId" <> plan.id OR plex."planId" <> plan.id
    OR network.kind IS DISTINCT FROM NEW.batch #>> '{parent,networkKind}' OR plex.kind <> 'plex_association'
    OR NEW.batch #> '{parent,recoveryEpoch}' IS DISTINCT FROM to_jsonb(plan."recoveryEpoch")
    OR NEW.batch #>> '{network,evidenceHash}' IS DISTINCT FROM network."evidenceHash"
    OR NEW.batch #>> '{plex,evidenceHash}' IS DISTINCT FROM plex."evidenceHash"
    OR plex.evidence->'parent' IS DISTINCT FROM NEW.batch->'parent'
    OR plex.evidence->>'batchId' IS DISTINCT FROM NEW.id
    OR plex.evidence->'network' IS DISTINCT FROM NEW.batch->'network' THEN
    RAISE EXCEPTION 'Native Plex paired proof parent changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_plex_parent BEFORE INSERT ON "NativePlexProofBatch" FOR EACH ROW EXECUTE FUNCTION media_native_plex_parent();

ALTER TABLE "NativeRecoveryObservation" DROP CONSTRAINT "NativeRecoveryObservation_evidence_check";
ALTER TABLE "NativeRecoveryObservation" ADD CONSTRAINT "NativeRecoveryObservation_evidence_check"
  CHECK (kind IN ('network','files','archive_cleanup_network','compensation_network','plex_association')
    AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "observedAt");

-- SQL validates complete relational membership and same-TX physical updates.
-- Literal manifestHash uses the existing application snapshotHash, verified before parsing;
-- this trigger intentionally does not introduce a second canonical JSON serializer.
CREATE FUNCTION media_plex_quarantine_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; prior JSONB; first_manifest JSONB; decision JSONB; physical JSONB;
  d "RetentionDecision"; p "RetentionPlexProjection"; a "LibraryAsset";
  member_count INTEGER; binding_count INTEGER; manifest_count INTEGER; entry JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'quarantinePlexReceipt' THEN
    IF NEW.result->'quarantinePlexReceipt' IS DISTINCT FROM OLD.result->'quarantinePlexReceipt' THEN
      RAISE EXCEPTION 'Committed Plex quarantine receipt is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'quarantinePlexReceipt') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  proof := NEW.result->'quarantinePlexReceipt';
  IF jsonb_typeof(proof) IS DISTINCT FROM 'object' OR NOT COALESCE(
    proof ?& ARRAY['schemaVersion','operationId','decisionId','recoveryEpoch','manifestHash','decisions','groups','bindings','committedAt']
    AND proof - ARRAY['schemaVersion','operationId','decisionId','recoveryEpoch','manifestHash','decisions','groups','bindings','committedAt'] = '{}'::jsonb
    AND proof->'schemaVersion' = '1'::jsonb AND proof->>'operationId' = NEW.id
    AND NEW.kind = 'retain_media' AND NEW.payload->>'kind' = NEW.kind
    AND NEW.payload->>'operationId' = NEW.id AND NEW.payload->>'mediaId' = NEW."targetId"
    AND jsonb_typeof(proof->'recoveryEpoch') = 'number' AND proof->>'recoveryEpoch' ~ '^(0|[1-9][0-9]*)$'
    AND proof->'recoveryEpoch' = NEW.payload->'recoveryEpoch'
    AND proof->>'decisionId' ~ '^[a-f0-9-]{36}$' AND proof->>'manifestHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(proof->'committedAt') = 'string'
    AND proof->>'committedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
    AND jsonb_typeof(proof->'decisions') = 'array' AND jsonb_typeof(proof->'groups') = 'array'
    AND jsonb_typeof(proof->'bindings') = 'array', false) THEN
    RAISE EXCEPTION 'Plex quarantine receipt shape or operation changed';
  END IF;
  IF jsonb_array_length(proof->'decisions') NOT BETWEEN 1 AND 10000
    OR jsonb_array_length(proof->'groups') NOT BETWEEN 1 AND 100
    OR jsonb_array_length(proof->'bindings') NOT BETWEEN 1 AND 10000
    OR (proof->>'committedAt')::timestamptz > clock_timestamp() THEN
    RAISE EXCEPTION 'Plex quarantine receipt bounds or commit time changed';
  END IF;
  SELECT count(*),count(DISTINCT value->>'decisionId') INTO member_count,binding_count FROM jsonb_array_elements(proof->'decisions');
  IF member_count <> binding_count THEN RAISE EXCEPTION 'Duplicate Plex quarantine decision'; END IF;
  FOR decision IN SELECT value FROM jsonb_array_elements(proof->'decisions') LOOP
    IF jsonb_typeof(decision) IS DISTINCT FROM 'object' OR NOT COALESCE(
      decision ?& ARRAY['decisionId','mediaId','beforeVersion','quarantinedVersion','projectionHash']
      AND decision - ARRAY['decisionId','mediaId','beforeVersion','quarantinedVersion','projectionHash'] = '{}'::jsonb
      AND decision->>'projectionHash' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(decision->'beforeVersion') = 'number' AND decision->>'beforeVersion' ~ '^(0|[1-9][0-9]*)$'
      AND jsonb_typeof(decision->'quarantinedVersion') = 'number' AND decision->>'quarantinedVersion' ~ '^[1-9][0-9]*$',false) THEN
      RAISE EXCEPTION 'Plex quarantine decision shape changed';
    END IF;
    SELECT * INTO STRICT d FROM "RetentionDecision" WHERE id=decision->>'decisionId';
    SELECT * INTO STRICT p FROM "RetentionPlexProjection" WHERE "decisionId"=d.id;
    IF d.state <> 'quarantined' OR d.edition <> 'default' OR to_jsonb(d.version) IS DISTINCT FROM decision->'quarantinedVersion'
      OR (decision->>'quarantinedVersion')::bigint <> (decision->>'beforeVersion')::bigint + 1
      OR d."mediaId" IS DISTINCT FROM decision->>'mediaId' OR p."projectionHash" IS DISTINCT FROM decision->>'projectionHash'
      OR p.projection->'bindings' IS DISTINCT FROM proof->'bindings'
      OR d.evidence->'recoveryEpoch' IS DISTINCT FROM proof->'recoveryEpoch'
      OR d."quarantinedAt" IS NULL OR d."purgeAfter" IS NULL THEN
      RAISE EXCEPTION 'Plex quarantine decision is not the exact physical commit';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "RetentionDecision" WHERE id=d.id
      AND xmin::text=(txid_current() % 4294967296)::text) THEN
      RAISE EXCEPTION 'Plex quarantine decision must be committed in this transaction';
    END IF;
    IF first_manifest IS NULL THEN first_manifest := d.manifest;
    ELSIF first_manifest IS DISTINCT FROM d.manifest THEN RAISE EXCEPTION 'Plex quarantine manifests differ'; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(proof->'decisions') value
    WHERE value->>'decisionId'=proof->>'decisionId' AND value->>'mediaId'=NEW."targetId")
    OR jsonb_typeof(first_manifest->'assets') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Plex quarantine primary decision or manifest missing';
  END IF;
  SELECT count(*),count(DISTINCT value->>'assetId') INTO member_count,binding_count FROM jsonb_array_elements(proof->'groups');
  IF member_count <> binding_count OR member_count <> jsonb_array_length(first_manifest->'assets') THEN
    RAISE EXCEPTION 'Plex quarantine omitted complete manifest assets';
  END IF;
  FOR physical IN SELECT value FROM jsonb_array_elements(proof->'groups') LOOP
    IF jsonb_typeof(physical) IS DISTINCT FROM 'object' OR NOT COALESCE(
      physical ?& ARRAY['assetId','assetVersion','checksum','sizeBytes','canonicalPath','ownershipEpoch','canonicalRootId','edition','coverage','coverageHash']
      AND physical - ARRAY['assetId','assetVersion','checksum','sizeBytes','canonicalPath','ownershipEpoch','canonicalRootId','edition','coverage','coverageHash'] = '{}'::jsonb
      AND jsonb_typeof(physical->'assetVersion')='number' AND physical->>'assetVersion' ~ '^(0|[1-9][0-9]*)$'
      AND jsonb_typeof(physical->'ownershipEpoch')='number' AND physical->>'ownershipEpoch' ~ '^(0|[1-9][0-9]*)$'
      AND physical->>'checksum' ~ '^[a-f0-9]{64}$' AND physical->>'coverageHash' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(physical->'sizeBytes')='string' AND physical->>'sizeBytes' ~ '^[0-9]+$'
      AND jsonb_typeof(physical->'canonicalPath')='string' AND jsonb_typeof(physical->'coverage')='array',false) THEN
      RAISE EXCEPTION 'Plex quarantine physical group shape changed';
    END IF;
    SELECT count(*) INTO manifest_count FROM jsonb_array_elements(first_manifest->'assets') value WHERE value->>'assetId'=physical->>'assetId';
    IF manifest_count <> 1 THEN RAISE EXCEPTION 'Plex quarantine manifest asset is ambiguous'; END IF;
    SELECT value INTO STRICT entry FROM jsonb_array_elements(first_manifest->'assets') value WHERE value->>'assetId'=physical->>'assetId';
    SELECT * INTO STRICT a FROM "LibraryAsset" WHERE id=physical->>'assetId';
    IF NOT COALESCE(a.state='quarantined' AND a.owned AND a.edition='default'
      AND to_jsonb(a.version)=to_jsonb((entry->>'assetVersion')::integer + 1)
      AND entry->'assetVersion'=physical->'assetVersion'
      AND a.checksum=entry->>'checksum' AND a.checksum=physical->>'checksum'
      AND to_jsonb(a."ownershipEpoch")=proof->'recoveryEpoch'
      AND physical->'ownershipEpoch'=proof->'recoveryEpoch'
      AND a.path=physical->>'canonicalPath' AND a."editionRootId"=physical->>'canonicalRootId'
      AND entry->>'libraryKind' IN ('movies','tv')
      AND a.path=('/data/' || (entry->>'libraryKind') || '/' || (entry->>'libraryPath'))
      AND a."sizeBytes"::text=physical->>'sizeBytes' AND physical->>'edition'='default'
      AND jsonb_typeof(physical->'coverage')='array',false) THEN
      RAISE EXCEPTION 'Plex quarantine asset is not the exact physical commit';
    END IF;
    IF jsonb_array_length(physical->'coverage') NOT BETWEEN 1 AND 10000 OR
      NOT EXISTS (SELECT 1 FROM "LibraryAsset" WHERE id=a.id AND xmin::text=(txid_current() % 4294967296)::text) THEN
      RAISE EXCEPTION 'Plex quarantine asset must have complete coverage and update in this transaction';
    END IF;
    IF (SELECT jsonb_agg(jsonb_build_object('mediaId',"mediaId",'edition',edition) ORDER BY "mediaId",edition)
        FROM "AssetCoverage" WHERE "assetId"=a.id AND current) IS DISTINCT FROM physical->'coverage'
      OR (SELECT jsonb_agg(value->>'mediaId' ORDER BY value->>'mediaId') FROM jsonb_array_elements(physical->'coverage'))
         IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements(entry->'mediaIds')) THEN
      RAISE EXCEPTION 'Plex quarantine asset coverage is incomplete';
    END IF;
  END LOOP;
  IF (SELECT jsonb_agg(member ORDER BY member->>'mediaId',member->>'edition')
       FROM jsonb_array_elements(proof->'groups') AS group_rows(group_value),LATERAL jsonb_array_elements(group_rows.group_value->'coverage') member)
    IS DISTINCT FROM (SELECT jsonb_agg(value->'scope' ORDER BY value #>> '{scope,mediaId}',value #>> '{scope,edition}') FROM jsonb_array_elements(proof->'bindings'))
    OR (SELECT jsonb_agg(value->>'mediaId' ORDER BY value->>'mediaId') FROM jsonb_array_elements(proof->'decisions'))
       IS DISTINCT FROM (SELECT jsonb_agg(value #>> '{scope,mediaId}' ORDER BY value #>> '{scope,mediaId}') FROM jsonb_array_elements(proof->'bindings')) THEN
    RAISE EXCEPTION 'Plex quarantine receipt omitted group members';
  END IF;
  FOR prior IN SELECT value FROM jsonb_array_elements(proof->'bindings') LOOP
    IF jsonb_typeof(prior) IS DISTINCT FROM 'object' OR NOT COALESCE(
      prior ?& ARRAY['scope','evidenceId','associationHash','revision']
      AND prior - ARRAY['scope','evidenceId','associationHash','revision']='{}'::jsonb
      AND jsonb_typeof(prior->'scope')='object' AND prior->'scope' ?& ARRAY['mediaId','edition']
      AND (prior->'scope') - ARRAY['mediaId','edition']='{}'::jsonb
      AND prior #>> '{scope,edition}'='default' AND prior->>'associationHash' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(prior->'revision')='number' AND prior->>'revision' ~ '^[1-9][0-9]*$',false) THEN
      RAISE EXCEPTION 'Plex quarantine binding shape changed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "PlexAssociationEvidence" e
      WHERE e.id=prior->>'evidenceId' AND e."associationHash"=prior->>'associationHash'
        AND e."mediaId"=prior #>> '{scope,mediaId}' AND e.edition=prior #>> '{scope,edition}'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(proof->'groups') g WHERE e.evidence->'group'=g)) THEN
      RAISE EXCEPTION 'Plex quarantine historical association changed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "PlexBindingCurrent" c WHERE c."mediaId"=prior #>> '{scope,mediaId}'
      AND c.edition=prior #>> '{scope,edition}' AND c."evidenceId"=prior->>'evidenceId'
      AND c."associationHash"=prior->>'associationHash' AND to_jsonb(c.revision)=prior->'revision') THEN
      RAISE EXCEPTION 'Plex quarantine association is no longer the captured current pointer';
    END IF;
  END LOOP;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER plex_quarantine_receipt BEFORE INSERT OR UPDATE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_plex_quarantine_receipt();

-- Exact ordinary publication ACK, never inferred from availability or a current pointer.
-- JSON snapshot hashes use the application's existing canonical serializer; SQL enforces
-- relational closure, same-transaction pointer writes, deadlines and one-way immutability.
CREATE FUNCTION media_plex_acquisition_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE envelope JSONB; proof JSONB; expected JSONB; completion JSONB; parent JSONB;
  binding JSONB; physical JSONB; entry JSONB; target JSONB;
  attempt "AcquisitionAttempt"; asset "LibraryAsset"; evidence "PlexAssociationEvidence";
  expected_scopes JSONB; actual_scopes JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'acquisitionPlexReceipt' THEN
      RAISE EXCEPTION 'Committed acquisition Plex receipt is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'acquisitionPlexReceipt' THEN
    IF NEW.result->'acquisitionPlexReceipt' IS DISTINCT FROM OLD.result->'acquisitionPlexReceipt'
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW."targetId" IS DISTINCT FROM OLD."targetId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW.payload IS DISTINCT FROM OLD.payload THEN
      RAISE EXCEPTION 'Committed acquisition Plex receipt or command is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'acquisitionPlexReceipt') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope := NEW.result->'acquisitionPlexReceipt';
  proof := envelope->'receipt'; expected := proof->'expected'; completion := proof->'completion';
  IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR NOT COALESCE(
    envelope ?& ARRAY['receiptHash','receipt'] AND envelope - ARRAY['receiptHash','receipt']='{}'::jsonb
    AND envelope->>'receiptHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(proof)='object' AND proof ?& ARRAY['schemaVersion','input','command','attempt','expected','completion']
    AND proof - ARRAY['schemaVersion','input','command','attempt','expected','completion']='{}'::jsonb
    AND proof->'schemaVersion'='1'::jsonb
    AND jsonb_typeof(proof->'input')='object' AND proof->'input' ?& ARRAY['operationId','attemptId']
    AND (proof->'input') - ARRAY['operationId','attemptId']='{}'::jsonb
    AND proof #>> '{input,operationId}'=NEW.id
    AND jsonb_typeof(proof->'command')='object' AND proof->'command' ?& ARRAY['kind','targetId','userId','payloadHash']
    AND (proof->'command') - ARRAY['kind','targetId','userId','payloadHash']='{}'::jsonb
    AND NEW.kind IN ('reconcile_media','acquire_release') AND proof #>> '{command,kind}'=NEW.kind
    AND proof #>> '{command,targetId}'=NEW."targetId"
    AND (proof #>> '{command,userId}') IS NOT DISTINCT FROM NEW."userId"
    AND proof #>> '{command,payloadHash}' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(expected)='object' AND expected ?& ARRAY['schemaVersion','recoveryEpoch','access','targets','previous','oldGroups','newGroups','parents']
    AND expected - ARRAY['schemaVersion','recoveryEpoch','access','targets','previous','oldGroups','newGroups','parents']='{}'::jsonb
    AND expected->'schemaVersion'='1'::jsonb
    AND jsonb_typeof(expected->'newGroups')='array' AND jsonb_typeof(expected->'targets')='array'
    AND jsonb_typeof(expected->'access')='array' AND jsonb_typeof(expected->'parents')='array'
    AND jsonb_typeof(completion)='object' AND completion ?& ARRAY['schemaVersion','operationId','recoveryEpoch','expectedHash','inputHash','verification','bindings','bindingCount','committedAt']
    AND completion - ARRAY['schemaVersion','operationId','recoveryEpoch','expectedHash','inputHash','verification','bindings','bindingCount','committedAt']='{}'::jsonb
    AND completion->'schemaVersion'='1'::jsonb AND completion->>'operationId'=NEW.id
    AND completion->>'expectedHash' ~ '^[a-f0-9]{64}$' AND completion->>'inputHash' ~ '^[a-f0-9]{64}$'
    AND completion->'recoveryEpoch'=expected->'recoveryEpoch'
    AND jsonb_typeof(completion->'bindings')='array'
    AND jsonb_typeof(completion->'committedAt')='string'
    AND completion->>'committedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$',false) THEN
    RAISE EXCEPTION 'Acquisition Plex receipt shape or command changed';
  END IF;
  IF jsonb_array_length(expected->'newGroups') NOT BETWEEN 1 AND 100
    OR jsonb_array_length(expected->'targets') NOT BETWEEN 1 AND 10000
    OR jsonb_array_length(expected->'access') NOT BETWEEN 1 AND 2
    OR jsonb_array_length(completion->'bindings') NOT BETWEEN 1 AND 10000
    OR completion->'bindingCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(completion->'bindings'))
    OR NOT COALESCE((completion->>'committedAt')::timestamptz <= clock_timestamp()
      AND (completion->>'committedAt')::timestamptz >= (completion #>> '{verification,completedAt}')::timestamptz
      AND (completion->>'committedAt')::timestamptz < (completion #>> '{verification,expiresAt}')::timestamptz,false) THEN
    RAISE EXCEPTION 'Acquisition Plex receipt bounds or original verification deadline changed';
  END IF;
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=proof #>> '{input,attemptId}';
  IF NOT COALESCE(attempt.state IN ('imported','completed') AND attempt.edition='default'
    AND COALESCE(attempt."coordinatorOperationId",attempt."operationId")=NEW.id
    AND NEW."targetId"=ANY(attempt."mediaIds")
    AND proof #>> '{attempt,operationId}'=attempt."operationId"
    AND proof #>> '{attempt,coordinatorOperationId}'=NEW.id
    AND proof #>> '{attempt,releaseId}'=attempt."releaseId"
    AND proof #>> '{attempt,sponsorRequestId}'=attempt."sponsorRequestId"
    AND proof #>> '{attempt,torrentId}'=attempt."torrentId"
    AND proof #>> '{attempt,edition}'=attempt.edition
    AND proof #> '{attempt,mediaIds}'=to_jsonb(attempt."mediaIds")
    AND proof #> '{attempt,recoveryEpoch}'=to_jsonb(attempt."recoveryEpoch")
    AND expected->'recoveryEpoch'=to_jsonb(attempt."recoveryEpoch")
    AND jsonb_typeof(attempt."filePlan")='array',false) THEN
    RAISE EXCEPTION 'Acquisition Plex receipt attempt parent changed';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(expected->'parents') p WHERE p->>'kind'='acquisition') <> 1 THEN
    RAISE EXCEPTION 'Acquisition Plex receipt requires one exact acquisition parent';
  END IF;
  SELECT value INTO STRICT parent FROM jsonb_array_elements(expected->'parents') WHERE value->>'kind'='acquisition';
  IF NOT COALESCE(parent->>'attemptId'=attempt.id AND parent->>'operationId'=attempt."operationId"
    AND parent->'generations'=attempt.generations AND parent->'recoveryEpoch'=to_jsonb(attempt."recoveryEpoch")
    AND parent->>'planHash'=proof #>> '{attempt,filePlanHash}'
    AND parent->'identityHash'=proof #> '{attempt,identityHash}',false) THEN
    RAISE EXCEPTION 'Acquisition Plex receipt original grant changed';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(attempt."filePlan") LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(expected->'newGroups') g WHERE g->>'assetId'=entry->>'assetId') <> 1 THEN
      RAISE EXCEPTION 'Acquisition Plex receipt omitted FilePlan group';
    END IF;
    SELECT value INTO STRICT physical FROM jsonb_array_elements(expected->'newGroups') WHERE value->>'assetId'=entry->>'assetId';
    IF NOT COALESCE(physical->>'checksum'=entry->>'checksum' AND physical->>'sizeBytes'=entry->>'sizeBytes'
      AND physical->>'canonicalPath'=('/data/' || (entry->>'libraryKind') || '/' || (entry->>'libraryPath'))
      AND physical->'ownershipEpoch'=to_jsonb(attempt."recoveryEpoch"),false) THEN
      RAISE EXCEPTION 'Acquisition Plex receipt FilePlan bytes changed';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(expected->'newGroups') g
    WHERE jsonb_typeof(g->'coverage') IS DISTINCT FROM 'array' OR g->>'edition' IS DISTINCT FROM 'default') THEN
    RAISE EXCEPTION 'Acquisition Plex receipt group coverage missing';
  END IF;
  FOR physical IN SELECT value FROM jsonb_array_elements(expected->'newGroups') LOOP
    SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=physical->>'assetId';
    IF jsonb_array_length(physical->'coverage') NOT BETWEEN 1 AND 10000 OR NOT COALESCE(
      asset.state='published' AND asset.owned AND asset.edition='default'
      AND to_jsonb(asset.version)=physical->'assetVersion' AND asset.path=physical->>'canonicalPath'
      AND asset.checksum=physical->>'checksum' AND asset."sizeBytes"::text=physical->>'sizeBytes'
      AND to_jsonb(asset."ownershipEpoch")=physical->'ownershipEpoch'
      AND asset."editionRootId"=physical->>'canonicalRootId',false)
      OR (SELECT jsonb_agg(jsonb_build_object('mediaId',"mediaId",'edition',edition) ORDER BY "mediaId",edition)
        FROM "AssetCoverage" WHERE "assetId"=asset.id AND current) IS DISTINCT FROM physical->'coverage' THEN
      RAISE EXCEPTION 'Acquisition Plex receipt requires exact current physical groups';
    END IF;
  END LOOP;
  SELECT jsonb_agg(member ORDER BY member->>'mediaId',member->>'edition') INTO expected_scopes
    FROM jsonb_array_elements(expected->'newGroups') g,LATERAL jsonb_array_elements(g->'coverage') member;
  SELECT jsonb_agg(value->'scope' ORDER BY value #>> '{scope,mediaId}',value #>> '{scope,edition}') INTO actual_scopes
    FROM jsonb_array_elements(completion->'bindings');
  IF expected_scopes IS DISTINCT FROM actual_scopes THEN
    RAISE EXCEPTION 'Acquisition Plex receipt omitted complete binding coverage';
  END IF;
  FOR binding IN SELECT value FROM jsonb_array_elements(completion->'bindings') LOOP
    IF NOT EXISTS (SELECT 1 FROM "PlexBindingCurrent" c WHERE c."mediaId"=binding #>> '{scope,mediaId}'
      AND c.edition=binding #>> '{scope,edition}' AND c."evidenceId"=binding->>'evidenceId'
      AND c."associationHash"=binding->>'associationHash' AND to_jsonb(c.revision)=binding->'revision'
      AND c.xmin::text=(txid_current() % 4294967296)::text) THEN
      RAISE EXCEPTION 'Acquisition Plex receipt requires same-transaction complete binding commit';
    END IF;
    SELECT * INTO STRICT evidence FROM "PlexAssociationEvidence" WHERE id=binding->>'evidenceId';
    SELECT value INTO STRICT target FROM jsonb_array_elements(expected->'targets') WHERE value->'scope'=binding->'scope';
    IF NOT COALESCE(evidence."associationHash"=binding->>'associationHash'
      AND evidence.evidence->'scope'=binding->'scope'
      AND evidence.evidence->>'editionRootId'=target->>'editionRootId'
      AND evidence.evidence->>'canonicalIdentityHash'=target->>'canonicalIdentityHash'
      AND evidence.evidence->>'numberingHash'=target->>'numberingHash'
      AND evidence.evidence->'definition'=target->'definition'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(expected->'newGroups') g WHERE g=evidence.evidence->'group')
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(expected->'access') a WHERE a=evidence.evidence->'access'),false) THEN
      RAISE EXCEPTION 'Acquisition Plex receipt immutable association differs from expected authority';
    END IF;
  END LOOP;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER plex_acquisition_receipt BEFORE INSERT OR UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_plex_acquisition_receipt();

CREATE FUNCTION media_plex_acquisition_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE completion JSONB;
BEGIN
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'acquisitionPlexReceipt') THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'acquisitionPlexReceipt' THEN RETURN NULL; END IF;
  PERFORM media_plex_assert_deadline();
  completion := NEW.result #> '{acquisitionPlexReceipt,receipt,completion}';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(completion->'bindings') b
    LEFT JOIN "PlexBindingCurrent" c ON c."mediaId"=b #>> '{scope,mediaId}' AND c.edition=b #>> '{scope,edition}'
    WHERE c."evidenceId" IS DISTINCT FROM b->>'evidenceId'
      OR c."associationHash" IS DISTINCT FROM b->>'associationHash'
      OR to_jsonb(c.revision) IS DISTINCT FROM b->'revision'
      OR c.xmin::text IS DISTINCT FROM (txid_current() % 4294967296)::text) THEN
    RAISE EXCEPTION 'Acquisition Plex completion bindings changed before commit';
  END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER plex_acquisition_commit AFTER INSERT OR UPDATE ON "Operation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_plex_acquisition_commit();

-- Every bound transaction gets a COMMIT fence, including native transactions
-- that write no association/claim rows. This transient work is never authority.
CREATE TABLE "PlexDeadlineValidation" (
  "transactionId" BIGINT NOT NULL,
  "deadlineMs" BIGINT NOT NULL,
  CONSTRAINT "plex_deadline_validation_pk" PRIMARY KEY ("transactionId"),
  CONSTRAINT "plex_deadline_validation_bound" CHECK ("deadlineMs" BETWEEN 0 AND 9007199254740991)
);

CREATE FUNCTION media_plex_deadline_shrink() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."transactionId" <> txid_current()
    OR NEW."transactionId" <> OLD."transactionId"
    OR NEW."deadlineMs" > OLD."deadlineMs" THEN
    RAISE EXCEPTION 'Plex transaction deadline may only shrink in its original transaction';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER plex_deadline_shrink BEFORE UPDATE ON "PlexDeadlineValidation"
  FOR EACH ROW EXECUTE FUNCTION media_plex_deadline_shrink();

CREATE FUNCTION media_plex_validate_transaction_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."transactionId" <> txid_current() THEN
    RAISE EXCEPTION 'Plex transaction deadline belongs to another transaction';
  END IF;
  PERFORM media_plex_assert_deadline();
  IF current_setting('media.plex_deadline_ms',true)::numeric > NEW."deadlineMs" THEN
    RAISE EXCEPTION 'Plex transaction deadline was extended after capture';
  END IF;
  -- Validate the queued event even if its work row was deleted or replaced.
  -- Every queued INSERT/UPDATE retains its own original bound.
  DELETE FROM "PlexDeadlineValidation" WHERE "transactionId"=NEW."transactionId";
  PERFORM media_plex_assert_deadline();
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER plex_validate_transaction_deadline
  AFTER INSERT OR UPDATE ON "PlexDeadlineValidation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION media_plex_validate_transaction_deadline();
