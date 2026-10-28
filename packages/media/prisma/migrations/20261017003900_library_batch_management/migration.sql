-- Combine actual existing-episode approvals without creating a series/future grant.
-- Original v1/v2 functions, births and completion formats remain unchanged.
ALTER TABLE "AcquisitionAttempt" DROP CONSTRAINT managed_attempt_sponsor;
ALTER TABLE "AcquisitionAttempt" ADD CONSTRAINT managed_attempt_sponsor CHECK (
  "sponsorRequestId" IS NOT NULL OR COALESCE(
    ("identityEvidence"->>'schemaVersion'='3'
      AND "identityEvidence"->'management'="movieEditionAuthority"
      AND "movieEditionAuthority"->>'kind'='library_management'
      AND "movieEditionAuthority"->>'schemaVersion'='2'
      AND "movieEditionChoiceId" IS NULL AND "movieEditionChoiceRevision" IS NULL)
    OR ("identityEvidence"->>'schemaVersion'='4'
      AND "identityEvidence"#>>'{management,kind}'='library_series_management'
      AND ("identityEvidence"#>>'{management,schemaVersion}'='1'
        OR ("identityEvidence"#>>'{management,schemaVersion}'='2' AND "identityEvidence"#>>'{management,policyScope}'='series')
        OR ("identityEvidence"#>>'{management,schemaVersion}'='3' AND "identityEvidence"#>>'{management,policyScope}'='episodes'))
      AND edition='default' AND "movieEditionChoiceId" IS NULL
      AND "movieEditionChoiceRevision" IS NULL AND "movieEditionAuthority" IS NULL), false)
);

-- The same original episode-policy checks apply independently to each actual
-- source. candidate is a validation view of NEW, never another persisted attempt.
CREATE FUNCTION media_library_batch_leaf_policy(candidate "AcquisitionAttempt") RETURNS void LANGUAGE plpgsql AS $$
DECLARE proof JSONB; approval "MediaHandoffReceipt"; association "PlexAssociationEvidence";
  series "MediaItem"; root_target "MediaIntent"; selected JSONB; captured JSONB;
  leaf "MediaItem"; target "MediaIntent"; previous_id TEXT := '';
BEGIN
  PERFORM media_plex_assert_deadline();
  proof := candidate."identityEvidence"->'management';
  SELECT * INTO STRICT approval FROM "MediaHandoffReceipt" WHERE id=proof->>'receiptId';
  SELECT * INTO STRICT series FROM "MediaItem" WHERE id=proof->>'seriesId';
  SELECT * INTO root_target FROM "MediaIntent" WHERE "mediaId"=series.id AND edition='default';
  SELECT * INTO STRICT association FROM "PlexAssociationEvidence" WHERE id=proof#>>'{association,evidenceId}';
  IF NOT COALESCE(candidate."sponsorRequestId" IS NULL AND candidate.edition='default'
    AND candidate."movieEditionChoiceId" IS NULL AND candidate."movieEditionChoiceRevision" IS NULL AND candidate."movieEditionAuthority" IS NULL
    AND proof->>'schemaVersion'='1' AND proof->>'kind'='library_series_management'
    AND series.kind='series' AND series."catalogState"='ready'
    AND candidate."identityEvidence"#>>'{canonical,kind}'='series' AND candidate."identityEvidence"#>>'{canonical,coordinates,seriesId}'=series.id
    AND proof->'birthEpoch'=to_jsonb(candidate."recoveryEpoch") AND candidate."identityEvidence"->'birthEpoch'=to_jsonb(candidate."recoveryEpoch")
    AND approval."recoveryEpoch"=candidate."recoveryEpoch" AND approval."planId"=proof->>'planId' AND approval."planHash"=proof->>'planHash' AND approval."actorId"=proof->>'actorId'
    AND EXISTS (SELECT 1 FROM "MediaHandoffPlan" p WHERE p.id=approval."planId" AND p.state='applied' AND p."planHash"=approval."planHash")
    AND EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=approval."actorId" AND u.role='owner' AND NOT u.restricted)
    AND EXISTS (SELECT 1 FROM "QualityProfile" p WHERE p.id=proof->>'profileId' AND to_jsonb(p.version)=proof->'profileVersionAtCapture')
    AND candidate.failure->>'profileId'=proof->>'profileId' AND candidate.failure->'profileVersion'=proof->'profileVersionAtCapture'
    AND cardinality(candidate."mediaIds") BETWEEN 1 AND 100
    AND candidate."identityEvidence"->'coverage'=to_jsonb(candidate."mediaIds")
    AND jsonb_array_length(proof->'targets')=cardinality(candidate."mediaIds")
    AND proof->'rootGenerationAtCapture'=COALESCE(to_jsonb(root_target.generation),'null'::jsonb)
    AND (root_target."mediaId" IS NULL OR root_target.generation=0 OR (root_target."desiredPresence" AND root_target.monitoring AND root_target."intentionallyRemovedAt" IS NULL AND root_target."automationEpoch"=candidate."recoveryEpoch"))
    AND proof->>'selectionHash' ~ '^[a-f0-9]{64}$'
    AND association."associationHash"=proof#>>'{association,associationHash}' AND association."serverMachineId"=proof->>'serverMachineId'
    AND association.evidence->>'kind'='episode' AND association.evidence->>'editionRootId'=series.id
    AND association.evidence#>>'{access,sectionId}'=proof->>'sectionId'
    AND association.evidence#>'{hierarchy,show,guids}' @> jsonb_build_array('tmdb://' || series."tmdbId"::text)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(approval.selection#>'{scope,files}') f WHERE f->>'libraryKind'='tv' AND f->>'assetId'=association."assetId" AND f->'mediaIds' @> to_jsonb(association."mediaId"))
    AND candidate."identityEvidence"#>>'{source,releaseId}'=candidate."releaseId"
    AND EXISTS (SELECT 1 FROM "ReleaseCandidate" r WHERE r.id=candidate."releaseId" AND r."sourceEvidence" IS NOT NULL AND r."encryptedSource" IS NOT NULL), false)
  THEN RAISE EXCEPTION 'Managed batch requires actual current episode approval'; END IF;
  FOR captured IN SELECT value FROM jsonb_array_elements(proof->'targets') LOOP
    IF captured->>'mediaId' <= previous_id THEN RAISE EXCEPTION 'Managed episode coverage must be distinct and sorted'; END IF;
    previous_id := captured->>'mediaId';
    SELECT * INTO STRICT leaf FROM "MediaItem" WHERE id=previous_id;
    SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=leaf.id AND edition='default';
    SELECT item INTO STRICT selected FROM jsonb_array_elements(approval.selection#>'{scope,media}') item WHERE item->>'mediaId'=leaf.id;
    IF NOT COALESCE(leaf.id=ANY(candidate."mediaIds") AND leaf.kind='episode' AND leaf."catalogState"='ready'
      AND (leaf."parentId"=series.id OR EXISTS (SELECT 1 FROM "MediaItem" season WHERE season.id=leaf."parentId" AND season.kind='season' AND season."parentId"=series.id))
      AND selected->'monitored'='true'::jsonb AND selected->>'profileId'=proof->>'profileId'
      AND target."profileId"=proof->>'profileId' AND target."desiredPresence" AND target.monitoring AND target."intentionallyRemovedAt" IS NULL
      AND target."editionRootId"=series.id AND target."automationEpoch"=candidate."recoveryEpoch"
      AND to_jsonb(target.generation)=captured->'generation' AND candidate.generations->leaf.id=captured->'generation'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(candidate."identityEvidence"#>'{canonical,coordinates,episodes}') e WHERE e->>'mediaId'=leaf.id),false)
    THEN RAISE EXCEPTION 'Managed batch lost approved coverage or current policy'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_library_batch_acquisition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; policy JSONB; captured JSONB; candidate "AcquisitionAttempt";
  previous_receipt TEXT := ''; covered TEXT[] := ARRAY[]::TEXT[]; ids TEXT[];
BEGIN
  PERFORM media_plex_assert_deadline();
  proof := NEW."identityEvidence"->'management';
  IF NOT COALESCE(proof->>'schemaVersion'='3' AND proof->>'kind'='library_series_management'
    AND proof->>'policyScope'='episodes' AND jsonb_typeof(proof->'approvals')='array'
    AND jsonb_array_length(proof->'approvals') BETWEEN 2 AND 25
    AND cardinality(NEW."mediaIds") BETWEEN 1 AND 100
    AND NEW."identityEvidence"->'coverage'=to_jsonb(NEW."mediaIds")
    AND jsonb_array_length(proof->'targets')=cardinality(NEW."mediaIds"),false)
  THEN RAISE EXCEPTION 'Managed batch requires bounded original approvals and complete coverage'; END IF;
  FOR policy IN SELECT value FROM jsonb_array_elements(proof->'approvals') LOOP
    IF NOT COALESCE(policy->>'receiptId'>previous_receipt
      AND policy->>'seriesId'=proof->>'seriesId' AND policy->>'profileId'=proof->>'profileId'
      AND policy->'profileVersionAtCapture'=proof->'profileVersionAtCapture'
      AND policy->>'serverMachineId'=proof->>'serverMachineId' AND policy->>'sectionId'=proof->>'sectionId'
      AND policy->'birthEpoch'=proof->'birthEpoch',false)
    THEN RAISE EXCEPTION 'Managed batch original approvals disagree'; END IF;
    previous_receipt := policy->>'receiptId';
    SELECT array_agg(t->>'mediaId' ORDER BY t->>'mediaId') INTO ids FROM jsonb_array_elements(policy->'targets') t;
    IF ids IS NULL OR cardinality(ids)=0 OR covered && ids OR NOT ids <@ NEW."mediaIds"
    THEN RAISE EXCEPTION 'Managed batch approvals overlap or escape actual coverage'; END IF;
    FOR captured IN SELECT value FROM jsonb_array_elements(policy->'targets') LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(proof->'targets') t WHERE t=captured)
      THEN RAISE EXCEPTION 'Managed batch target generations differ'; END IF;
    END LOOP;
    candidate := NEW;
    candidate."mediaIds" := ids;
    candidate."identityEvidence" := jsonb_set(jsonb_set(NEW."identityEvidence",'{management}',policy),'{coverage}',to_jsonb(ids));
    PERFORM media_library_batch_leaf_policy(candidate);
    covered := covered || ids;
  END LOOP;
  IF cardinality(covered)<>cardinality(NEW."mediaIds") OR NOT covered @> NEW."mediaIds"
    OR proof->'targets' <> (SELECT jsonb_agg(t ORDER BY t->>'mediaId') FROM jsonb_array_elements(proof->'targets') t)
  THEN RAISE EXCEPTION 'Managed batch needs exact sorted complete original coverage'; END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_batch_acquisition BEFORE INSERT ON "AcquisitionAttempt" FOR EACH ROW
  WHEN (NEW."identityEvidence"->>'schemaVersion'='4' AND NEW."identityEvidence"#>>'{management,schemaVersion}'='3')
  EXECUTE FUNCTION media_library_batch_acquisition();

CREATE FUNCTION media_library_batch_birth_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."releaseId" IS DISTINCT FROM OLD."releaseId"
    OR NEW."operationId" IS DISTINCT FROM OLD."operationId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."sponsorRequestId" IS DISTINCT FROM OLD."sponsorRequestId"
    OR NEW."mediaIds" IS DISTINCT FROM OLD."mediaIds"
    OR NEW.generations IS DISTINCT FROM OLD.generations
    OR NEW."recoveryEpoch" IS DISTINCT FROM OLD."recoveryEpoch"
    OR NEW."identityEvidence" IS DISTINCT FROM OLD."identityEvidence"
    OR NEW.edition IS DISTINCT FROM OLD.edition
    OR NEW."movieEditionChoiceId" IS DISTINCT FROM OLD."movieEditionChoiceId"
    OR NEW."movieEditionChoiceRevision" IS DISTINCT FROM OLD."movieEditionChoiceRevision"
    OR NEW."movieEditionAuthority" IS DISTINCT FROM OLD."movieEditionAuthority"
  THEN RAISE EXCEPTION 'Managed batch acquisition birth is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_batch_birth_immutable BEFORE UPDATE ON "AcquisitionAttempt" FOR EACH ROW
  WHEN (OLD."identityEvidence"->>'schemaVersion'='4' AND OLD."identityEvidence"#>>'{management,schemaVersion}'='3')
  EXECUTE FUNCTION media_library_batch_birth_immutable();
