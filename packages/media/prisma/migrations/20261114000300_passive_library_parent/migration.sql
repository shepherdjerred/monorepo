-- Keep original version-zero births literal. Only an explicit registration
-- lineage can create a version-one initial owner; no historical row is rewritten.
CREATE FUNCTION media_library_initial_owner_version(p_scope JSONB,p_asset_id TEXT,p_version INTEGER,p_network JSONB)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE selected JSONB; approvals JSONB; approval JSONB; event "ApplicationEvent";
  registration JSONB; asset "LibraryAsset"; source_ids TEXT[]; registered_ids TEXT[]; current_ids TEXT[];
BEGIN
  IF (SELECT count(*) FROM jsonb_array_elements(p_scope->'files') f WHERE f->>'assetId'=p_asset_id)<>1 THEN RETURN false; END IF;
  SELECT f INTO STRICT selected FROM jsonb_array_elements(p_scope->'files') f WHERE f->>'assetId'=p_asset_id;
  approvals := COALESCE(p_scope #> '{request,registeredAssets}','[]'::jsonb);
  IF jsonb_array_length(approvals)>25
    OR (SELECT count(DISTINCT a->>'assetId') FROM jsonb_array_elements(approvals) a)<>jsonb_array_length(approvals)
    OR (SELECT count(DISTINCT a->>'provenanceKey') FROM jsonb_array_elements(approvals) a)<>jsonb_array_length(approvals)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(approvals) a WHERE NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(p_scope->'files') f WHERE f->>'assetId'=a->>'assetId' AND f->>'provenanceKey'=a->>'provenanceKey'))
  THEN RETURN false; END IF;
  IF p_version=0 THEN
    RETURN selected->'existingAssetId'='null'::jsonb
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(approvals) a WHERE a->>'assetId'=p_asset_id);
  END IF;
  IF p_version IS DISTINCT FROM 1 OR p_scope->'schemaVersion' IS DISTINCT FROM '3'::jsonb OR p_scope #> '{request,schemaVersion}' IS DISTINCT FROM '3'::jsonb
    OR (SELECT count(*) FROM jsonb_array_elements(approvals) a WHERE a->>'assetId'=p_asset_id AND a->>'provenanceKey'=selected->>'provenanceKey')<>1
  THEN RETURN false; END IF;
  SELECT a INTO STRICT approval FROM jsonb_array_elements(approvals) a WHERE a->>'assetId'=p_asset_id;
  SELECT * INTO STRICT event FROM "ApplicationEvent" WHERE id=approval->>'registrationEventId';
  SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=p_asset_id;
  registration := event.payload->'registration';
  SELECT array_agg(value ORDER BY value) INTO source_ids FROM jsonb_array_elements_text(selected->'mediaIds') ids(value);
  SELECT array_agg(m->>'mediaId' ORDER BY m->>'mediaId') INTO registered_ids FROM jsonb_array_elements(registration->'members') m;
  SELECT array_agg("mediaId" ORDER BY "mediaId") INTO current_ids FROM "AssetCoverage" WHERE "assetId"=p_asset_id AND current;
  RETURN COALESCE(
    approval->'expectedVersion'='0'::jsonb AND selected->'existingAssetVersion'='0'::jsonb
    AND selected->>'existingAssetId'=p_asset_id
    AND approval->>'registrationHash' ~ '^[a-f0-9]{64}$'
    AND event.kind='external_library_registered'
    AND event.payload->>'registrationHash'=approval->>'registrationHash'
    AND (approval->>'registrationRaw')::jsonb=registration
    AND encode(sha256(convert_to(approval->>'registrationRaw','UTF8')),'hex')=approval->>'registrationHash'
    AND registration->>'registrationEventId'=event.id AND event."mediaId"=registration->>'rootMediaId'
    AND registration->'schemaVersion'='1'::jsonb AND registration->>'source'='plex' AND registration->>'edition'='default'
    AND registration->>'rootMediaId'=asset."editionRootId"
    AND registration->>'serverMachineId'=p_network->>'registeredPlexServerMachineId'
    AND registration->>'canonicalPath'=selected->>'canonicalPath' AND asset.path=selected->>'canonicalPath'
    AND registration->>'sizeBytes'=selected->>'sizeBytes' AND asset."sizeBytes"::text=selected->>'sizeBytes'
    AND registration->>'sectionType'=CASE selected->>'libraryKind' WHEN 'movies' THEN 'movie' WHEN 'tv' THEN 'show' ELSE NULL END
    AND source_ids=registered_ids AND source_ids=current_ids
    AND NOT EXISTS (SELECT 1 FROM "AssetCoverage" c WHERE c."assetId"=p_asset_id AND (NOT c.current OR c.edition<>asset.edition))
    AND asset.version=1 AND asset.owned AND asset.state='published' AND asset."torrentId" IS NULL
    AND asset."sourcePath"=selected->>'sourcePath' AND asset.checksum ~ '^[a-f0-9]{64}$'
    AND asset."ownershipEpoch"=(p_scope #>> '{request,recoveryEpoch}')::integer,false);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN false;
END;
$$;

-- Personal migration source accounting is append-only evidence, not an editable
-- alias for a native recovery release receipt.
CREATE FUNCTION media_personal_import_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'personal_state_imported'
    OR (TG_OP = 'UPDATE' AND NEW.kind = 'personal_state_imported') THEN
    RAISE EXCEPTION 'Personal migration source receipts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_personal_import_immutable BEFORE UPDATE OR DELETE ON "ApplicationEvent"
  FOR EACH ROW EXECUTE FUNCTION media_personal_import_immutable();

-- Retain the literal v2 parent contract; v3 proves its actual metadata checkpoints separately.
CREATE OR REPLACE FUNCTION media_movie_subtitle_library_parent_v3(proof JSONB, asset "LibraryAsset", scope JSONB) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE receipt "MediaHandoffReceipt"; plan "MediaHandoffPlan"; baseline JSONB; change JSONB; edit JSONB;
  before_network JSONB; after_network JSONB; expected_label TEXT;
BEGIN
  SELECT * INTO STRICT receipt FROM "MediaHandoffReceipt" WHERE id=proof->>'receiptId';
  IF receipt.selection->'schemaVersion'<>'3'::jsonb THEN
    RETURN false;
  END IF;
  SELECT * INTO STRICT plan FROM "MediaHandoffPlan" WHERE id=receipt."planId";
  IF (SELECT count(*) FROM jsonb_array_elements(receipt.selection->'assets') a WHERE a->>'id'=asset.id)<>1 THEN RETURN false; END IF;
  SELECT a INTO STRICT baseline FROM jsonb_array_elements(receipt.selection->'assets') a WHERE a->>'id'=asset.id;
  before_network := plan.plan->'network'; after_network := receipt.selection->'networkEvidence';
  IF NOT COALESCE(plan.state='applied' AND plan.id=proof->>'planId' AND plan."planHash"=receipt."planHash"
    AND proof->>'planHash'=receipt."planHash" AND plan.scope->'schemaVersion'='3'::jsonb
    AND plan.plan->'schemaVersion'='3'::jsonb AND receipt.selection->'scope'=plan.scope
    AND receipt.selection->'fileEvidence'=plan.plan->'files'
    AND before_network-'plex'=after_network-'plex'
    AND (SELECT jsonb_agg(p-'editionTitle' ORDER BY n) FROM jsonb_array_elements(before_network->'plex') WITH ORDINALITY a(p,n))
      =(SELECT jsonb_agg(p-'editionTitle' ORDER BY n) FROM jsonb_array_elements(after_network->'plex') WITH ORDINALITY a(p,n))
    AND receipt."previousRuntimeVersion"=plan."runtimeVersion" AND receipt."runtimeVersion"=receipt."previousRuntimeVersion"+1
    AND receipt."recoveryEpoch"=plan."recoveryEpoch" AND receipt."recoveryEpoch"=asset."ownershipEpoch"
    AND baseline->'schemaVersion'='2'::jsonb AND baseline->'scope'=scope AND baseline->'owned'='true'::jsonb
    AND baseline->'version'=to_jsonb(asset.version) AND media_library_initial_owner_version(plan.scope,asset.id,asset.version,plan.plan->'network')
    AND baseline->>'state'='published'
    AND baseline->>'path'=asset.path AND baseline->>'checksum'=asset.checksum AND baseline->>'edition'=asset.edition
    AND baseline->>'editionRootId'=asset."editionRootId" AND baseline->'ownershipEpoch'=to_jsonb(asset."ownershipEpoch")
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(receipt.selection #> '{scope,files}') f WHERE f->>'assetId'=asset.id
      AND f->>'libraryKind'='movies' AND f->>'edition'=asset.edition AND f->>'canonicalPath'=asset.path
      AND f->'classification'<>'null'::jsonb)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(receipt.selection #> '{fileEvidence,files}') f
      WHERE f->>'assetId'=asset.id AND f->>'canonicalPath'=asset.path AND f->>'checksum'=asset.checksum)
    AND jsonb_array_length(receipt.selection->'plexEdits')=jsonb_array_length(plan.plan->'plexEdits'),false)
  THEN RETURN false; END IF;
  FOR change IN SELECT c FROM jsonb_array_elements(plan.plan->'plexEdits') c LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(receipt.selection->'plexEdits') e WHERE e->'change'=change)<>1 THEN RETURN false; END IF;
    SELECT e INTO STRICT edit FROM jsonb_array_elements(receipt.selection->'plexEdits') e WHERE e->'change'=change;
    IF NOT EXISTS (SELECT 1 FROM "MediaHandoffObservation" c WHERE c.id=edit #>> '{completion,id}'
      AND c."planId"=plan.id AND c.kind='plex_edit_completion_v1' AND c."evidenceHash"=edit #>> '{completion,evidenceHash}'
      AND c.evidence=edit #> '{completion,evidence}') THEN RETURN false; END IF;
    IF edit->'intent'<>'null'::jsonb AND NOT EXISTS (SELECT 1 FROM "MediaHandoffObservation" i
      WHERE i.id=edit #>> '{intent,id}' AND i."planId"=plan.id AND i.kind='plex_edit_intent_v1'
        AND i."evidenceHash"=edit #>> '{intent,evidenceHash}' AND i.evidence=edit #> '{intent,evidence}') THEN RETURN false; END IF;
  END LOOP;
  expected_label := CASE asset.edition WHEN 'default' THEN '' WHEN 'theatrical_cut' THEN 'Theatrical Cut'
    WHEN 'directors_cut' THEN 'Director''s Cut' WHEN 'extended_cut' THEN 'Extended Cut' WHEN 'final_cut' THEN 'Final Cut'
    WHEN 'unrated_cut' THEN 'Unrated Cut' WHEN 'uncut_version' THEN 'Uncut Version' ELSE NULL END;
  RETURN COALESCE(expected_label IS NOT NULL AND (SELECT count(*)=1 FROM jsonb_array_elements(after_network->'plex') p
    WHERE p->>'assetId'=asset.id AND p->>'mediaId'=asset."editionRootId" AND p->>'edition'=asset.edition
      AND p->>'canonicalPath'=asset.path AND COALESCE(p->>'editionTitle','')=expected_label),false);
END;
$$;


-- Initial-library serving proof has its own command and receipt, without acquisition history.
CREATE OR REPLACE FUNCTION media_library_plex_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; envelope JSONB; source "MediaHandoffReceipt"; plan "MediaHandoffPlan";
  baseline JSONB; physical JSONB; coverage JSONB; binding JSONB; association JSONB;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'libraryPlexReceiptV1' THEN RAISE EXCEPTION 'Committed library Plex receipt is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'libraryPlexReceiptV1' THEN
    IF NEW.result->'libraryPlexReceiptV1' IS DISTINCT FROM OLD.result->'libraryPlexReceiptV1'
      OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload) IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
    THEN RAISE EXCEPTION 'Committed library Plex receipt or command is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'libraryPlexReceiptV1') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope := NEW.result->'libraryPlexReceiptV1'; proof := envelope->'receipt';
  SELECT * INTO STRICT source FROM "MediaHandoffReceipt" WHERE id=proof #>> '{input,receiptId}';
  SELECT * INTO STRICT plan FROM "MediaHandoffPlan" WHERE id=source."planId";
  SELECT value INTO STRICT baseline FROM jsonb_array_elements(source.selection->'assets') WHERE value->>'id'=NEW."targetId";
  physical := proof #> '{expected,newGroups,0}';
  SELECT jsonb_agg(jsonb_build_object('mediaId',value->>'mediaId','edition',value->>'edition') ORDER BY value->>'mediaId',value->>'edition')
    INTO coverage FROM jsonb_array_elements(baseline->'coverage');
  IF NOT COALESCE(envelope->>'receiptHash' ~ '^[a-f0-9]{64}$' AND proof->'schemaVersion'='1'::jsonb
    AND NEW.kind='verify_library_plex_binding' AND NEW.payload=proof->'input'
    AND proof #>> '{input,operationId}'=NEW.id AND proof #>> '{input,assetId}'=NEW."targetId"
    AND proof #> '{input,recoveryEpoch}'=to_jsonb(source."recoveryEpoch")
    AND plan.state='applied' AND plan."planHash"=source."planHash"
    AND NEW."userId"=source."actorId"
    AND source.selection->'schemaVersion' IN ('2'::jsonb,'3'::jsonb)
    AND proof #> '{expected,schemaVersion}'='2'::jsonb
    AND jsonb_array_length(proof #> '{expected,newGroups}')=1 AND jsonb_array_length(proof #> '{expected,parents}')=1
    AND proof #>> '{expected,parents,0,kind}'='library_adoption'
    AND proof #>> '{expected,parents,0,reference,kind}'='library_adoption_v1'
    AND proof #>> '{expected,parents,0,reference,receiptId}'=source.id
    AND proof #>> '{expected,parents,0,reference,planId}'=plan.id
    AND proof #>> '{expected,parents,0,reference,planHash}'=source."planHash"
    AND proof #>> '{expected,parents,0,reference,assetId}'=NEW."targetId"
    AND proof #> '{expected,parents,0,reference,assetVersion}'=baseline->'version'
    AND proof #> '{expected,recoveryEpoch}'=to_jsonb(source."recoveryEpoch")
    AND proof #> '{expected,parents,0,recoveryEpoch}'=to_jsonb(source."recoveryEpoch")
    AND physical->>'assetId'=baseline->>'id' AND physical->'assetVersion'=baseline->'version'
    AND media_library_initial_owner_version(plan.scope,NEW."targetId",(baseline->>'version')::integer,plan.plan->'network')
    AND physical->>'checksum'=baseline->>'checksum' AND physical->>'sizeBytes'=baseline->>'sizeBytes'
    AND physical->>'canonicalPath'=baseline->>'path' AND physical->'ownershipEpoch'=baseline->'ownershipEpoch'
    AND physical->>'canonicalRootId'=baseline->>'editionRootId' AND physical->>'edition'=baseline->>'edition'
    AND physical->'coverage'=coverage AND baseline->>'state'='published' AND baseline->'owned'='true'::jsonb
    AND proof #>> '{command,kind}'=NEW.kind AND proof #>> '{command,targetId}'=NEW."targetId"
    AND (proof #>> '{command,userId}') IS NOT DISTINCT FROM NEW."userId"
    AND jsonb_array_length(proof->'bindings')=jsonb_array_length(coverage)
    AND (SELECT count(DISTINCT value->'scope') FROM jsonb_array_elements(proof->'bindings'))=jsonb_array_length(coverage)
    AND jsonb_array_length(proof #> '{observation,associations}')=jsonb_array_length(coverage)
    AND (proof #>> '{sdk,observedAt}')::timestamptz <= (proof #>> '{observation,verification,startedAt}')::timestamptz
    AND (proof #>> '{observation,verification,expiresAt}')::timestamptz <= (proof #>> '{sdk,expiresAt}')::timestamptz
    AND (proof #>> '{observation,verification,expiresAt}')::timestamptz <= (proof->>'writerExpiresAt')::timestamptz
    AND (proof #>> '{observation,verification,expiresAt}')::timestamptz <= (proof #>> '{sdk,observedAt}')::timestamptz + interval '60 seconds'
    AND (proof->>'committedAt')::timestamptz <= clock_timestamp()
    AND (proof->>'committedAt')::timestamptz >= (proof #>> '{observation,verification,completedAt}')::timestamptz
    AND (proof->>'committedAt')::timestamptz < (proof #>> '{observation,verification,expiresAt}')::timestamptz,false)
  THEN RAISE EXCEPTION 'Library Plex receipt lost its exact command, initial physical owner or original verification bounds'; END IF;
  FOR binding IN SELECT value FROM jsonb_array_elements(proof->'bindings') LOOP
    SELECT value INTO STRICT association FROM jsonb_array_elements(proof #> '{observation,associations}') WHERE value->'scope'=binding->'scope';
    IF association->'group' IS DISTINCT FROM physical OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coverage) scope WHERE scope=binding->'scope')
      OR NOT EXISTS (SELECT 1 FROM "PlexBindingCurrent" c JOIN "PlexAssociationEvidence" e ON e.id=c."evidenceId"
        WHERE c."mediaId"=binding #>> '{scope,mediaId}' AND c.edition=binding #>> '{scope,edition}'
        AND c."evidenceId"=binding->>'evidenceId' AND c."associationHash"=binding->>'associationHash' AND to_jsonb(c.revision)=binding->'revision'
        AND e.evidence=association AND e."assetId"=NEW."targetId" AND c.xmin::text=(txid_current() % 4294967296)::text)
    THEN RAISE EXCEPTION 'Library Plex receipt requires complete same-transaction exact scoped bindings'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
