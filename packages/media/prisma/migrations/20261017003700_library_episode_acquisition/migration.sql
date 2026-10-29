-- Actual adopted episodes may sponsor a new transfer through household policy.
-- No request, historical acquisition or existing torrent is created or rewritten.
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
      AND "identityEvidence"#>>'{management,schemaVersion}'='1'
      AND edition='default' AND "movieEditionChoiceId" IS NULL
      AND "movieEditionChoiceRevision" IS NULL AND "movieEditionAuthority" IS NULL), false)
);

CREATE FUNCTION media_library_episode_acquisition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; approval "MediaHandoffReceipt"; association "PlexAssociationEvidence";
  series "MediaItem"; root_target "MediaIntent"; selected JSONB; captured JSONB; leaf "MediaItem"; target "MediaIntent"; previous_id TEXT := '';
BEGIN
  proof := NEW."identityEvidence"->'management';
  SELECT * INTO STRICT approval FROM "MediaHandoffReceipt" WHERE id=proof->>'receiptId';
  SELECT * INTO STRICT series FROM "MediaItem" WHERE id=proof->>'seriesId';
  SELECT * INTO root_target FROM "MediaIntent" WHERE "mediaId"=series.id AND edition='default';
  SELECT * INTO STRICT association FROM "PlexAssociationEvidence" WHERE id=proof#>>'{association,evidenceId}';
  IF NOT COALESCE(NEW."sponsorRequestId" IS NULL AND NEW.edition='default'
    AND NEW."movieEditionChoiceId" IS NULL AND NEW."movieEditionChoiceRevision" IS NULL AND NEW."movieEditionAuthority" IS NULL
    AND proof->>'schemaVersion'='1' AND proof->>'kind'='library_series_management'
    AND series.kind='series' AND series."catalogState"='ready'
    AND NEW."identityEvidence"#>>'{canonical,kind}'='series' AND NEW."identityEvidence"#>>'{canonical,coordinates,seriesId}'=series.id
    AND proof->'birthEpoch'=to_jsonb(NEW."recoveryEpoch") AND NEW."identityEvidence"->'birthEpoch'=to_jsonb(NEW."recoveryEpoch")
    AND approval."recoveryEpoch"=NEW."recoveryEpoch" AND approval."planId"=proof->>'planId' AND approval."planHash"=proof->>'planHash' AND approval."actorId"=proof->>'actorId'
    AND EXISTS (SELECT 1 FROM "MediaHandoffPlan" p WHERE p.id=approval."planId" AND p.state='applied' AND p."planHash"=approval."planHash")
    AND EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=approval."actorId" AND u.role='owner' AND NOT u.restricted)
    AND EXISTS (SELECT 1 FROM "QualityProfile" p WHERE p.id=proof->>'profileId' AND to_jsonb(p.version)=proof->'profileVersionAtCapture')
    AND NEW.failure->>'profileId'=proof->>'profileId' AND NEW.failure->'profileVersion'=proof->'profileVersionAtCapture'
    AND cardinality(NEW."mediaIds") BETWEEN 1 AND 100
    AND NEW."identityEvidence"->'coverage'=to_jsonb(NEW."mediaIds")
    AND jsonb_array_length(proof->'targets')=cardinality(NEW."mediaIds")
    AND proof->'rootGenerationAtCapture'=COALESCE(to_jsonb(root_target.generation),'null'::jsonb)
    AND (root_target."mediaId" IS NULL OR root_target.generation=0 OR (root_target."desiredPresence" AND root_target.monitoring AND root_target."intentionallyRemovedAt" IS NULL AND root_target."automationEpoch"=NEW."recoveryEpoch"))
    AND proof->>'selectionHash' ~ '^[a-f0-9]{64}$'
    AND association."associationHash"=proof#>>'{association,associationHash}' AND association."serverMachineId"=proof->>'serverMachineId'
    AND association.evidence->>'kind'='episode' AND association.evidence->>'editionRootId'=series.id
    AND association.evidence#>>'{access,sectionId}'=proof->>'sectionId'
    AND association.evidence#>'{hierarchy,show,guids}' @> jsonb_build_array('tmdb://' || series."tmdbId"::text)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(approval.selection#>'{scope,files}') f WHERE f->>'libraryKind'='tv' AND f->>'assetId'=association."assetId" AND f->'mediaIds' @> to_jsonb(association."mediaId"))
    AND NEW."identityEvidence"#>>'{source,releaseId}'=NEW."releaseId"
    AND EXISTS (SELECT 1 FROM "ReleaseCandidate" r WHERE r.id=NEW."releaseId" AND r."sourceEvidence" IS NOT NULL AND r."encryptedSource" IS NOT NULL), false)
  THEN RAISE EXCEPTION 'Managed episode acquisition requires actual current library approval'; END IF;
  FOR captured IN SELECT value FROM jsonb_array_elements(proof->'targets') LOOP
    IF captured->>'mediaId' <= previous_id THEN RAISE EXCEPTION 'Managed episode coverage must be distinct and sorted'; END IF;
    previous_id := captured->>'mediaId';
    SELECT * INTO STRICT leaf FROM "MediaItem" WHERE id=previous_id;
    SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=leaf.id AND edition='default';
    SELECT item INTO STRICT selected FROM jsonb_array_elements(approval.selection#>'{scope,media}') item WHERE item->>'mediaId'=leaf.id;
    IF NOT COALESCE(leaf.id=ANY(NEW."mediaIds") AND leaf.kind='episode' AND leaf."catalogState"='ready'
      AND (leaf."parentId"=series.id OR EXISTS (SELECT 1 FROM "MediaItem" season WHERE season.id=leaf."parentId" AND season.kind='season' AND season."parentId"=series.id))
      AND selected->'monitored'='true'::jsonb AND selected->>'profileId'=proof->>'profileId'
      AND target."profileId"=proof->>'profileId' AND target."desiredPresence" AND target.monitoring AND target."intentionallyRemovedAt" IS NULL
      AND target."editionRootId"=series.id AND target."automationEpoch"=NEW."recoveryEpoch"
      AND to_jsonb(target.generation)=captured->'generation' AND NEW.generations->leaf.id=captured->'generation'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."identityEvidence"#>'{canonical,coordinates,episodes}') e WHERE e->>'mediaId'=leaf.id),false)
    THEN RAISE EXCEPTION 'Managed episode acquisition lost approved coverage or current policy'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_episode_acquisition BEFORE INSERT ON "AcquisitionAttempt" FOR EACH ROW
  WHEN (NEW."identityEvidence"->>'schemaVersion'='4') EXECUTE FUNCTION media_library_episode_acquisition();

-- Additive household completion: preserve v1 guards and its literal marker.
CREATE FUNCTION media_managed_episode_plex_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE envelope JSONB; proof JSONB; expected JSONB; completion JSONB; parent JSONB;
  binding JSONB; physical JSONB; entry JSONB; target JSONB;
  attempt "AcquisitionAttempt"; asset "LibraryAsset"; evidence "PlexAssociationEvidence";
  expected_scopes JSONB; actual_scopes JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'managedEpisodePlexReceiptV2' THEN
      RAISE EXCEPTION 'Committed acquisition Plex receipt is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF COALESCE(NEW.result,'{}'::jsonb) ?& ARRAY['acquisitionPlexReceipt','managedEpisodePlexReceiptV2'] THEN
    RAISE EXCEPTION 'Acquisition Plex receipt has conflicting families';
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'managedEpisodePlexReceiptV2' THEN
    IF NEW.result->'managedEpisodePlexReceiptV2' IS DISTINCT FROM OLD.result->'managedEpisodePlexReceiptV2'
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW."targetId" IS DISTINCT FROM OLD."targetId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW.payload IS DISTINCT FROM OLD.payload THEN
      RAISE EXCEPTION 'Committed acquisition Plex receipt or command is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'managedEpisodePlexReceiptV2') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope := NEW.result->'managedEpisodePlexReceiptV2';
  proof := envelope->'receipt'; expected := proof->'expected'; completion := proof->'completion';
  IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR NOT COALESCE(
    envelope ?& ARRAY['receiptHash','receipt'] AND envelope - ARRAY['receiptHash','receipt']='{}'::jsonb
    AND envelope->>'receiptHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(proof)='object' AND proof ?& ARRAY['schemaVersion','input','command','attempt','expected','completion']
    AND proof - ARRAY['schemaVersion','input','command','attempt','expected','completion']='{}'::jsonb
    AND proof->'schemaVersion'='2'::jsonb
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
    AND proof #> '{attempt,sponsorRequestId}'='null'::jsonb AND attempt."sponsorRequestId" IS NULL
    AND attempt."identityEvidence"->>'schemaVersion'='4'
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
CREATE TRIGGER managed_episode_plex_receipt BEFORE INSERT OR UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_managed_episode_plex_receipt();

CREATE FUNCTION media_managed_episode_plex_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE completion JSONB;
BEGIN
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'managedEpisodePlexReceiptV2') THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'managedEpisodePlexReceiptV2' THEN RETURN NULL; END IF;
  PERFORM media_plex_assert_deadline();
  completion := NEW.result #> '{managedEpisodePlexReceiptV2,receipt,completion}';
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
CREATE CONSTRAINT TRIGGER managed_episode_plex_commit AFTER INSERT OR UPDATE ON "Operation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_managed_episode_plex_commit();
