-- Named movie rollback: additive actual-source admission, physical and serving closure.
-- Every new PLpgSQL variable is prefixed; all queried table columns are qualified.
CREATE FUNCTION media_movie_rollback_attempt_hashes_v1(p_attempt "AcquisitionAttempt",p_parent jsonb,p_raw jsonb,p_plan_hash text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((p_raw->>'identityRaw')::jsonb=(p_attempt)."identityEvidence"
    AND (p_raw->>'birthRaw')::jsonb=jsonb_build_object('choiceId',(p_attempt)."movieEditionChoiceId",'choiceRevision',(p_attempt)."movieEditionChoiceRevision",'authority',(p_attempt)."movieEditionAuthority")
    AND (p_raw->>'generationsRaw')::jsonb=(p_attempt).generations
    AND p_parent=jsonb_build_object('operationId',(p_attempt)."operationId",'coordinatorOperationId',(p_attempt)."coordinatorOperationId",
      'releaseId',(p_attempt)."releaseId",'sponsorRequestId',(p_attempt)."sponsorRequestId",'torrentId',(p_attempt)."torrentId",'recoveryEpoch',(p_attempt)."recoveryEpoch",
      'identityHash',encode(sha256(convert_to(p_raw->>'identityRaw','UTF8')),'hex'),
      'birthHash',encode(sha256(convert_to(p_raw->>'birthRaw','UTF8')),'hex'),
      'generationsHash',encode(sha256(convert_to(p_raw->>'generationsRaw','UTF8')),'hex'),'filePlanHash',p_plan_hash),false)
$$;

CREATE FUNCTION media_movie_rollback_asset_v1(p_snapshot jsonb,p_scope jsonb,p_birth text DEFAULT NULL,p_changed_captions text[] DEFAULT ARRAY[]::text[]) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_asset "LibraryAsset"; v_rows jsonb; v_caption jsonb; v_actual "SubtitleAsset";
  v_asset_xmin text; v_caption_xmin text; v_coverage jsonb; v_coverage_birth boolean;
  v_capture record; v_caption_row record; v_caption_count integer:=0;
BEGIN
  SELECT a AS actual_row,a.xmin::text AS actual_xmin INTO STRICT v_capture FROM "LibraryAsset" a WHERE a.id=p_snapshot->>'id';
  v_asset:=v_capture.actual_row; v_asset_xmin:=v_capture.actual_xmin;
  SELECT jsonb_agg(jsonb_build_object('mediaId',c."mediaId",'edition',c.edition,'current',c.current) ORDER BY c."mediaId",c.edition),
    bool_and(c.xmin::text=mod(p_birth::numeric,4294967296)::text) INTO v_coverage,v_coverage_birth FROM "AssetCoverage" c WHERE c."assetId"=v_asset.id;
  IF NOT COALESCE(p_snapshot->'schemaVersion'='2'::jsonb AND p_snapshot->'scope'=p_scope
    AND p_snapshot->>'edition'=v_asset.edition AND v_asset.edition=p_scope->>'edition'
    AND p_snapshot->>'editionRootId'=v_asset."editionRootId" AND v_asset."editionRootId"=p_scope->>'rootMediaId'
    AND p_snapshot->>'id'=v_asset.id AND p_snapshot->'version'=to_jsonb(v_asset.version)
    AND p_snapshot->>'state'=v_asset.state AND v_asset.owned AND p_snapshot->'owned'='true'::jsonb
    AND p_snapshot->'ownershipEpoch'=to_jsonb(v_asset."ownershipEpoch")
    AND p_snapshot->>'path'=v_asset.path AND (p_snapshot->>'sourcePath') IS NOT DISTINCT FROM v_asset."sourcePath"
    AND p_snapshot->>'checksum'=v_asset.checksum AND p_snapshot->>'sizeBytes'=v_asset."sizeBytes"::text
    AND p_snapshot->'properties'=v_asset.properties
    AND (p_snapshot->>'supersededByAssetId') IS NOT DISTINCT FROM v_asset."supersededByAssetId"
    AND (p_snapshot->>'plexPublishedAt')::timestamptz IS NOT DISTINCT FROM (v_asset."plexPublishedAt" AT TIME ZONE 'UTC')
    AND (p_snapshot->>'rollbackExpiresAt')::timestamptz IS NOT DISTINCT FROM (v_asset."rollbackExpiresAt" AT TIME ZONE 'UTC')
    AND p_snapshot->'coverage'=v_coverage AND (p_birth IS NULL OR (v_asset_xmin=mod(p_birth::numeric,4294967296)::text AND v_coverage_birth))
    AND jsonb_array_length(p_snapshot->'coverage')=1 AND p_snapshot#>>'{coverage,0,mediaId}'=p_scope->>'mediaId'
    AND p_snapshot#>>'{coverage,0,edition}'=p_scope->>'edition',false) THEN RETURN false; END IF;
  v_rows:=(p_snapshot->'subtitles')||(p_snapshot->'subtitleHistory');
  IF jsonb_typeof(p_snapshot->'subtitles') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot->'subtitleHistory') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_rows)<>(SELECT count(DISTINCT e.value->>'id') FROM jsonb_array_elements(v_rows) AS e(value)) THEN RETURN false; END IF;
  -- The one complete actual traversal supplies both inventory closure and each
  -- literal row/xmin. No separate model COUNT or repeated per-caption query.
  FOR v_caption_row IN SELECT s AS caption,s.xmin::text AS born FROM "SubtitleAsset" s WHERE s."assetId"=v_asset.id ORDER BY s.id LOOP
    v_caption_count:=v_caption_count+1; v_actual:=v_caption_row.caption; v_caption_xmin:=v_caption_row.born;
    SELECT e.value INTO STRICT v_caption FROM jsonb_array_elements(v_rows) AS e(value) WHERE e.value->>'id'=v_actual.id;
    IF v_caption IS DISTINCT FROM media_movie_restore_caption_snapshot(v_actual) THEN RETURN false; END IF;
    IF v_actual.id=ANY(p_changed_captions) AND v_caption_xmin IS DISTINCT FROM mod(p_birth::numeric,4294967296)::text THEN RETURN false; END IF;
  END LOOP;
  RETURN v_caption_count=jsonb_array_length(v_rows);
END;
$$;

CREATE FUNCTION media_movie_rollback_rejection_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_envelope jsonb; v_proof jsonb; v_input jsonb; v_scope jsonb; v_expected jsonb; v_group jsonb;
  v_command "Operation"; v_attempt "AcquisitionAttempt"; v_publication "MediaPublicationTransition"; v_target "MediaIntent";
  v_runtime "MediaRuntimeState"; v_writer "LegacyWriterLease"; v_profile "QualityProfile"; v_reservation "AcquisitionReservation";
  v_asset "LibraryAsset"; v_media "MediaItem"; v_pointer "PlexBindingCurrent"; v_old "PlexAssociationEvidence";
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.kind='movie_plex_rejected_v1' THEN
    IF TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Movie rejected Plex observation is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.kind<>'movie_plex_rejected_v1' THEN RETURN NEW; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'A rejected Plex observation requires its actual new event birth'; END IF;
  PERFORM media_plex_assert_deadline();
  v_envelope:=NEW.payload; v_proof:=v_envelope->'receipt'; v_input:=v_proof->'input'; v_scope:=v_input->'scope';
  v_expected:=v_proof->'expected'; v_group:=v_expected#>'{newGroups,0}';
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=v_input->>'operationId';
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=v_input->>'attemptId';
  SELECT p.* INTO STRICT v_publication FROM "MediaPublicationTransition" p WHERE p."attemptId"=v_attempt.id;
  SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT w.* INTO STRICT v_writer FROM "LegacyWriterLease" w WHERE w.id='singleton';
  SELECT p.* INTO STRICT v_profile FROM "QualityProfile" p WHERE p.id=v_attempt.failure->>'profileId';
  SELECT r.* INTO STRICT v_reservation FROM "AcquisitionReservation" r WHERE r."mediaId"=v_scope->>'mediaId' AND r.edition=v_scope->>'edition';
  SELECT a.* INTO STRICT v_asset FROM "LibraryAsset" a WHERE a.id=v_group->>'assetId';
  SELECT m.* INTO STRICT v_media FROM "MediaItem" m WHERE m.id=v_scope->>'mediaId';
  SELECT p.* INTO v_pointer FROM "PlexBindingCurrent" p WHERE p."mediaId"=v_scope->>'mediaId' AND p.edition=v_scope->>'edition';
  IF v_pointer."evidenceId" IS NOT NULL THEN SELECT e.* INTO STRICT v_old FROM "PlexAssociationEvidence" e WHERE e.id=v_pointer."evidenceId"; END IF;
  IF NOT COALESCE(v_envelope ?& ARRAY['receipt','receiptHash','raw'] AND v_envelope-ARRAY['receipt','receiptHash','raw']='{}'::jsonb AND v_envelope->>'receiptHash' ~ '^[a-f0-9]{64}$'
    AND (v_envelope->>'raw')::jsonb=v_proof AND encode(sha256(convert_to(v_envelope->>'raw','UTF8')),'hex')=v_envelope->>'receiptHash'
    AND v_proof ?& ARRAY['schemaVersion','id','transactionId','commandPayloadRaw','identityRaw','birthRaw','generationsRaw','input','command','attempt','publication','expected','observation','sdk','writerExpiresAt','expiresAt','completedAt']
    AND v_proof-ARRAY['schemaVersion','id','transactionId','commandPayloadRaw','identityRaw','birthRaw','generationsRaw','input','command','attempt','publication','expected','observation','sdk','writerExpiresAt','expiresAt','completedAt']='{}'::jsonb
    AND v_proof->'schemaVersion'='1'::jsonb AND v_proof->>'transactionId'=txid_current()::text AND v_proof->>'id'=NEW.id AND NEW."dedupeKey"='movie-plex-rejected-v1:'||NEW.id
    AND NEW."mediaId"=v_scope->>'mediaId' AND NEW."actorId" IS NOT DISTINCT FROM v_command."userId"
    AND v_command.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4') AND v_command."targetId"=NEW."mediaId"
    AND v_attempt."coordinatorOperationId"=v_command.id AND v_attempt.state='imported' AND v_attempt."recoveryEpoch"=v_runtime."recoveryEpoch"
    AND v_attempt.edition=v_scope->>'edition' AND v_attempt."identityEvidence"->'scope'=v_scope AND v_attempt."filePlan"->'scope'=v_scope
    AND v_input->'schemaVersion'='4'::jsonb AND v_scope->>'rootMediaId'=NEW."mediaId" AND v_media.kind='movie'
    AND v_proof#>>'{command,kind}'=v_command.kind AND v_proof#>>'{command,targetId}'=v_command."targetId"
    AND (v_proof#>>'{command,userId}') IS NOT DISTINCT FROM v_command."userId"
    AND (v_proof->>'commandPayloadRaw')::jsonb=v_command.payload AND v_proof#>>'{command,payloadHash}'=encode(sha256(convert_to(v_proof->>'commandPayloadRaw','UTF8')),'hex')
    AND media_movie_rollback_attempt_hashes_v1(v_attempt,v_proof->'attempt',v_proof,v_publication."filePlanHash")
    AND v_proof#>>'{attempt,operationId}'=v_attempt."operationId" AND v_proof#>>'{attempt,coordinatorOperationId}'=v_command.id
    AND v_proof#>>'{attempt,releaseId}'=v_attempt."releaseId" AND (v_proof#>>'{attempt,sponsorRequestId}') IS NOT DISTINCT FROM v_attempt."sponsorRequestId"
    AND v_proof#>>'{attempt,torrentId}'=v_attempt."torrentId" AND v_proof#>'{attempt,recoveryEpoch}'=to_jsonb(v_attempt."recoveryEpoch")
    AND v_proof#>>'{publication,transitionId}'=v_publication.id AND v_proof#>>'{publication,intentHash}'=v_publication."intentHash"
    AND v_proof#>>'{publication,outcomeHash}'=v_publication."outcomeHash" AND v_publication.outcome->>'kind'='published'
    AND v_expected->'schemaVersion'='1'::jsonb AND jsonb_array_length(v_expected->'targets')=1 AND jsonb_array_length(v_expected->'newGroups')=1 AND jsonb_array_length(v_expected->'parents')=1
    AND v_expected#>>'{parents,0,kind}'='acquisition' AND v_expected#>>'{parents,0,attemptId}'=v_attempt.id
    AND v_expected#>>'{parents,0,operationId}'=v_attempt."operationId" AND v_expected#>>'{parents,0,planHash}'=v_publication."filePlanHash"
    AND v_expected#>'{targets,0,scope}'=v_scope-'rootMediaId' AND v_expected#>'{targets,0,generation}'=to_jsonb(v_target.generation)
    AND v_expected#>'{targets,0,intentVersion}'=to_jsonb(v_target.version) AND v_expected#>'{targets,0,mediaVersion}'=to_jsonb(v_media.version)
    AND v_target.monitoring AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL AND v_target."automationEpoch"=v_runtime."recoveryEpoch"
    AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_target."editionRootId"=NEW."mediaId"
    AND v_reservation."attemptId"=v_attempt.id AND v_reservation.generation=v_target.generation
    AND to_jsonb(v_profile.version)=v_attempt.failure->'profileVersion'
    AND v_asset.id=v_publication.outcome#>>'{entries,0,successor,id}' AND v_asset.version=0 AND v_asset.state='published' AND v_asset.owned
    AND v_asset.edition=v_scope->>'edition' AND v_asset."editionRootId"=v_scope->>'rootMediaId' AND v_asset."ownershipEpoch"=v_runtime."recoveryEpoch"
    AND v_group->'assetVersion'=to_jsonb(v_asset.version) AND v_group->>'checksum'=v_asset.checksum AND v_group->>'sizeBytes'=v_asset."sizeBytes"::text
    AND v_group->>'canonicalPath'=v_asset.path AND v_group->'ownershipEpoch'=to_jsonb(v_asset."ownershipEpoch")
    AND (SELECT jsonb_agg(jsonb_build_object('mediaId',c."mediaId",'edition',c.edition) ORDER BY c."mediaId",c.edition) FROM "AssetCoverage" c WHERE c."assetId"=v_asset.id AND c.current)=v_group->'coverage'
    AND v_expected#>'{previous,0,revision}'=to_jsonb(COALESCE(v_pointer.revision,0))
    AND ((v_pointer."evidenceId" IS NULL AND v_expected#>'{previous,0,evidence}'='null'::jsonb AND v_expected->'oldGroups'='[]'::jsonb)
      OR (v_expected#>>'{previous,0,evidence,id}'=v_old.id AND v_expected#>>'{previous,0,evidence,associationHash}'=v_old."associationHash" AND v_expected->'oldGroups'=jsonb_build_array(v_old.evidence->'group')))
    AND v_proof#>>'{observation,status}'='protected' AND (v_proof->'observation')-ARRAY['status','reason']='{}'::jsonb
    AND v_proof#>>'{observation,reason}' IN ('missing_binding','binding_changed','scope_changed','ownership_changed','compensation_fence_active','series_pack_publication_pending','wrong_server','wrong_section','incomplete_inventory','ambiguous_item','unsupported_media_parts','unresolved_identity','unresolved_numbering','metadata_changed','verification_expired','inaccessible','reconciliation_required')
    AND (v_proof->>'completedAt')::timestamptz>=(v_proof#>>'{sdk,observedAt}')::timestamptz AND (v_proof->>'completedAt')::timestamptz<(v_proof->>'expiresAt')::timestamptz
    AND (v_proof->>'completedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (v_proof->>'completedAt')::timestamptz<=clock_timestamp()
    AND (v_proof->>'expiresAt')::timestamptz<=(v_proof#>>'{sdk,expiresAt}')::timestamptz AND (v_proof->>'expiresAt')::timestamptz<=(v_proof#>>'{sdk,observedAt}')::timestamptz+interval '60 seconds'
    AND (v_proof->>'expiresAt')::timestamptz<=(v_writer."expiresAt" AT TIME ZONE 'UTC') AND (v_writer."expiresAt" AT TIME ZONE 'UTC')=(v_proof->>'writerExpiresAt')::timestamptz AND v_writer."revokedAt" IS NULL AND v_writer."recoveryEpoch"=v_runtime."recoveryEpoch"
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (v_proof->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Movie rejection requires its actual unchanged current source and original Network verification deadline'; END IF;
  IF COALESCE(v_command.result,'{}'::jsonb) ?| ARRAY['moviePlexReceiptV2','moviePlexReceiptV3','movieRollbackIntentV1'] THEN RAISE EXCEPTION 'Movie rejection cannot override committed serving or rollback admission'; END IF;
  PERFORM media_movie_rollback_consent_v1(v_attempt,v_scope,jsonb_build_object('serverMachineId',v_expected#>>'{access,0,serverMachineId}','movieSectionId',v_expected#>>'{access,0,sectionId}'),(v_proof->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_rollback_rejection_birth_v1 AFTER INSERT ON "ApplicationEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_rejection_birth_v1();

CREATE FUNCTION media_movie_rollback_rejection_literal_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind='movie_plex_rejected_v1' THEN RAISE EXCEPTION 'Movie rejected Plex observation is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF (OLD.kind='movie_plex_rejected_v1' OR NEW.kind='movie_plex_rejected_v1') AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN RAISE EXCEPTION 'Movie rejected Plex observation requires its immutable actual birth'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_rollback_rejection_literal_v1 BEFORE UPDATE OR DELETE ON "ApplicationEvent" FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_rejection_literal_v1();

CREATE FUNCTION media_movie_rollback_physical_birth_v1(p_command "Operation",p_intent jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_scope jsonb:=p_intent->'scope'; v_before_a jsonb:=p_intent->'predecessor'; v_before_b jsonb:=p_intent->'successor';
  v_after_a jsonb:=p_proof->'predecessor'; v_after_b jsonb:=p_proof->'successor'; v_source jsonb:=p_intent#>'{source,reference,intent}';
  v_entry jsonb:=p_intent#>'{source,reference,intent,entries,0,entry}'; v_original jsonb:=p_intent#>'{source,reference,intent,entries,0,predecessor}';
  v_attempt "AcquisitionAttempt"; v_target "MediaIntent"; v_runtime "MediaRuntimeState"; v_pointer "PlexBindingCurrent"; v_profile "QualityProfile";
  v_target_xmin text; v_pointer_xmin text; v_changed_captions text[]; v_capture record;
  v_caption jsonb; v_restored jsonb; v_original_caption jsonb; v_sidecar jsonb; v_journal jsonb; v_manifest jsonb; v_participant jsonb;
  v_prefix integer; v_index integer; v_effect jsonb; v_operation text; v_sidecars integer; v_expected text[];
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=p_intent#>>'{invocation,source,attemptId}';
  SELECT t AS actual_row,t.xmin::text AS actual_xmin INTO STRICT v_capture FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
  v_target:=v_capture.actual_row; v_target_xmin:=v_capture.actual_xmin;
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT p AS actual_row,p.xmin::text AS actual_xmin INTO STRICT v_capture FROM "PlexBindingCurrent" p WHERE p."mediaId"=v_scope->>'mediaId' AND p.edition=v_scope->>'edition';
  v_pointer:=v_capture.actual_row; v_pointer_xmin:=v_capture.actual_xmin;
  SELECT p.* INTO STRICT v_profile FROM "QualityProfile" p WHERE p.id=p_intent#>>'{authority,profileId}';
  IF NOT COALESCE(p_proof->'schemaVersion'='1'::jsonb AND p_proof->>'operationId'=p_command.id AND p_proof->>'intentId'=p_intent->>'id'
    AND p_proof->>'intentHash'=p_command.result#>>'{movieRollbackIntentV1,intentHash}' AND p_proof->'scope'=v_scope
    AND v_attempt."coordinatorOperationId"=p_intent#>>'{invocation,source,operationId}' AND v_attempt.state=p_intent#>>'{source,state}'
    AND v_attempt."recoveryEpoch"=v_runtime."recoveryEpoch" AND to_jsonb(v_attempt."recoveryEpoch")=p_intent#>'{authority,recoveryEpoch}'
    AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_target."automationEpoch"=v_attempt."recoveryEpoch"
    AND v_target.availability='importing' AND v_target."desiredPresence" AND v_target.monitoring AND v_target."intentionallyRemovedAt" IS NULL
    AND to_jsonb(v_target.generation)=p_intent#>'{authority,generation}'
    AND v_target."profileId"=v_profile.id AND to_jsonb(v_profile.version)=p_intent#>'{authority,profileVersion}'
    AND v_after_a->>'id'=v_before_a->>'id' AND v_after_b->>'id'=v_before_b->>'id'
    AND v_after_a->>'state'='published' AND v_after_b->>'state'='rejected'
    AND (p_proof->>'bindingRaw')::jsonb=v_after_a AND encode(sha256(convert_to(p_proof->>'bindingRaw','UTF8')),'hex')=p_proof->>'bindingHash'
    AND (p_proof->>'physicalEvidenceRaw')::jsonb=jsonb_build_object('effects',p_proof->'effects','participants',p_proof->'participants','journals',p_proof->'journals')
    AND encode(sha256(convert_to(p_proof->>'physicalEvidenceRaw','UTF8')),'hex')=p_proof->>'physicalEvidenceHash'
    AND (v_after_a->>'version')::integer=(v_before_a->>'version')::integer+1 AND (v_after_a->>'version')::integer=(v_original->>'version')::integer+2
    AND (v_after_b->>'version')::integer=(v_before_b->>'version')::integer+1
    AND v_after_a->>'path'=v_original->>'path' AND v_after_b->>'path'=regexp_replace(v_before_a->>'path','[^/]+$','')||'recover-'||(v_before_b->>'id')
    AND v_after_a->'supersededByAssetId'='null'::jsonb AND v_after_b->'supersededByAssetId'=v_before_b->'supersededByAssetId'
    AND v_after_a-ARRAY['version','state','path','coverage','supersededByAssetId','subtitles','subtitleHistory']=v_before_a-ARRAY['version','state','path','coverage','supersededByAssetId','subtitles','subtitleHistory']
    AND v_after_b-ARRAY['version','state','path','coverage','subtitles','subtitleHistory']=v_before_b-ARRAY['version','state','path','coverage','subtitles','subtitleHistory']
    AND v_after_a->'coverage'=jsonb_build_array(jsonb_build_object('mediaId',v_scope->>'mediaId','edition',v_scope->>'edition','current',true))
    AND v_after_b->'coverage'=jsonb_build_array(jsonb_build_object('mediaId',v_scope->>'mediaId','edition',v_scope->>'edition','current',false))
    AND (v_before_b->'subtitles')||(v_before_b->'subtitleHistory')=(v_after_b->'subtitles')||(v_after_b->'subtitleHistory')
    AND v_pointer."evidenceId" IS NULL AND v_pointer."associationHash" IS NULL AND v_pointer.revision=(p_intent#>>'{pointer,revision}')::integer+1
    AND p_proof->'retiredPointer'=(p_intent->'pointer')||jsonb_build_object('revision',v_pointer.revision,'evidence',NULL)
    AND v_pointer_xmin=(txid_current()%4294967296)::text AND v_target_xmin=(txid_current()%4294967296)::text
    AND (p_proof->>'committedAt')::timestamptz>=(p_proof->>'observedAt')::timestamptz AND (p_proof->>'committedAt')::timestamptz<(p_proof->>'expiresAt')::timestamptz
    AND (p_proof->>'committedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (p_proof->>'committedAt')::timestamptz<=clock_timestamp()
    AND (p_proof->>'expiresAt')::timestamptz<=(p_proof->>'sdkExpiresAt')::timestamptz AND (p_proof->>'expiresAt')::timestamptz<=(p_proof->>'observedAt')::timestamptz+interval '60 seconds'
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (p_proof->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Movie rollback physical completion is not its exact same-transaction admitted inverse'; END IF;
  SELECT array_agg(e.value->>'id') INTO v_changed_captions FROM jsonb_array_elements(v_before_a->'subtitles') AS e(value);
  IF NOT media_movie_rollback_asset_v1(v_after_a,v_scope,txid_current()::text,COALESCE(v_changed_captions,ARRAY[]::text[])) OR NOT media_movie_rollback_asset_v1(v_after_b,v_scope,txid_current()::text) THEN RAISE EXCEPTION 'Movie rollback physical rows or complete caption union changed'; END IF;
  IF v_before_a->'subtitleHistory' IS DISTINCT FROM v_after_a->'subtitleHistory' OR jsonb_array_length(v_before_a->'subtitles')<>jsonb_array_length(v_after_a->'subtitles') THEN RAISE EXCEPTION 'Movie rollback changed independent caption history'; END IF;
  FOR v_caption IN SELECT e.value FROM jsonb_array_elements(v_before_a->'subtitles') AS e(value) LOOP
    SELECT e.value INTO STRICT v_restored FROM jsonb_array_elements(v_after_a->'subtitles') AS e(value) WHERE e.value->>'id'=v_caption->>'id';
    SELECT e.value INTO STRICT v_original_caption FROM jsonb_array_elements((v_original->'subtitles')||(v_original->'subtitleHistory')) AS e(value) WHERE e.value->>'id'=v_caption->>'id';
    IF NOT COALESCE(v_caption->>'state'='superseded' AND v_caption->'videoVersion'=v_before_a->'version' AND v_caption->>'videoChecksum'=v_before_a->>'checksum'
      AND v_caption->'ownershipEpoch'=p_intent#>'{authority,recoveryEpoch}'
      AND v_restored=v_caption||jsonb_build_object('version',(v_caption->>'version')::integer+1,'state','installed','videoVersion',(v_after_a->>'version')::integer,'path',v_original_caption->'path'),false)
    THEN RAISE EXCEPTION 'Movie rollback caption is not its exact same-transaction original owned successor'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements((v_before_b->'subtitles')||(v_before_b->'subtitleHistory')) AS e(value) WHERE e.value->>'storageKind'<>'embedded' AND e.value->>'path' IS NOT NULL)
  THEN RAISE EXCEPTION 'Automatic movie rollback cannot overwrite a successor sidecar'; END IF;
  v_sidecars:=jsonb_array_length(v_entry->'previousSidecars'); v_prefix:=jsonb_array_length(p_intent#>'{source,outcome,effects}');
  IF jsonb_array_length(p_proof->'effects')<>v_prefix+4+3*v_sidecars OR jsonb_array_length(p_proof->'journals')<>1+v_sidecars
    OR jsonb_array_length(p_proof->'participants')<>6+2*v_sidecars+jsonb_array_length(v_entry->'embeddedSubtitles') THEN RAISE EXCEPTION 'Movie rollback incomplete actual effect, participant or journal inventory'; END IF;
  v_expected:=ARRAY['recover-'||(v_before_b->>'id')];
  FOR v_sidecar IN SELECT e.value FROM jsonb_array_elements(v_entry->'previousSidecars') AS e(value) LOOP v_expected:=array_append(v_expected,'recover-'||(v_sidecar->>'quarantineId')); END LOOP;
  FOR v_index IN 0..jsonb_array_length(p_proof->'effects')-1 LOOP
    v_effect:=p_proof#>ARRAY['effects',v_index::text];
    IF (v_effect->>'ordinal')::integer<>v_index OR (v_index<v_prefix AND v_effect IS DISTINCT FROM p_intent#>ARRAY['source','outcome','effects',v_index::text])
      OR (v_index>=v_prefix AND (v_effect->>'libraryKind'<>'movies' OR NOT(v_effect->>'operationId'=ANY(v_expected)) OR v_effect->>'effectHash' !~ '^[a-f0-9]{64}$'))
    THEN RAISE EXCEPTION 'Movie rollback causal effect chain changed'; END IF;
  END LOOP;
  FOREACH v_operation IN ARRAY v_expected LOOP
    SELECT e.value INTO STRICT v_journal FROM jsonb_array_elements(p_proof->'journals') AS e(value) WHERE e.value->>'path'='journal/'||v_operation||'.json';
    v_manifest:=(v_journal->>'raw')::jsonb;
    IF NOT COALESCE(encode(sha256(convert_to(v_journal->>'raw','UTF8')),'hex')=v_journal->>'sha256' AND octet_length(v_journal->>'raw')::text=v_journal->>'sizeBytes'
      AND v_manifest->>'operationId'=v_operation AND v_manifest->>'phase'='complete' AND jsonb_typeof(v_journal#>'{identity,ancestors}')='array'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'effects') AS e(value) WHERE e.value->>'operationId'=v_operation AND e.value->>'step'='journal_complete'),false)
    THEN RAISE EXCEPTION 'Movie rollback lacks its real completed inverse journal'; END IF;
    IF v_operation='recover-'||(v_before_b->>'id') THEN
      IF NOT COALESCE(v_manifest->>'kind'='rollback' AND v_manifest->>'sha256'=v_before_a->>'checksum' AND v_manifest->>'previousSha256'=v_before_b->>'checksum'
        AND right(v_manifest->>'source',length('/rollback/'||(v_entry->>'operationId')))='/rollback/'||(v_entry->>'operationId')
        AND right(v_manifest->>'target',length(v_entry->>'libraryPath')+1)='/'||(v_entry->>'libraryPath'),false) THEN RAISE EXCEPTION 'Movie rollback video journal changed its actual original pair'; END IF;
    ELSE
      SELECT e.value INTO STRICT v_sidecar FROM jsonb_array_elements(v_entry->'previousSidecars') AS e(value) WHERE 'recover-'||(e.value->>'quarantineId')=v_operation;
      IF NOT COALESCE(v_manifest->>'kind'='restore' AND v_manifest->>'sha256'=v_sidecar->>'checksum' AND v_manifest->'previousSha256'='null'::jsonb
        AND right(v_manifest->>'source',length('/quarantine/'||(v_sidecar->>'quarantineId')))='/quarantine/'||(v_sidecar->>'quarantineId')
        AND right(v_manifest->>'target',length(v_sidecar->>'libraryPath')+1)='/'||(v_sidecar->>'libraryPath'),false) THEN RAISE EXCEPTION 'Movie rollback sidecar journal changed its real original manifest'; END IF;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'participants') AS e(value) WHERE e.value->>'assetId'=v_after_a->>'id' AND e.value->'subtitleId'='null'::jsonb AND e.value#>>'{physical,root}'='library' AND e.value#>>'{physical,path}'=v_entry->>'libraryPath' AND e.value#>>'{physical,state}'='present' AND e.value#>>'{physical,sha256}'=v_after_a->>'checksum' AND e.value#>>'{physical,identity,inode}' ~ '^[0-9]+$')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'participants') AS e(value) WHERE e.value->>'assetId'=v_after_b->>'id' AND e.value#>>'{physical,root}'='control' AND e.value#>>'{physical,path}'='rollback/recover-'||(v_after_b->>'id') AND e.value#>>'{physical,state}'='present' AND e.value#>>'{physical,sha256}'=v_after_b->>'checksum' AND e.value#>>'{physical,identity,inode}' ~ '^[0-9]+$')
  THEN RAISE EXCEPTION 'Movie rollback omitted actual restored A or retained B'; END IF;
  IF (SELECT count(DISTINCT jsonb_build_array(e.value->>'assetId',e.value->'subtitleId',e.value->>'role',e.value#>>'{physical,root}',e.value#>>'{physical,path}')) FROM jsonb_array_elements(p_proof->'participants') AS e(value))<>jsonb_array_length(p_proof->'participants') THEN RAISE EXCEPTION 'Movie rollback repeated a physical participant'; END IF;
  FOR v_participant IN SELECT e.value FROM jsonb_array_elements(p_proof->'participants') AS e(value) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_source#>'{entries,0,participants}') AS e(value)
      WHERE (e.value-'physical')=(v_participant-'physical') AND e.value#>'{physical,root}'=v_participant#>'{physical,root}' AND e.value#>'{physical,path}'=v_participant#>'{physical,path}')
      OR v_participant->>'libraryKind'<>'movies' OR v_participant#>>'{physical,state}' NOT IN ('present','absent')
    THEN RAISE EXCEPTION 'Movie rollback participant left its literal original file plan'; END IF;
    IF v_participant#>>'{physical,root}'='library' AND v_participant->>'role' IN ('video','sidecar') THEN
      SELECT e.value INTO STRICT v_original_caption FROM jsonb_array_elements(v_source#>'{entries,0,participants}') AS e(value)
        WHERE (e.value-'physical')=(v_participant-'physical') AND e.value#>'{physical,root}'=v_participant#>'{physical,root}' AND e.value#>'{physical,path}'=v_participant#>'{physical,path}';
      IF NOT COALESCE(v_participant#>>'{physical,state}'='present' AND v_original_caption#>>'{physical,state}'='present'
        AND v_participant#>'{physical,sha256}'=v_original_caption#>'{physical,sha256}' AND v_participant#>'{physical,sizeBytes}'=v_original_caption#>'{physical,sizeBytes}'
        AND v_participant#>'{physical,identity,device}'=v_original_caption#>'{physical,identity,device}' AND v_participant#>'{physical,identity,inode}'=v_original_caption#>'{physical,identity,inode}',false)
      THEN RAISE EXCEPTION 'Movie rollback restored bytes lost their actual original inode'; END IF;
    END IF;
  END LOOP;
  SELECT e.value INTO STRICT v_original_caption FROM jsonb_array_elements(p_intent#>'{source,outcome,entries,0,participants}') AS e(value) WHERE e.value->>'assetId'=v_after_b->>'id' AND e.value->'subtitleId'='null'::jsonb AND e.value->>'role'='video' AND e.value#>>'{physical,root}'='library';
  SELECT e.value INTO STRICT v_participant FROM jsonb_array_elements(p_proof->'participants') AS e(value) WHERE e.value->>'assetId'=v_after_b->>'id' AND e.value->'subtitleId'='null'::jsonb AND e.value#>>'{physical,root}'='control' AND e.value#>>'{physical,path}'='rollback/recover-'||(v_after_b->>'id');
  IF NOT COALESCE(v_original_caption#>'{physical,identity,device}'=v_participant#>'{physical,identity,device}' AND v_original_caption#>'{physical,identity,inode}'=v_participant#>'{physical,identity,inode}'
    AND v_original_caption#>'{physical,sha256}'=v_participant#>'{physical,sha256}' AND v_original_caption#>'{physical,sizeBytes}'=v_participant#>'{physical,sizeBytes}',false)
  THEN RAISE EXCEPTION 'Movie rollback retained B lost its actual published inode'; END IF;
  FOR v_sidecar IN SELECT e.value FROM jsonb_array_elements(v_entry->'previousSidecars') AS e(value) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'participants') AS e(value) WHERE e.value->>'assetId'=v_after_a->>'id' AND e.value->>'subtitleId'=v_sidecar->>'subtitleId'
      AND e.value#>>'{physical,root}'='library' AND e.value#>>'{physical,path}'=v_sidecar->>'libraryPath' AND e.value#>>'{physical,state}'='present' AND e.value#>>'{physical,sha256}'=v_sidecar->>'checksum' AND e.value#>>'{physical,identity,inode}' ~ '^[0-9]+$')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'participants') AS e(value) WHERE e.value->>'assetId'=v_after_a->>'id' AND e.value->>'subtitleId'=v_sidecar->>'subtitleId'
        AND e.value#>>'{physical,root}'='control' AND e.value#>>'{physical,path}'='quarantine/'||(v_sidecar->>'quarantineId') AND e.value#>>'{physical,state}'='absent')
    THEN RAISE EXCEPTION 'Movie rollback omitted its actual restored original caption or quarantine closure'; END IF;
  END LOOP;
  PERFORM media_movie_rollback_consent_v1(v_attempt,v_scope,p_intent->'access',(p_proof->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
END;
$$;

CREATE FUNCTION media_movie_rollback_plex_birth_v1(p_command "Operation",p_intent jsonb,p_physical jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_scope jsonb:=p_intent->'scope'; v_expected jsonb:=p_proof->'expected'; v_association jsonb:=p_proof#>'{observation,associations,0}';
  v_group jsonb:=p_proof#>'{expected,newGroups,0}'; v_binding jsonb:=p_proof->'binding'; v_verification jsonb:=p_proof#>'{observation,verification}';
  v_reference jsonb:=p_proof->'publication'; v_original "PlexAssociationEvidence"; v_evidence "PlexAssociationEvidence";
  v_attempt "AcquisitionAttempt"; v_target "MediaIntent"; v_runtime "MediaRuntimeState"; v_writer "LegacyWriterLease"; v_media "MediaItem";
  v_pointer "PlexBindingCurrent"; v_claim "PlexClaimGroup"; v_member "PlexClaimGroupMember"; v_item "PlexItemClaim"; v_part "PlexPartClaim"; v_path "PlexPathClaim"; v_profile "QualityProfile";
  v_pointer_xmin text; v_evidence_xmin text; v_claim_xmin text; v_changed_captions text[]; v_capture record;
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=p_intent#>>'{invocation,source,attemptId}';
  SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT w.* INTO STRICT v_writer FROM "LegacyWriterLease" w WHERE w.id='singleton';
  SELECT m.* INTO STRICT v_media FROM "MediaItem" m WHERE m.id=v_scope->>'mediaId';
  SELECT p AS actual_row,p.xmin::text AS actual_xmin INTO STRICT v_capture FROM "PlexBindingCurrent" p WHERE p."mediaId"=v_scope->>'mediaId' AND p.edition=v_scope->>'edition';
  v_pointer:=v_capture.actual_row; v_pointer_xmin:=v_capture.actual_xmin;
  SELECT e.* INTO STRICT v_original FROM "PlexAssociationEvidence" e WHERE e.id=p_intent#>>'{originalItem,binding,evidenceId}';
  SELECT e AS actual_row,e.xmin::text AS actual_xmin INTO STRICT v_capture FROM "PlexAssociationEvidence" e WHERE e.id=v_binding->>'evidenceId';
  v_evidence:=v_capture.actual_row; v_evidence_xmin:=v_capture.actual_xmin;
  SELECT g AS actual_row,g.xmin::text AS actual_xmin INTO STRICT v_capture FROM "PlexClaimGroup" g WHERE g."serverMachineId"=v_evidence."serverMachineId" AND g."group"=v_group;
  v_claim:=v_capture.actual_row; v_claim_xmin:=v_capture.actual_xmin;
  SELECT m.* INTO STRICT v_member FROM "PlexClaimGroupMember" m WHERE m."groupId"=v_claim.id;
  SELECT i.* INTO STRICT v_item FROM "PlexItemClaim" i WHERE i."groupId"=v_claim.id;
  SELECT p.* INTO STRICT v_part FROM "PlexPartClaim" p WHERE p."groupId"=v_claim.id;
  SELECT p.* INTO STRICT v_path FROM "PlexPathClaim" p WHERE p."groupId"=v_claim.id;
  SELECT p.* INTO STRICT v_profile FROM "QualityProfile" p WHERE p.id=p_intent#>>'{authority,profileId}';
  IF NOT COALESCE(p_proof->'schemaVersion'='1'::jsonb AND p_proof->>'operationId'=p_command.id AND p_proof->>'intentId'=p_intent->>'id'
    AND p_proof->>'intentHash'=p_command.result#>>'{movieRollbackIntentV1,intentHash}' AND p_proof->>'physicalHash'=p_command.result#>>'{movieRollbackPhysicalV1,receiptHash}'
    AND p_proof->'invocation'=p_intent->'invocation' AND v_reference->>'kind'='movie_rollback_publication_v1' AND v_reference->'scope'=v_scope
    AND v_reference->>'operationId'=p_command.id AND v_reference->>'intentId'=p_intent->>'id' AND v_reference->>'intentHash'=p_proof->>'intentHash'
    AND v_reference->>'physicalHash'=p_proof->>'physicalHash' AND v_reference->>'assetId'=p_physical#>>'{predecessor,id}' AND v_reference->'assetVersion'=p_physical#>'{predecessor,version}'
    AND v_reference->>'bindingHash'=p_physical->>'bindingHash' AND v_reference->>'physicalEvidenceHash'=p_physical->>'physicalEvidenceHash'
    AND v_expected->'schemaVersion'='4'::jsonb AND v_expected#>'{parents,0,reference}'=v_reference AND v_expected#>>'{parents,0,kind}'='movie_rollback_publication_v1'
    AND jsonb_array_length(v_expected->'parents')=1 AND jsonb_array_length(v_expected->'targets')=1 AND jsonb_array_length(v_expected->'newGroups')=1 AND jsonb_array_length(v_expected->'previous')=1
    AND v_expected->'oldGroups'='[]'::jsonb AND v_expected->'originalItem'=p_intent->'originalItem' AND v_expected#>'{previous,0}'=p_physical->'retiredPointer'
    AND v_expected#>'{targets,0,scope}'=v_scope-'rootMediaId' AND v_expected#>>'{targets,0,editionRootId}'=v_scope->>'rootMediaId'
    AND v_expected#>'{targets,0,generation}'=p_intent#>'{authority,generation}' AND v_expected#>'{targets,0,intentVersion}'=to_jsonb(v_target.version)
    AND (v_expected#>>'{targets,0,mediaVersion}')::integer+1=v_media.version
    AND v_group->>'assetId'=p_physical#>>'{predecessor,id}' AND v_group->'assetVersion'=p_physical#>'{predecessor,version}'
    AND v_group->>'checksum'=p_physical#>>'{predecessor,checksum}' AND v_group->>'sizeBytes'=p_physical#>>'{predecessor,sizeBytes}' AND v_group->>'canonicalPath'=p_physical#>>'{predecessor,path}'
    AND v_group->'ownershipEpoch'=p_intent#>'{authority,recoveryEpoch}' AND v_group->>'canonicalRootId'=v_scope->>'rootMediaId' AND v_group->>'edition'=v_scope->>'edition'
    AND v_group->'coverage'=jsonb_build_array(v_scope-'rootMediaId') AND v_association->'group'=v_group AND v_association->'scope'=v_scope-'rootMediaId'
    AND v_association->'schemaVersion'='2'::jsonb AND v_association->>'kind'='movie' AND v_association->>'editionRootId'=v_scope->>'rootMediaId'
    AND v_association->'access'=p_intent->'originalAccess' AND v_expected->'access'=jsonb_build_array(v_association->'access')
    AND v_association->>'canonicalIdentityHash'=v_expected#>>'{targets,0,canonicalIdentityHash}' AND v_association->>'numberingHash'=v_expected#>>'{targets,0,numberingHash}' AND v_association->'definition'=v_expected#>'{targets,0,definition}'
    AND v_association#>'{item,ratingKey}'=p_intent#>'{originalItem,ratingKey}' AND v_association#>'{item,media,0,parts,0,id}'=p_intent#>'{originalItem,part,id}' AND v_association#>'{item,media,0,parts,0,file}'=p_intent#>'{originalItem,part,file}'
    AND v_original."associationHash"=p_intent#>>'{originalItem,binding,associationHash}' AND v_original.evidence->'access'=v_association->'access'
    AND v_evidence.evidence=v_association AND v_evidence."associationHash"=v_binding->>'associationHash' AND v_evidence."assetId"=v_group->>'assetId'
    AND v_evidence."mediaId"=v_scope->>'mediaId' AND v_evidence.edition=v_scope->>'edition' AND v_evidence."serverMachineId"=p_intent#>>'{access,serverMachineId}'
    AND v_binding->'scope'=v_scope-'rootMediaId' AND (v_binding->>'revision')::integer=(p_physical#>>'{retiredPointer,revision}')::integer+1
    AND v_pointer."evidenceId"=v_evidence.id AND v_pointer."associationHash"=v_evidence."associationHash" AND to_jsonb(v_pointer.revision)=v_binding->'revision'
    AND (v_pointer."verifiedStartedAt" AT TIME ZONE 'UTC')=(v_verification->>'startedAt')::timestamptz AND (v_pointer."verifiedCompletedAt" AT TIME ZONE 'UTC')=(v_verification->>'completedAt')::timestamptz
    AND v_attempt.state=p_intent#>>'{source,state}' AND v_attempt."coordinatorOperationId"=p_intent#>>'{invocation,source,operationId}' AND v_attempt."recoveryEpoch"=v_runtime."recoveryEpoch"
    AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_target.availability='available' AND v_target.monitoring AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL
    AND to_jsonb(v_target.generation)=p_intent#>'{authority,generation}' AND v_target."automationEpoch"=v_attempt."recoveryEpoch"
    AND v_target."profileId"=v_profile.id AND to_jsonb(v_profile.version)=p_intent#>'{authority,profileVersion}'
    AND v_writer."recoveryEpoch"=v_attempt."recoveryEpoch" AND v_writer."revokedAt" IS NULL AND (v_writer."observedAt" AT TIME ZONE 'UTC')<=clock_timestamp() AND (v_writer."expiresAt" AT TIME ZONE 'UTC')=(p_proof->>'writerExpiresAt')::timestamptz
    AND (p_proof->>'assetPlexPublishedAt') IS NOT DISTINCT FROM (p_physical#>>'{predecessor,plexPublishedAt}')
    AND v_member."mediaId"=v_scope->>'mediaId' AND v_member.edition=v_scope->>'edition' AND v_member."evidenceId"=v_evidence.id AND v_member."associationHash"=v_evidence."associationHash"
    AND v_item."mediaId"=v_scope->>'mediaId' AND v_item.edition=v_scope->>'edition' AND v_item."evidenceId"=v_evidence.id AND v_item."associationHash"=v_evidence."associationHash"
    AND v_item."serverMachineId"=v_evidence."serverMachineId" AND v_item."sectionId"=v_association#>>'{access,sectionId}' AND v_item."ratingKey"=v_association#>>'{item,ratingKey}'
    AND v_part."serverMachineId"=v_evidence."serverMachineId" AND v_part."partId"=p_intent#>>'{originalItem,part,id}' AND v_part."canonicalPath"=v_group->>'canonicalPath'
    AND v_path."serverMachineId"=v_evidence."serverMachineId" AND v_path."canonicalPath"=v_group->>'canonicalPath'
    AND v_pointer_xmin=(txid_current()%4294967296)::text AND v_evidence_xmin=(txid_current()%4294967296)::text AND v_claim_xmin=(txid_current()%4294967296)::text
    AND (p_proof#>>'{sdk,observedAt}')::timestamptz<=(v_verification->>'startedAt')::timestamptz AND (v_verification->>'completedAt')::timestamptz>=(v_verification->>'startedAt')::timestamptz
    AND (v_verification->>'expiresAt')::timestamptz<=(p_proof#>>'{sdk,expiresAt}')::timestamptz AND (v_verification->>'expiresAt')::timestamptz<=(p_proof#>>'{sdk,observedAt}')::timestamptz+interval '60 seconds'
    AND (v_verification->>'expiresAt')::timestamptz<=(v_writer."expiresAt" AT TIME ZONE 'UTC') AND (p_proof->>'reboundAt')::timestamptz>=(v_verification->>'completedAt')::timestamptz
    AND (p_proof->>'committedAt')::timestamptz>=(p_proof->>'reboundAt')::timestamptz AND (p_proof->>'committedAt')::timestamptz<(v_verification->>'expiresAt')::timestamptz
    AND (p_proof->>'committedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (p_proof->>'committedAt')::timestamptz<=clock_timestamp()
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (v_verification->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Movie rollback Plex completion lost its actual same-transaction serving closure'; END IF;
  IF EXISTS(SELECT 1 FROM "AcquisitionReservation" r WHERE r."mediaId"=v_scope->>'mediaId' AND r.edition=v_scope->>'edition') THEN RAISE EXCEPTION 'Movie rollback serving must release only its completed source reservation'; END IF;
  SELECT array_agg(e.value->>'id') INTO v_changed_captions FROM jsonb_array_elements(p_physical#>'{predecessor,subtitles}') AS e(value);
  IF NOT media_movie_rollback_asset_v1(p_physical->'predecessor',v_scope,p_physical->>'transactionId',COALESCE(v_changed_captions,ARRAY[]::text[])) OR NOT media_movie_rollback_asset_v1(p_physical->'successor',v_scope,p_physical->>'transactionId') THEN RAISE EXCEPTION 'Movie rollback Plex current physical and caption parents changed'; END IF;
  PERFORM media_movie_rollback_consent_v1(v_attempt,v_scope,p_intent->'access',(v_verification->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
END;
$$;

CREATE FUNCTION media_movie_rollback_operation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_marker text; v_envelope jsonb; v_body jsonb; v_event "ApplicationEvent"; v_receipt jsonb; v_attempt_id text; v_event_xmin text; v_capture record;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ?| ARRAY['movieRollbackRejectionV1','movieRollbackIntentV1','movieRollbackPhysicalV1','movieRollbackPlexV1'] THEN RAISE EXCEPTION 'Movie rollback source and immutable records must survive'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ?| ARRAY['movieRollbackIntentV1','movieRollbackPhysicalV1','movieRollbackPlexV1'] THEN
    IF (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload,OLD."createdAt") THEN RAISE EXCEPTION 'Movie rollback command is immutable'; END IF;
    IF NEW.result->'movieRollbackRejectionV1' IS DISTINCT FROM OLD.result->'movieRollbackRejectionV1' THEN RAISE EXCEPTION 'Movie rollback retains its actual admitted rejection pointer'; END IF;
  END IF;
  FOREACH v_marker IN ARRAY ARRAY['movieRollbackIntentV1','movieRollbackPhysicalV1','movieRollbackPlexV1'] LOOP
    IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? v_marker THEN
      IF NEW.result->v_marker IS DISTINCT FROM OLD.result->v_marker THEN RAISE EXCEPTION 'Movie rollback intent, physical and Plex records are immutable'; END IF;
    ELSIF COALESCE(NEW.result,'{}'::jsonb) ? v_marker THEN
      v_envelope:=NEW.result->v_marker; v_body:=CASE WHEN v_marker='movieRollbackIntentV1' THEN v_envelope->'intent' ELSE v_envelope->'receipt' END;
      IF NOT COALESCE(jsonb_typeof(v_envelope)='object' AND (v_envelope->>'raw')::jsonb=v_body
        AND encode(sha256(convert_to(v_envelope->>'raw','UTF8')),'hex')=CASE WHEN v_marker='movieRollbackIntentV1' THEN v_envelope->>'intentHash' ELSE v_envelope->>'receiptHash' END
        AND v_body->'schemaVersion'='1'::jsonb AND v_body->>'transactionId'=txid_current()::text,false)
      THEN RAISE EXCEPTION 'Movie rollback record requires its exact canonical bytes and actual transaction birth'; END IF;
      IF v_marker='movieRollbackIntentV1' THEN
        IF NOT COALESCE(v_envelope ?& ARRAY['intent','intentHash','raw'] AND v_envelope-ARRAY['intent','intentHash','raw']='{}'::jsonb
          AND v_body ?& ARRAY['schemaVersion','id','transactionId','operationId','scope','invocation','command','source','rejection','predecessor','successor','successorGrant','originalItem','originalAccess','pointer','access','authority','cleanup','observedAt','sdkExpiresAt','expiresAt','admittedAt','owner']
          AND v_body-ARRAY['schemaVersion','id','transactionId','operationId','scope','invocation','command','source','rejection','predecessor','successor','successorGrant','originalItem','originalAccess','pointer','access','authority','cleanup','observedAt','sdkExpiresAt','expiresAt','admittedAt','owner']='{}'::jsonb,false)
        THEN RAISE EXCEPTION 'Movie rollback admission shape changed'; END IF;
      ELSIF v_marker='movieRollbackPhysicalV1' THEN
        IF NOT COALESCE(v_envelope ?& ARRAY['receipt','receiptHash','raw'] AND v_envelope-ARRAY['receipt','receiptHash','raw']='{}'::jsonb
          AND v_body ?& ARRAY['schemaVersion','transactionId','operationId','intentId','intentHash','scope','predecessor','successor','bindingRaw','bindingHash','physicalEvidenceRaw','physicalEvidenceHash','retiredPointer','effects','participants','journals','observedAt','sdkExpiresAt','expiresAt','committedAt']
          AND v_body-ARRAY['schemaVersion','transactionId','operationId','intentId','intentHash','scope','predecessor','successor','bindingRaw','bindingHash','physicalEvidenceRaw','physicalEvidenceHash','retiredPointer','effects','participants','journals','observedAt','sdkExpiresAt','expiresAt','committedAt']='{}'::jsonb
          AND NEW.result#>>'{movieRollbackIntentV1,intent,transactionId}'<>txid_current()::text,false)
        THEN RAISE EXCEPTION 'Movie rollback physical completion requires its separate actual admission'; END IF;
      ELSE
        IF NOT COALESCE(v_envelope ?& ARRAY['receipt','receiptHash','raw'] AND v_envelope-ARRAY['receipt','receiptHash','raw']='{}'::jsonb
          AND v_body ?& ARRAY['schemaVersion','transactionId','operationId','invocation','intentId','intentHash','physicalHash','publication','expected','observation','binding','sdk','writerExpiresAt','assetPlexPublishedAt','reboundAt','committedAt']
          AND v_body-ARRAY['schemaVersion','transactionId','operationId','invocation','intentId','intentHash','physicalHash','publication','expected','observation','binding','sdk','writerExpiresAt','assetPlexPublishedAt','reboundAt','committedAt']='{}'::jsonb
          AND NEW.result#>>'{movieRollbackPhysicalV1,receipt,transactionId}'<>txid_current()::text,false)
        THEN RAISE EXCEPTION 'Movie rollback serving requires its separate actual physical completion'; END IF;
      END IF;
    END IF;
  END LOOP;
  IF NEW.result->'movieRollbackRejectionV1' IS DISTINCT FROM (CASE WHEN TG_OP='UPDATE' THEN OLD.result->'movieRollbackRejectionV1' ELSE NULL END) THEN
    v_envelope:=NEW.result->'movieRollbackRejectionV1';
    IF NOT COALESCE(v_envelope ?& ARRAY['eventId','receiptHash'] AND v_envelope-ARRAY['eventId','receiptHash']='{}'::jsonb,false) THEN RAISE EXCEPTION 'Movie rejection pointer shape changed'; END IF;
    SELECT e AS actual_row,e.xmin::text AS actual_xmin INTO STRICT v_capture FROM "ApplicationEvent" e WHERE e.id=v_envelope->>'eventId';
    v_event:=v_capture.actual_row; v_event_xmin:=v_capture.actual_xmin;
    v_receipt:=v_event.payload->'receipt';
    IF NOT COALESCE(v_event.kind='movie_plex_rejected_v1' AND v_event.payload->>'receiptHash'=v_envelope->>'receiptHash'
      AND v_receipt#>>'{input,operationId}'=NEW.id AND v_receipt#>>'{command,kind}'=NEW.kind AND v_receipt#>>'{command,targetId}'=NEW."targetId"
      AND v_receipt->>'transactionId'=txid_current()::text
      AND v_event_xmin=(txid_current()%4294967296)::text,false)
    THEN RAISE EXCEPTION 'Movie rejection pointer requires its same-transaction actual immutable observation'; END IF;
  END IF;
  FOREACH v_marker IN ARRAY ARRAY['moviePlexReceiptV2','moviePlexReceiptV3'] LOOP
    IF COALESCE(NEW.result,'{}'::jsonb) ? v_marker AND NOT(CASE WHEN TG_OP='UPDATE' THEN COALESCE(OLD.result,'{}'::jsonb) ? v_marker ELSE false END) THEN
      v_attempt_id:=NEW.result#>>ARRAY[v_marker,'receipt','input','attemptId'];
      IF EXISTS(SELECT 1 FROM "Operation" o WHERE o.result#>>'{movieRollbackIntentV1,intent,invocation,source,attemptId}'=v_attempt_id) THEN RAISE EXCEPTION 'Admitted rollback prevents a delayed original B serving receipt'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_rollback_operation_v1 BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_operation_v1();

CREATE FUNCTION media_movie_rollback_operation_commit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.result,'{}'::jsonb) ? 'movieRollbackIntentV1' AND NOT(CASE WHEN TG_OP='UPDATE' THEN COALESCE(OLD.result,'{}'::jsonb) ? 'movieRollbackIntentV1' ELSE false END) THEN
    PERFORM media_movie_rollback_intent_birth_v1(NEW,NEW.result#>'{movieRollbackIntentV1,intent}');
  END IF;
  IF COALESCE(NEW.result,'{}'::jsonb) ? 'movieRollbackPhysicalV1' AND NOT(CASE WHEN TG_OP='UPDATE' THEN COALESCE(OLD.result,'{}'::jsonb) ? 'movieRollbackPhysicalV1' ELSE false END) THEN
    PERFORM media_movie_rollback_physical_birth_v1(NEW,NEW.result#>'{movieRollbackIntentV1,intent}',NEW.result#>'{movieRollbackPhysicalV1,receipt}');
  END IF;
  IF COALESCE(NEW.result,'{}'::jsonb) ? 'movieRollbackPlexV1' AND NOT(CASE WHEN TG_OP='UPDATE' THEN COALESCE(OLD.result,'{}'::jsonb) ? 'movieRollbackPlexV1' ELSE false END) THEN
    PERFORM media_movie_rollback_plex_birth_v1(NEW,NEW.result#>'{movieRollbackIntentV1,intent}',NEW.result#>'{movieRollbackPhysicalV1,receipt}',NEW.result#>'{movieRollbackPlexV1,receipt}');
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_rollback_operation_commit_v1 AFTER INSERT OR UPDATE ON "Operation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_operation_commit_v1();

CREATE FUNCTION media_movie_rollback_source_literal_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM "Operation" o WHERE o.result#>>'{movieRollbackIntentV1,intent,invocation,source,attemptId}'=OLD.id) THEN
    IF TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Movie rollback preserves its literal original B acquisition and clocks'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_rollback_source_literal_v1 BEFORE UPDATE OR DELETE ON "AcquisitionAttempt" FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_source_literal_v1();

CREATE FUNCTION media_movie_rollback_pending_asset_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_asset_id text; v_asset_ids text[]; v_row record; v_count integer;
BEGIN
  IF TG_TABLE_NAME='LibraryAsset' THEN
    IF TG_OP='DELETE' THEN v_asset_ids:=ARRAY[OLD.id];
    ELSIF TG_OP='INSERT' THEN v_asset_ids:=ARRAY[NEW.id];
    ELSE v_asset_ids:=ARRAY[OLD.id,NEW.id]; END IF;
  ELSE
    IF TG_OP='DELETE' THEN v_asset_ids:=ARRAY[OLD."assetId"];
    ELSIF TG_OP='INSERT' THEN v_asset_ids:=ARRAY[NEW."assetId"];
    ELSE v_asset_ids:=ARRAY[OLD."assetId",NEW."assetId"]; END IF;
  END IF;
  FOR v_asset_id IN SELECT DISTINCT a.value FROM unnest(v_asset_ids) AS a(value) WHERE a.value IS NOT NULL LOOP
    v_count:=0;
    FOR v_row IN SELECT o.id,o.result FROM "Operation" o
      WHERE NOT(COALESCE(o.result,'{}'::jsonb) ? 'movieRollbackPlexV1')
        AND (o.result#>>'{movieRollbackIntentV1,intent,predecessor,id}'=v_asset_id OR o.result#>>'{movieRollbackIntentV1,intent,successor,id}'=v_asset_id) LOOP
      v_count:=v_count+1;
      IF v_count>1 OR v_row.result#>>'{movieRollbackPhysicalV1,receipt,transactionId}' IS DISTINCT FROM txid_current()::text THEN RAISE EXCEPTION 'Pending movie rollback owns its exact physical participants'; END IF;
    END LOOP;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_rollback_asset_fence_v1 AFTER INSERT OR UPDATE OR DELETE ON "LibraryAsset" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_pending_asset_v1();
CREATE CONSTRAINT TRIGGER movie_rollback_caption_fence_v1 AFTER INSERT OR UPDATE OR DELETE ON "SubtitleAsset" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_pending_asset_v1();
CREATE CONSTRAINT TRIGGER movie_rollback_coverage_fence_v1 AFTER INSERT OR UPDATE OR DELETE ON "AssetCoverage" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_pending_asset_v1();

CREATE FUNCTION media_movie_rollback_consent_v1(p_attempt "AcquisitionAttempt",p_scope jsonb,p_access jsonb,p_expires timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_authority jsonb:=p_attempt."movieEditionAuthority";
BEGIN
  IF p_attempt."identityEvidence"->>'schemaVersion'='2' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "MediaRequest" r JOIN "MovieEditionChoice" c ON c.id=r."movieEditionChoiceId" AND c."choiceRevision"=r."movieEditionChoiceRevision"
      JOIN "MediaUser" actor ON actor.id=c."actorId" JOIN "MediaUser" subject ON subject.id=c."subjectUserId"
      JOIN "PlexIdentityMapping" m ON m."userId"=subject.id
      WHERE r.id=p_attempt."sponsorRequestId" AND r.active AND NOT r.excluded AND r.direct
        AND r."mediaId"=p_scope->>'mediaId' AND r.edition=p_attempt.edition
        AND c.id=p_attempt."movieEditionChoiceId" AND c."choiceRevision"=p_attempt."movieEditionChoiceRevision"
        AND c."actorId"=v_authority->>'actorId' AND c."subjectUserId"=v_authority->>'subjectUserId'
        AND NOT actor.restricted AND NOT subject.restricted AND (actor.id=subject.id OR actor.role='owner')
        AND m."serverMachineId"=p_access->>'serverMachineId' AND m."serverMachineId"=p_attempt."identityEvidence"#>>'{sponsorAuthority,serverMachineId}'
        AND (m."verifiedAt" AT TIME ZONE 'UTC')<=clock_timestamp() AND (m."verifiedAt" AT TIME ZONE 'UTC')+interval '300 seconds'>clock_timestamp() AND p_expires<=(m."verifiedAt" AT TIME ZONE 'UTC')+interval '300 seconds'
        AND 'movie'=ANY(m."permittedMediaKinds") AND p_access->>'movieSectionId'=ANY(m."permittedSectionIds")
        AND ((actor.id=subject.id AND m.kind='account' AND NOT m."plexRestricted") OR (actor.id<>subject.id AND m.kind='managed' AND m."homeUserId" IS NOT NULL))
    ) THEN RAISE EXCEPTION 'Movie rollback requires its still-current genuine original choice and mapping'; END IF;
  ELSIF p_attempt."identityEvidence"->>'schemaVersion'='3' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "MediaHandoffReceipt" h JOIN "MediaHandoffPlan" p ON p.id=h."planId" JOIN "MediaUser" u ON u.id=h."actorId"
      JOIN "MediaIntent" t ON t."mediaId"=p_scope->>'mediaId' AND t.edition=p_attempt.edition
      WHERE h.id=v_authority->>'receiptId' AND p.id=v_authority->>'planId' AND p.state='applied'
        AND h."planHash"=v_authority->>'planHash' AND p."planHash"=h."planHash" AND u.role='owner' AND NOT u.restricted
        AND u.id=v_authority->>'actorId' AND h."recoveryEpoch"=p_attempt."recoveryEpoch" AND t.monitoring AND t."profileId"=v_authority->>'profileId'
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(h.selection#>'{scope,media}') AS e(value) WHERE e.value->>'mediaId'=t."mediaId" AND e.value->'monitored'='true'::jsonb AND e.value->>'profileId'=t."profileId")
        AND v_authority->>'serverMachineId'=p_access->>'serverMachineId' AND v_authority->>'sectionId'=p_access->>'movieSectionId'
    ) THEN RAISE EXCEPTION 'Movie rollback requires its still-current actual owner-approved policy'; END IF;
  ELSE RAISE EXCEPTION 'Movie rollback cannot reinterpret a legacy acquisition'; END IF;
END;
$$;

CREATE FUNCTION media_movie_rollback_intent_birth_v1(p_command "Operation",p_intent jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_scope jsonb:=p_intent->'scope'; v_input jsonb:=p_intent#>'{invocation,source}'; v_attempt "AcquisitionAttempt";
  v_publication "MediaPublicationTransition"; v_target "MediaIntent"; v_runtime "MediaRuntimeState"; v_reservation "AcquisitionReservation";
  v_pointer "PlexBindingCurrent"; v_evidence "PlexAssociationEvidence"; v_profile "QualityProfile"; v_original jsonb; v_part jsonb;
  v_negative "ApplicationEvent"; v_rejected jsonb;
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=v_input->>'attemptId';
  SELECT t.* INTO STRICT v_publication FROM "MediaPublicationTransition" t WHERE t."attemptId"=v_attempt.id;
  SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT r.* INTO STRICT v_reservation FROM "AcquisitionReservation" r WHERE r."mediaId"=v_scope->>'mediaId' AND r.edition=v_scope->>'edition';
  SELECT p.* INTO STRICT v_pointer FROM "PlexBindingCurrent" p WHERE p."mediaId"=v_scope->>'mediaId' AND p.edition=v_scope->>'edition';
  SELECT e.* INTO STRICT v_evidence FROM "PlexAssociationEvidence" e WHERE e.id=v_pointer."evidenceId";
  SELECT p.* INTO STRICT v_profile FROM "QualityProfile" p WHERE p.id=p_intent#>>'{authority,profileId}';
  SELECT e.* INTO STRICT v_negative FROM "ApplicationEvent" e WHERE e.id=p_intent#>>'{rejection,eventId}';
  v_rejected:=v_negative.payload->'receipt';
  v_original:=v_publication.intent#>'{entries,0,predecessor}'; v_part:=v_evidence.evidence#>'{item,media,0,parts,0}';
  IF NOT COALESCE(p_command.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4') AND p_command.id=v_input->>'operationId'
    AND p_intent->'schemaVersion'='1'::jsonb AND p_intent->>'operationId'=p_command.id AND p_command."targetId"=v_scope->>'mediaId'
    AND p_intent#>>'{invocation,mode}'='automatic_failed_plex' AND v_input->'schemaVersion'='4'::jsonb AND v_input->'scope'=v_scope
    AND v_scope->>'rootMediaId'=v_scope->>'mediaId' AND v_scope->>'edition' IN ('default','theatrical_cut','directors_cut','extended_cut','final_cut','unrated_cut','uncut_version')
    AND p_intent#>>'{command,kind}'=p_command.kind AND p_intent#>>'{command,targetId}'=p_command."targetId" AND (p_intent#>>'{command,userId}') IS NOT DISTINCT FROM p_command."userId"
    AND (p_intent#>>'{command,payloadRaw}')::jsonb=p_command.payload AND p_intent#>>'{command,payloadHash}'=encode(sha256(convert_to(p_intent#>>'{command,payloadRaw}','UTF8')),'hex')
    AND (p_intent#>>'{source,commandPayloadRaw}')::jsonb=p_command.payload
    AND (p_intent#>>'{source,commandRaw}')::jsonb=jsonb_build_object('kind',p_command.kind,'targetId',p_command."targetId",'userId',p_command."userId",'payloadHash',encode(sha256(convert_to(p_intent#>>'{source,commandPayloadRaw}','UTF8')),'hex'))
    AND p_intent#>>'{source,commandHash}'=encode(sha256(convert_to(p_intent#>>'{source,commandRaw}','UTF8')),'hex')
    AND p_intent#>>'{source,attemptHash}'=encode(sha256(convert_to(p_intent#>>'{source,attemptRaw}','UTF8')),'hex')
    AND media_movie_rollback_attempt_hashes_v1(v_attempt,(p_intent#>>'{source,attemptRaw}')::jsonb,p_intent->'authority',v_publication."filePlanHash")
    AND p_intent#>>'{authority,identityHash}'=encode(sha256(convert_to(p_intent#>>'{authority,identityRaw}','UTF8')),'hex')
    AND p_intent#>>'{authority,birthHash}'=encode(sha256(convert_to(p_intent#>>'{authority,birthRaw}','UTF8')),'hex')
    AND p_intent#>>'{authority,generationsHash}'=encode(sha256(convert_to(p_intent#>>'{authority,generationsRaw}','UTF8')),'hex')
    AND v_attempt."coordinatorOperationId"=p_command.id AND v_attempt.state='imported' AND p_intent#>>'{source,state}'='imported' AND v_attempt.edition=v_scope->>'edition'
    AND v_attempt."mediaIds"=ARRAY[v_scope->>'mediaId'] AND v_attempt."identityEvidence"->'scope'=v_scope AND v_attempt."filePlan"->'scope'=v_scope
    AND p_intent#>'{source,reference,intent}'=v_publication.intent AND p_intent#>>'{source,reference,transitionId}'=v_publication.id
    AND p_intent#>>'{source,reference,intentHash}'=v_publication."intentHash" AND p_intent#>'{source,outcome}'=v_publication.outcome
    AND p_intent#>>'{source,outcomeHash}'=v_publication."outcomeHash" AND v_publication.outcome->>'kind'='published'
    AND p_intent->'predecessor'=v_publication.outcome#>'{entries,0,predecessor}' AND p_intent->'successor'=v_publication.outcome#>'{entries,0,successor}' AND p_intent->'successorGrant'='null'::jsonb
    AND p_intent#>>'{predecessor,state}'='superseded' AND p_intent#>>'{successor,state}'='published'
    AND p_intent#>>'{predecessor,supersededByAssetId}'=p_intent#>>'{successor,id}' AND p_intent->'cleanup'='null'::jsonb
    AND v_target."desiredPresence" AND v_target.monitoring AND v_target."intentionallyRemovedAt" IS NULL AND v_target."editionRootId"=v_scope->>'rootMediaId'
    AND v_target."automationEpoch"=v_attempt."recoveryEpoch" AND to_jsonb(v_target.generation)=p_intent#>'{authority,generation}'
    AND v_attempt.generations->(v_scope->>'mediaId')=to_jsonb(v_target.generation) AND v_reservation."attemptId"=v_attempt.id AND v_reservation.generation=v_target.generation
    AND to_jsonb(v_attempt."recoveryEpoch")=p_intent#>'{authority,recoveryEpoch}' AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_runtime."recoveryEpoch"=v_attempt."recoveryEpoch"
    AND v_target."profileId"=v_profile.id AND v_profile.id=v_attempt.failure->>'profileId' AND to_jsonb(v_profile.version)=v_attempt.failure->'profileVersion' AND to_jsonb(v_profile.version)=p_intent#>'{authority,profileVersion}'
    AND p_intent#>'{pointer,scope}'=v_scope-'rootMediaId' AND p_intent#>'{pointer,revision}'=to_jsonb(v_pointer.revision)
    AND p_intent#>>'{pointer,evidence,id}'=v_evidence.id AND p_intent#>>'{pointer,evidence,associationHash}'=v_evidence."associationHash"
    AND p_intent#>>'{originalItem,binding,evidenceId}'=v_evidence.id AND p_intent#>>'{originalItem,binding,associationHash}'=v_evidence."associationHash"
    AND p_intent#>'{originalItem,binding,revision}'=to_jsonb(v_pointer.revision) AND p_intent#>'{originalItem,binding,scope}'=v_scope-'rootMediaId'
    AND v_evidence."mediaId"=v_scope->>'mediaId' AND v_evidence.edition=v_scope->>'edition' AND v_evidence."assetId"=v_original->>'id'
    AND v_evidence.evidence#>'{group,assetVersion}'=v_original->'version' AND v_evidence.evidence#>>'{group,checksum}'=v_original->>'checksum'
    AND v_evidence.evidence#>>'{group,canonicalPath}'=v_original->>'path' AND p_intent->'originalAccess'=v_evidence.evidence->'access'
    AND p_intent#>>'{originalAccess,serverMachineId}'=p_intent#>>'{access,serverMachineId}' AND p_intent#>>'{originalAccess,sectionId}'=p_intent#>>'{access,movieSectionId}'
    AND p_intent#>'{originalItem,ratingKey}'=v_evidence.evidence#>'{item,ratingKey}' AND p_intent#>'{originalItem,part,id}'=v_part->'id' AND p_intent#>'{originalItem,part,file}'=v_part->'file'
    AND p_intent#>>'{owner,workflowId}'='media-acquire-'||v_attempt.id AND length(p_intent#>>'{owner,runId}')>0 AND length(p_intent#>>'{owner,activityId}')>0
    AND p_intent->'rejection'=p_command.result->'movieRollbackRejectionV1' AND v_negative.kind='movie_plex_rejected_v1'
    AND v_negative."mediaId"=v_scope->>'mediaId' AND v_negative.payload->>'receiptHash'=p_intent#>>'{rejection,receiptHash}'
    AND v_rejected->'input'=v_input AND v_rejected#>>'{publication,transitionId}'=v_publication.id
    AND v_rejected#>>'{publication,intentHash}'=v_publication."intentHash" AND v_rejected#>>'{publication,outcomeHash}'=v_publication."outcomeHash"
    AND v_rejected#>>'{observation,status}'='protected' AND (v_rejected->>'completedAt')::timestamptz<=(p_intent->>'admittedAt')::timestamptz
    AND (p_intent->>'admittedAt')::timestamptz >= (p_intent->>'observedAt')::timestamptz AND (p_intent->>'admittedAt')::timestamptz < (p_intent->>'expiresAt')::timestamptz
    AND (p_intent->>'expiresAt')::timestamptz <= (p_intent->>'sdkExpiresAt')::timestamptz AND (p_intent->>'expiresAt')::timestamptz <= (p_intent->>'observedAt')::timestamptz+interval '60 seconds'
    AND (p_intent->>'admittedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (p_intent->>'admittedAt')::timestamptz<=clock_timestamp()
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (p_intent->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Movie rollback admission lost its exact actual committed source or current authority'; END IF;
  IF EXISTS(SELECT 1 FROM "Operation" o WHERE o.result#>>'{moviePlexReceiptV2,receipt,input,attemptId}'=v_attempt.id OR o.result#>>'{moviePlexReceiptV3,receipt,input,attemptId}'=v_attempt.id)
    OR EXISTS(SELECT 1 FROM "UpgradeCleanup" c WHERE c."assetId"=p_intent#>>'{predecessor,id}' AND c."successorAssetId"=p_intent#>>'{successor,id}')
    OR EXISTS(SELECT 1 FROM "SubtitleReplacement" r WHERE r."assetId" IN (p_intent#>>'{predecessor,id}',p_intent#>>'{successor,id}') AND r."reservationActive")
    OR EXISTS(SELECT 1 FROM "RecoveryHold" h WHERE h."mediaId"=v_scope->>'mediaId' AND h.edition=v_scope->>'edition' AND h."releasedAt" IS NULL)
  THEN RAISE EXCEPTION 'Automatic movie rollback cannot undo successful serving or borrow an unsettled dependency'; END IF;
  IF NOT media_movie_rollback_asset_v1(p_intent->'predecessor',v_scope) OR NOT media_movie_rollback_asset_v1(p_intent->'successor',v_scope) THEN RAISE EXCEPTION 'Movie rollback admission assets or complete captions changed'; END IF;
  PERFORM media_movie_rollback_consent_v1(v_attempt,v_scope,p_intent->'access',(p_intent->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
END;
$$;
-- The two retained bodies below are copied literally from SQL042/050 except for their private function names.
CREATE FUNCTION media_movie_subtitle_parent_before_rollback_v1(proof JSONB, asset "LibraryAsset", scope JSONB) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE publication "MediaPublicationTransition"; receipt "MediaHandoffReceipt"; plan "MediaHandoffPlan"; baseline JSONB;
BEGIN
  IF proof->>'kind'='movie_publication_transition_v2' THEN
    SELECT * INTO STRICT publication FROM "MediaPublicationTransition" WHERE id=proof->>'transitionId';
    RETURN COALESCE(publication.intent->'schemaVersion'='2'::jsonb AND publication.intent->'scope'=scope
      AND publication.outcome->>'kind'='published' AND publication.outcome #>> '{entries,0,successor,id}'=asset.id
      AND publication.outcome #>> '{entries,0,successor,checksum}'=asset.checksum
      AND proof->>'intentHash'=publication."intentHash" AND proof->>'outcomeHash'=publication."outcomeHash",false);
  ELSIF proof->>'kind'='movie_restore_publication_v1' THEN
    RETURN media_movie_subtitle_restore_parent_v1(proof,asset,scope);
  ELSIF proof->>'kind'='movie_library_adoption_v2' THEN
    SELECT * INTO STRICT receipt FROM "MediaHandoffReceipt" WHERE id=proof->>'receiptId';
    IF receipt.selection->'schemaVersion'='3'::jsonb THEN
      RETURN media_movie_subtitle_library_parent_v3(proof,asset,scope);
    END IF;
    SELECT * INTO STRICT plan FROM "MediaHandoffPlan" WHERE id=receipt."planId";
    IF (SELECT count(*) FROM jsonb_array_elements(receipt.selection->'assets') item WHERE item->>'id'=asset.id) <> 1 THEN RETURN false; END IF;
    SELECT item INTO STRICT baseline FROM jsonb_array_elements(receipt.selection->'assets') item WHERE item->>'id'=asset.id;
    RETURN COALESCE(plan.state='applied' AND plan.id=proof->>'planId' AND plan."planHash"=receipt."planHash" AND proof->>'planHash'=receipt."planHash"
      AND plan.scope->'schemaVersion'='2'::jsonb AND plan.plan->'schemaVersion'='2'::jsonb
      AND receipt.selection->'schemaVersion'='2'::jsonb AND receipt.selection->'scope'=plan.scope
      AND receipt.selection->'fileEvidence'=plan.plan->'files' AND receipt.selection->'networkEvidence'=plan.plan->'network'
      AND receipt."previousRuntimeVersion"=plan."runtimeVersion" AND receipt."runtimeVersion"=receipt."previousRuntimeVersion"+1
      AND receipt."recoveryEpoch"=plan."recoveryEpoch" AND receipt."recoveryEpoch"=asset."ownershipEpoch"
      AND baseline->'schemaVersion'='2'::jsonb AND baseline->'scope'=scope AND baseline->'owned'='true'::jsonb
      AND baseline->'version'='0'::jsonb AND asset.version=0 AND baseline->>'state'='published'
      AND baseline->>'path'=asset.path AND baseline->>'checksum'=asset.checksum AND baseline->>'edition'=asset.edition
      AND baseline->>'editionRootId'=asset."editionRootId" AND baseline->'ownershipEpoch'=to_jsonb(asset."ownershipEpoch")
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(receipt.selection #> '{scope,files}') item
        WHERE item->>'assetId'=asset.id AND item->>'libraryKind'='movies' AND item->>'edition'=asset.edition
          AND item->>'canonicalPath'=asset.path AND item->'existingAssetId'='null'::jsonb AND item->'classification'<>'null'::jsonb)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(receipt.selection #> '{fileEvidence,files}') item
        WHERE item->>'assetId'=asset.id AND item->>'canonicalPath'=asset.path AND item->>'checksum'=asset.checksum),false);
  END IF;
  RETURN false;
END;
$$;

CREATE FUNCTION media_movie_replacement_source_before_rollback_v1(p_source jsonb, p_old jsonb, p_asset "LibraryAsset", p_scope jsonb, p_publication jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_command "Operation"; v_prior "SubtitleReplacementReceipt"; v_previous "SubtitleReplacement";
  v_parent "MediaPublicationTransition"; v_adoption "MediaHandoffReceipt"; v_proof jsonb; v_baseline jsonb;
BEGIN
  IF p_source->>'kind'='installation_v4' THEN
    SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=p_source#>>'{input,operationId}';
    v_proof:=v_command.result#>'{movieSubtitleReceiptV4,receipt}';
    RETURN COALESCE(v_command.kind='acquire_movie_subtitles_v4' AND v_command."targetId"=p_asset.id
      AND v_command.result#>>'{movieSubtitleReceiptV4,receiptHash}'=p_source->>'receiptHash'
      AND v_proof->'input'=p_source->'input' AND v_proof#>'{input,scope}'=p_scope
      AND v_proof->'after'=p_old AND v_proof->'publication'=p_publication,false);
  ELSIF p_source->>'kind'='replacement_v2' THEN
    SELECT r.* INTO STRICT v_previous FROM "SubtitleReplacement" r WHERE r.id=p_source->>'replacementId';
    SELECT r.* INTO STRICT v_prior FROM "SubtitleReplacementReceipt" r WHERE r.id=p_source->>'receiptId' AND r."replacementId"=v_previous.id;
    RETURN COALESCE(v_previous.snapshot->'schemaVersion'='2'::jsonb AND v_previous.snapshot->'scope'=p_scope
      AND v_previous."assetId"=p_asset.id AND v_prior.outcome='installed' AND v_prior.evidence->'schemaVersion'='2'::jsonb
      AND v_prior.evidence#>'{after,candidate}'=p_old AND v_previous.snapshot->'publication'=p_publication
      AND media_movie_replacement_receipt_hash_v2(v_prior)=p_source->>'receiptHash',false);
  ELSIF p_source->>'kind'='video_baseline' THEN
    v_proof:=p_source->'publication';
    IF v_proof IS DISTINCT FROM p_publication OR NOT media_movie_subtitle_parent(v_proof,p_asset,p_scope) THEN RETURN false; END IF;
    IF v_proof->>'kind'='movie_restore_publication_v1' THEN
      SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=v_proof->>'operationId';
      v_baseline:=v_command.result#>'{movieRestoreReceiptV1,receipt,after}';
    ELSIF v_proof->>'kind'='movie_library_adoption_v2' THEN
      SELECT r.* INTO STRICT v_adoption FROM "MediaHandoffReceipt" r WHERE r.id=v_proof->>'receiptId';
      SELECT entry.value INTO STRICT v_baseline FROM jsonb_array_elements(v_adoption.selection->'assets') AS entry(value) WHERE entry.value->>'id'=p_asset.id;
    ELSIF v_proof->>'kind'='movie_publication_transition_v2' THEN
      SELECT t.* INTO STRICT v_parent FROM "MediaPublicationTransition" t WHERE t.id=v_proof->>'transitionId';
      v_baseline:=v_parent.outcome#>'{entries,0,successor}';
    ELSE RETURN false; END IF;
    RETURN COALESCE(v_baseline->'version'=to_jsonb(p_asset.version) AND v_baseline->'scope'=p_scope
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_baseline->'subtitles') AS entry(value) WHERE entry.value=p_old),false);
  END IF;
  RETURN false;
END;
$$;

CREATE FUNCTION media_movie_rollback_caption_parent_v1(p_proof jsonb,p_asset "LibraryAsset",p_scope jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_command "Operation"; v_intent jsonb; v_physical jsonb;
BEGIN
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=p_proof->>'operationId';
  v_intent:=v_command.result#>'{movieRollbackIntentV1,intent}'; v_physical:=v_command.result#>'{movieRollbackPhysicalV1,receipt}';
  RETURN COALESCE(p_proof ?& ARRAY['kind','scope','operationId','intentId','intentHash','physicalHash','assetId','assetVersion','bindingHash','physicalEvidenceHash']
    AND p_proof-ARRAY['kind','scope','operationId','intentId','intentHash','physicalHash','assetId','assetVersion','bindingHash','physicalEvidenceHash','subtitleLineage']='{}'::jsonb
    AND p_proof->>'kind'='movie_rollback_publication_v1' AND p_proof->'scope'=p_scope AND v_intent->'scope'=p_scope AND v_physical->'scope'=p_scope
    AND p_proof->>'intentId'=v_intent->>'id' AND p_proof->>'intentHash'=v_command.result#>>'{movieRollbackIntentV1,intentHash}'
    AND p_proof->>'physicalHash'=v_command.result#>>'{movieRollbackPhysicalV1,receiptHash}'
    AND p_proof->>'assetId'=p_asset.id AND p_proof->'assetVersion'=to_jsonb(p_asset.version)
    AND p_proof->>'bindingHash'=v_physical->>'bindingHash' AND p_proof->>'physicalEvidenceHash'=v_physical->>'physicalEvidenceHash'
    AND v_physical#>>'{predecessor,id}'=p_asset.id AND v_physical#>'{predecessor,version}'=to_jsonb(p_asset.version)
    AND v_physical#>>'{predecessor,state}'='published' AND p_asset.state='published' AND p_asset.owned
    AND p_asset.edition=p_scope->>'edition' AND p_asset."editionRootId"=p_scope->>'rootMediaId'
    AND v_physical#>>'{predecessor,path}'=p_asset.path AND v_physical#>>'{predecessor,checksum}'=p_asset.checksum
    AND v_physical#>>'{predecessor,sizeBytes}'=p_asset."sizeBytes"::text AND v_physical#>'{predecessor,ownershipEpoch}'=to_jsonb(p_asset."ownershipEpoch")
    AND (v_physical#>>'{predecessor,plexPublishedAt}')::timestamptz IS NOT DISTINCT FROM (p_asset."plexPublishedAt" AT TIME ZONE 'UTC')
    AND (v_physical#>>'{predecessor,rollbackExpiresAt}')::timestamptz IS NOT DISTINCT FROM (p_asset."rollbackExpiresAt" AT TIME ZONE 'UTC'),false);
END;
$$;

-- Preserve the original function OID, including existing cached callers.
CREATE OR REPLACE FUNCTION media_movie_subtitle_parent(proof jsonb,asset "LibraryAsset",scope jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF proof->>'kind'='movie_rollback_publication_v1' THEN
    RETURN media_movie_rollback_caption_parent_v1(proof,asset,scope);
  END IF;
  RETURN media_movie_subtitle_parent_before_rollback_v1(proof,asset,scope);
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_replacement_source_v2(p_source jsonb,p_old jsonb,p_asset "LibraryAsset",p_scope jsonb,p_publication jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_command "Operation"; v_baseline jsonb;
BEGIN
  IF p_source->>'kind'='video_baseline' AND p_publication->>'kind'='movie_rollback_publication_v1' THEN
    IF p_source->'publication' IS DISTINCT FROM p_publication OR NOT media_movie_subtitle_parent(p_publication,p_asset,p_scope) THEN RETURN false; END IF;
    SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=p_publication->>'operationId';
    v_baseline:=v_command.result#>'{movieRollbackPhysicalV1,receipt,predecessor}';
    RETURN COALESCE(v_baseline->'scope'=p_scope AND v_baseline->'version'=to_jsonb(p_asset.version)
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_baseline->'subtitles') AS e(value) WHERE e.value=p_old),false);
  END IF;
  RETURN media_movie_replacement_source_before_rollback_v1(p_source,p_old,p_asset,p_scope,p_publication);
END;
$$;

-- Manual owner rollback retains the successful acquisition history and admits
-- a distinct inverse with current playback, caption and owner authority.
CREATE FUNCTION media_movie_requested_rollback_command_v1(p_command "Operation",p_scope jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m_payload jsonb:=p_command.payload; m_review jsonb:=p_command.payload#>'{request,expected}';
BEGIN
  IF NOT COALESCE(p_command.kind='rollback_movie_edition_v1' AND p_command."targetId"=p_scope->>'mediaId'
    AND m_payload ?& ARRAY['schemaVersion','operationId','sourceAttemptId','scope','kind','mediaId','generation','recoveryEpoch','actorId','source','request']
    AND (m_payload-ARRAY['schemaVersion','operationId','sourceAttemptId','scope','kind','mediaId','generation','recoveryEpoch','actorId','source','request'])='{}'::jsonb
    AND m_payload->'schemaVersion'='1'::jsonb AND m_payload->>'operationId'=p_command.id AND m_payload->>'kind'=p_command.kind
    AND m_payload->>'actorId'=p_command."userId" AND m_payload->>'mediaId'=p_command."targetId" AND m_payload->'scope'=p_scope
    AND m_payload#>>'{source,attemptId}'=m_payload->>'sourceAttemptId' AND m_payload#>'{source,scope}'=p_scope AND m_payload#>'{source,schemaVersion}'='4'::jsonb
    AND m_payload#>'{request,schemaVersion}'='1'::jsonb AND m_payload#>'{request,scope}'=p_scope AND m_payload#>>'{request,sourceAttemptId}'=m_payload->>'sourceAttemptId'
    AND m_payload#>'{request,confirmRestorePredecessor}'='true'::jsonb AND m_payload#>'{request,confirmRetainRejectedSuccessor}'='true'::jsonb
    AND length(m_payload#>>'{request,reason}') BETWEEN 10 AND 2000 AND btrim(m_payload#>>'{request,reason}')=m_payload#>>'{request,reason}'
    AND m_payload->'generation'=m_review->'generation' AND m_payload->'recoveryEpoch'=m_review->'recoveryEpoch'
    AND p_scope->>'mediaId'=p_scope->>'rootMediaId' AND p_scope->>'edition' IN ('default','theatrical_cut','directors_cut','extended_cut','final_cut','unrated_cut','uncut_version'),false)
  THEN RAISE EXCEPTION 'Manual movie rollback requires its distinct literal owner command'; END IF;
  RETURN m_review;
END;
$$;

-- Two actual parents, independent of the original B requester.
CREATE FUNCTION media_movie_requested_rollback_owner_v1(p_command "Operation",p_access jsonb,p_expires timestamptz) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE m_actor "MediaUser"; m_mapping "PlexIdentityMapping";
BEGIN
  SELECT u.* INTO STRICT m_actor FROM "MediaUser" u WHERE u.id=p_command."userId";
  SELECT m.* INTO STRICT m_mapping FROM "PlexIdentityMapping" m WHERE m."userId"=m_actor.id;
  IF NOT COALESCE(m_actor.role='owner' AND NOT m_actor.restricted AND m_mapping.kind='account' AND NOT m_mapping."plexRestricted"
    AND m_mapping."serverMachineId"=p_access->>'serverMachineId' AND 'movie'=ANY(m_mapping."permittedMediaKinds")
    AND p_access->>'movieSectionId'=ANY(m_mapping."permittedSectionIds") AND (m_mapping."verifiedAt" AT TIME ZONE 'UTC')<=clock_timestamp()
    AND (m_mapping."verifiedAt" AT TIME ZONE 'UTC')+interval '300 seconds'>clock_timestamp() AND p_expires<=(m_mapping."verifiedAt" AT TIME ZONE 'UTC')+interval '300 seconds',false)
  THEN RAISE EXCEPTION 'Manual movie rollback requires its current actual unrestricted owner and mapping'; END IF;
END;
$$;

CREATE FUNCTION media_movie_requested_rollback_playback_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m_envelope jsonb; m_guard jsonb; m_scope jsonb; m_input jsonb; m_review jsonb; m_expected jsonb;
  m_command "Operation"; m_source_command "Operation"; m_attempt "AcquisitionAttempt"; m_publication "MediaPublicationTransition";
  m_target "MediaIntent"; m_runtime "MediaRuntimeState"; m_writer "LegacyWriterLease"; m_media "MediaItem";
  m_a "LibraryAsset"; m_b "LibraryAsset"; m_pointer "PlexBindingCurrent"; m_evidence "PlexAssociationEvidence"; m_cleanup "UpgradeCleanup";
  m_coverage jsonb; m_association jsonb; m_verification jsonb; m_intent jsonb; m_serving jsonb; m_original jsonb; m_paths jsonb; m_caption_paths jsonb;
BEGIN
  IF NEW.kind<>'movie_rollback_playback_v1' THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  m_envelope:=NEW.payload; m_guard:=m_envelope->'guard'; m_input:=m_guard->'input'; m_scope:=m_input->'scope';
  SELECT o.* INTO STRICT m_command FROM "Operation" o WHERE o.id=m_input->>'operationId';
  m_review:=media_movie_requested_rollback_command_v1(m_command,m_scope);
  SELECT t.* INTO STRICT m_target FROM "MediaIntent" t WHERE t."mediaId"=m_scope->>'mediaId' AND t.edition=m_scope->>'edition';
  SELECT r.* INTO STRICT m_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT w.* INTO STRICT m_writer FROM "LegacyWriterLease" w WHERE w.id='singleton';
  SELECT m.* INTO STRICT m_media FROM "MediaItem" m WHERE m.id=m_scope->>'mediaId';
  SELECT a.* INTO STRICT m_a FROM "LibraryAsset" a WHERE a.id=m_review#>>'{predecessor,id}';
  SELECT a.* INTO STRICT m_b FROM "LibraryAsset" a WHERE a.id=m_review#>>'{successor,id}';
  SELECT jsonb_agg(jsonb_build_object('assetId',c."assetId",'mediaId',c."mediaId",'edition',c.edition,'current',c.current) ORDER BY c."assetId") INTO m_coverage
    FROM "AssetCoverage" c WHERE c."assetId" IN (m_a.id,m_b.id);
  SELECT p.* INTO STRICT m_pointer FROM "PlexBindingCurrent" p WHERE p."mediaId"=m_scope->>'mediaId' AND p.edition=m_scope->>'edition';
  SELECT e.* INTO STRICT m_evidence FROM "PlexAssociationEvidence" e WHERE e.id=m_pointer."evidenceId";
  m_association:=m_evidence.evidence;
  IF NOT COALESCE(m_envelope ?& ARRAY['guard','guardHash','raw'] AND (m_envelope-ARRAY['guard','guardHash','raw'])='{}'::jsonb
    AND (m_envelope->>'raw')::jsonb=m_guard AND encode(sha256(convert_to(m_envelope->>'raw','UTF8')),'hex')=m_envelope->>'guardHash'
    AND m_guard->>'id'=NEW.id AND NEW."dedupeKey"='movie-rollback-playback-v1:'||NEW.id AND NEW."mediaId"=m_command."targetId" AND NEW."actorId"=m_command."userId"
    AND m_guard ?& ARRAY['schemaVersion','id','transactionId','input','command','phase','admission','review','reviewHash','reviewRaw','successorPublicationHash','expected','serving','association','binding','paths','pathsHash','pathsRaw','sessions','sdk','writerExpiresAt','expiresAt','completedAt']
    AND (m_guard-ARRAY['schemaVersion','id','transactionId','input','command','phase','admission','review','reviewHash','reviewRaw','successorPublicationHash','expected','serving','association','binding','paths','pathsHash','pathsRaw','sessions','sdk','writerExpiresAt','expiresAt','completedAt'])='{}'::jsonb
    AND m_guard->'schemaVersion'='1'::jsonb AND m_guard->>'transactionId'=txid_current()::text
    AND m_input=jsonb_build_object('schemaVersion',1,'operationId',m_command.id,'sourceAttemptId',m_command.payload->>'sourceAttemptId','scope',m_scope)
    AND m_guard#>>'{command,actorId}'=m_command."userId" AND (m_guard#>>'{command,payloadRaw}')::jsonb=m_command.payload
    AND encode(sha256(convert_to(m_guard#>>'{command,payloadRaw}','UTF8')),'hex')=m_guard#>>'{command,payloadHash}'
    AND m_guard->'review'=m_review AND (m_guard->>'reviewRaw')::jsonb=m_review AND encode(sha256(convert_to(m_guard->>'reviewRaw','UTF8')),'hex')=m_guard->>'reviewHash'
    AND (m_guard->>'pathsRaw')::jsonb=m_guard->'paths' AND encode(sha256(convert_to(m_guard->>'pathsRaw','UTF8')),'hex')=m_guard->>'pathsHash'
    AND jsonb_array_length(m_guard->'paths') BETWEEN 1 AND 1000
    AND (SELECT count(DISTINCT e.value) FROM jsonb_array_elements(m_guard->'paths') AS e(value))=jsonb_array_length(m_guard->'paths')
    AND m_guard->>'successorPublicationHash'=m_review#>>'{successor,publicationHash}' AND m_guard->'binding'=m_review->'binding'
    AND m_guard->'association'=m_association AND m_evidence."associationHash"=m_review#>>'{binding,associationHash}' AND m_evidence.id=m_review#>>'{binding,evidenceId}'
    AND m_evidence."assetId"=m_b.id AND m_evidence."mediaId"=m_scope->>'mediaId' AND m_evidence.edition=m_scope->>'edition'
    AND to_jsonb(m_pointer.revision)=m_review#>'{binding,revision}' AND m_pointer."associationHash"=m_evidence."associationHash"
    AND m_association#>>'{group,assetId}'=m_b.id AND m_association#>'{group,assetVersion}'=to_jsonb(m_b.version)
    AND m_association#>>'{group,checksum}'=m_b.checksum AND m_association#>>'{group,canonicalPath}'=m_b.path AND m_association#>>'{group,sizeBytes}'=m_b."sizeBytes"::text
    AND m_a.state='superseded' AND m_a."supersededByAssetId"=m_b.id AND m_b.state='published' AND m_a.owned AND m_b.owned
    AND m_a.edition=m_scope->>'edition' AND m_b.edition=m_scope->>'edition' AND m_a."editionRootId"=m_scope->>'rootMediaId' AND m_b."editionRootId"=m_scope->>'rootMediaId'
    AND m_review#>'{predecessor,version}'=to_jsonb(m_a.version) AND m_review#>>'{predecessor,checksum}'=m_a.checksum
    AND m_review#>'{successor,version}'=to_jsonb(m_b.version) AND m_review#>>'{successor,checksum}'=m_b.checksum
    AND jsonb_array_length(m_coverage)=2 AND m_coverage @> jsonb_build_array(jsonb_build_object('assetId',m_a.id,'mediaId',m_scope->>'mediaId','edition',m_scope->>'edition','current',false),jsonb_build_object('assetId',m_b.id,'mediaId',m_scope->>'mediaId','edition',m_scope->>'edition','current',true))
    AND m_runtime.mode='active' AND m_runtime."ownershipConfirmed" AND to_jsonb(m_runtime."recoveryEpoch")=m_review->'recoveryEpoch'
    AND m_a."ownershipEpoch"=m_runtime."recoveryEpoch" AND m_b."ownershipEpoch"=m_runtime."recoveryEpoch" AND m_target."automationEpoch"=m_runtime."recoveryEpoch"
    AND m_target.monitoring AND m_target."desiredPresence" AND m_target."intentionallyRemovedAt" IS NULL
    AND to_jsonb(m_target.version)=m_review->'targetVersion' AND to_jsonb(m_target.generation)=m_review->'generation' AND to_jsonb(m_media.version)=m_review->'mediaVersion'
    AND m_guard#>>'{sessions,state}'='clear' AND m_guard#>>'{sessions,pathsHash}'=m_guard->>'pathsHash'
    AND (m_guard#>>'{sessions,checkedAt}')::timestamptz>=(m_guard#>>'{sdk,observedAt}')::timestamptz
    AND (m_guard->>'completedAt')::timestamptz>=(m_guard#>>'{sessions,checkedAt}')::timestamptz AND (m_guard->>'completedAt')::timestamptz<(m_guard->>'expiresAt')::timestamptz
    AND (m_guard->>'completedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (m_guard->>'completedAt')::timestamptz<=clock_timestamp()
    AND (m_guard->>'expiresAt')::timestamptz<=LEAST((m_guard#>>'{sdk,expiresAt}')::timestamptz,(m_guard#>>'{sdk,observedAt}')::timestamptz+interval '60 seconds',(m_writer."expiresAt" AT TIME ZONE 'UTC'))
    AND (m_writer."expiresAt" AT TIME ZONE 'UTC')=(m_guard->>'writerExpiresAt')::timestamptz AND m_writer."revokedAt" IS NULL AND (m_writer."observedAt" AT TIME ZONE 'UTC')<=clock_timestamp() AND m_writer."recoveryEpoch"=m_runtime."recoveryEpoch"
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (m_guard->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Manual rollback playback lost its actual current scope or original Network deadline'; END IF;
  IF m_guard->>'phase'='admission' THEN
    SELECT a.* INTO STRICT m_attempt FROM "AcquisitionAttempt" a WHERE a.id=m_command.payload->>'sourceAttemptId';
    SELECT p.* INTO STRICT m_publication FROM "MediaPublicationTransition" p WHERE p."attemptId"=m_attempt.id;
    SELECT o.* INTO STRICT m_source_command FROM "Operation" o WHERE o.id=m_attempt."coordinatorOperationId";
    SELECT c.* INTO STRICT m_cleanup FROM "UpgradeCleanup" c WHERE c.id=m_review#>>'{cleanup,id}';
    m_serving:=COALESCE(m_source_command.result#>'{moviePlexReceiptV3,receipt}',m_source_command.result#>'{moviePlexReceiptV2,receipt}');
    m_expected:=m_guard->'expected'; m_verification:=m_guard#>'{serving,verification}';
    m_original:=m_publication.intent#>'{entries,0,predecessor}';
    IF NOT COALESCE(m_attempt.state='completed' AND m_attempt."recoveryEpoch"=m_runtime."recoveryEpoch" AND m_command.payload->'source'=jsonb_build_object('schemaVersion',4,'operationId',m_source_command.id,'attemptId',m_attempt.id,'scope',m_scope)
      AND m_attempt."identityEvidence"->'scope'=m_scope AND m_publication.outcome->>'kind'='published'
      AND m_publication.outcome#>>'{entries,0,predecessor,id}'=m_a.id AND m_publication.outcome#>>'{entries,0,successor,id}'=m_b.id
      AND m_serving#>>'{input,attemptId}'=m_attempt.id AND m_serving#>>'{publication,transitionId}'=m_publication.id AND m_serving#>>'{publication,outcomeHash}'=m_publication."outcomeHash"
      AND m_guard->'admission'='null'::jsonb AND m_guard#>'{serving,associations}'=jsonb_build_array(m_association)
      AND m_expected->'schemaVersion'='1'::jsonb AND m_expected#>'{targets,0,scope}'=m_scope-'rootMediaId'
      AND m_expected#>'{targets,0,mediaVersion}'=m_review->'mediaVersion' AND m_expected#>'{targets,0,intentVersion}'=m_review->'targetVersion'
      AND m_expected#>'{targets,0,generation}'=m_review->'generation' AND m_expected->'newGroups'=jsonb_build_array(m_association->'group')
      AND m_expected->'access'=jsonb_build_array(m_association->'access') AND m_expected->'oldGroups'=jsonb_build_array(m_association->'group')
      AND m_expected#>'{previous,0}'=jsonb_build_object('scope',m_scope-'rootMediaId','revision',m_pointer.revision,'evidence',jsonb_build_object('id',m_evidence.id,'associationHash',m_evidence."associationHash"))
      AND m_cleanup.state='pending' AND to_jsonb(m_cleanup.version)=m_review#>'{cleanup,version}' AND m_cleanup."assetId"=m_a.id AND m_cleanup."successorAssetId"=m_b.id
      AND (m_cleanup."expiresAt" AT TIME ZONE 'UTC')=(m_review#>>'{cleanup,expiresAt}')::timestamptz AND (m_cleanup."expiresAt" AT TIME ZONE 'UTC')>clock_timestamp() AND (m_guard->>'expiresAt')::timestamptz<=(m_cleanup."expiresAt" AT TIME ZONE 'UTC')
      AND (m_verification->>'startedAt')::timestamptz>=(m_guard#>>'{sdk,observedAt}')::timestamptz AND (m_verification->>'completedAt')::timestamptz<=(m_guard#>>'{sessions,checkedAt}')::timestamptz
      AND (m_guard->>'expiresAt')::timestamptz<=(m_verification->>'expiresAt')::timestamptz,false)
    THEN RAISE EXCEPTION 'Manual rollback admission playback is not its genuinely verified current B'; END IF;
  ELSIF m_guard->>'phase'='physical' THEN
    m_intent:=m_command.result#>'{movieRollbackIntentV1,intent}';
    IF COALESCE(m_command.result,'{}'::jsonb)?'movieRollbackOwnerV1' THEN
      PERFORM media_movie_rollback_execution_v1(m_command,m_guard,'playback');
    END IF;
    m_original:=m_intent#>'{source,reference,intent,entries,0,predecessor}';
    IF NOT COALESCE(m_guard->'expected'='null'::jsonb AND m_guard->'serving'='null'::jsonb AND m_intent#>>'{invocation,mode}'='manual_verified'
      AND m_guard#>>'{admission,intentId}'=m_intent->>'id' AND m_guard#>>'{admission,intentHash}'=m_command.result#>>'{movieRollbackIntentV1,intentHash}'
      AND m_intent->>'transactionId'<>txid_current()::text AND NOT(COALESCE(m_command.result,'{}'::jsonb)?'movieRollbackPhysicalV1')
      AND m_intent->'cleanup'=m_review->'cleanup' AND m_intent->'pointer'=jsonb_build_object('scope',m_scope-'rootMediaId','revision',m_pointer.revision,'evidence',jsonb_build_object('id',m_evidence.id,'associationHash',m_evidence."associationHash")),false)
    THEN RAISE EXCEPTION 'Manual rollback physical playback cannot invent fresh current B serving'; END IF;
  ELSE RAISE EXCEPTION 'Unknown manual movie rollback playback phase'; END IF;
  -- One actual complete caption traversal; no independent COUNT or re-read.
  SELECT COALESCE(jsonb_agg(to_jsonb(s.path)),'[]'::jsonb) INTO m_caption_paths FROM "SubtitleAsset" s WHERE s."assetId" IN (m_a.id,m_b.id);
  SELECT jsonb_agg(to_jsonb(q.path) ORDER BY q.path) INTO m_paths FROM (
    SELECT DISTINCT all_paths.path FROM (
      SELECT m_a.path AS path UNION ALL SELECT m_b.path UNION ALL SELECT m_original->>'path'
      UNION ALL SELECT c.value#>>'{}' FROM jsonb_array_elements(m_caption_paths) AS c(value)
      UNION ALL SELECT c.value->>'path' FROM jsonb_array_elements((m_original->'subtitles')||(m_original->'subtitleHistory')) AS c(value) WHERE c.value->>'path' IS NOT NULL
      UNION ALL SELECT p.value->>'file' FROM jsonb_array_elements(m_association#>'{item,media}') AS m(value),jsonb_array_elements(m.value->'parts') AS p(value)
      UNION ALL SELECT c.value->>'storedTargetPath' FROM jsonb_array_elements(COALESCE(m_intent#>'{captionManifest,captions}','[]'::jsonb)) AS c(value)
      UNION ALL SELECT regexp_replace(m_a.path,'/rollback/[^/]+$','')||'/rollback/recover-'||m_b.id WHERE m_guard->>'phase'='physical'
      UNION ALL SELECT regexp_replace(m_a.path,'/rollback/[^/]+$','')||'/staging/recover-'||m_b.id WHERE m_guard->>'phase'='physical'
    ) AS all_paths WHERE all_paths.path IS NOT NULL
  ) AS q;
  IF m_paths IS DISTINCT FROM m_guard->'paths' THEN RAISE EXCEPTION 'Manual movie playback omitted an actual affected video or caption path'; END IF;
  PERFORM media_movie_requested_rollback_owner_v1(m_command,jsonb_build_object('serverMachineId',m_association#>>'{access,serverMachineId}','movieSectionId',m_association#>>'{access,sectionId}'),(m_guard->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_requested_rollback_playback_birth_v1 AFTER INSERT ON "ApplicationEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_requested_rollback_playback_birth_v1();

CREATE FUNCTION media_movie_requested_rollback_playback_literal_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind='movie_rollback_playback_v1' THEN RAISE EXCEPTION 'Manual movie playback observations are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF (OLD.kind='movie_rollback_playback_v1' OR NEW.kind='movie_rollback_playback_v1') AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'Manual movie playback observations require their actual immutable birth';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_requested_rollback_playback_literal_v1 BEFORE UPDATE OR DELETE ON "ApplicationEvent" FOR EACH ROW EXECUTE FUNCTION media_movie_requested_rollback_playback_literal_v1();

CREATE FUNCTION media_movie_requested_rollback_pointer_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m_old jsonb; m_ref jsonb; m_event "ApplicationEvent"; m_capture record; m_birth text; m_guard jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb)?'movieRollbackPlaybackV1' THEN RAISE EXCEPTION 'Manual movie rollback retains its actual observation source command'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    m_old:=OLD.result->'movieRollbackPlaybackV1';
    IF m_old IS NOT NULL AND (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload,OLD."createdAt") THEN RAISE EXCEPTION 'Observed manual movie rollback command is immutable'; END IF;
  END IF;
  m_ref:=NEW.result->'movieRollbackPlaybackV1';
  IF m_ref IS NOT DISTINCT FROM m_old THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb)?'movieRollbackPhysicalV1' THEN RAISE EXCEPTION 'Completed manual inverse retains its original physical playback observation'; END IF;
  SELECT e AS actual_row,e.xmin::text AS actual_xmin INTO STRICT m_capture FROM "ApplicationEvent" e WHERE e.id=m_ref->>'eventId';
  m_event:=m_capture.actual_row; m_birth:=m_capture.actual_xmin; m_guard:=m_event.payload->'guard';
  IF NOT COALESCE(m_ref ?& ARRAY['eventId','guardHash'] AND (m_ref-ARRAY['eventId','guardHash'])='{}'::jsonb
    AND m_event.kind='movie_rollback_playback_v1' AND m_event.payload->>'guardHash'=m_ref->>'guardHash'
    AND m_guard#>>'{input,operationId}'=NEW.id AND m_event."actorId"=NEW."userId" AND m_event."mediaId"=NEW."targetId"
    AND NEW.kind='rollback_movie_edition_v1' AND (m_guard#>>'{command,payloadRaw}')::jsonb=NEW.payload
    AND m_guard->>'transactionId'=txid_current()::text AND m_birth=(txid_current()%4294967296)::text,false)
  THEN RAISE EXCEPTION 'Manual movie rollback pointer requires its actual same-transaction immutable playback event'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_requested_rollback_pointer_v1 BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_movie_requested_rollback_pointer_v1();

CREATE FUNCTION media_movie_requested_rollback_captions_v1(p_intent jsonb,p_publication "MediaPublicationTransition",p_b "LibraryAsset") RETURNS void LANGUAGE plpgsql AS $$
DECLARE m_manifest jsonb:=p_intent->'captionManifest'; m_grant jsonb:=p_intent->'successorGrant'; m_scope jsonb:=p_intent->'scope';
  m_caption jsonb; m_old jsonb; m_parent jsonb; m_index integer:=0; m_sidecars integer; m_journal jsonb; m_library_prefix text; m_control_prefix text; m_staged jsonb;
BEGIN
  IF NOT COALESCE((p_intent->>'captionManifestRaw')::jsonb=m_manifest AND (p_intent->>'successorGrantRaw')::jsonb=m_grant
    AND m_manifest ?& ARRAY['schemaVersion','admissionId','scope','assetId','assetVersion','assetChecksum','ownershipEpoch','captions']
    AND (m_manifest-ARRAY['schemaVersion','admissionId','scope','assetId','assetVersion','assetChecksum','ownershipEpoch','captions'])='{}'::jsonb
    AND m_manifest->'schemaVersion'='1'::jsonb AND m_manifest->>'admissionId'=p_intent->>'id' AND m_manifest->'scope'=m_scope
    AND m_manifest->>'assetId'=p_b.id AND m_manifest->'assetVersion'=to_jsonb(p_b.version) AND m_manifest->>'assetChecksum'=p_b.checksum AND m_manifest->'ownershipEpoch'=to_jsonb(p_b."ownershipEpoch")
    AND m_grant->>'kind'='movie_publication_transition_v2' AND m_grant->'scope'=m_scope AND m_grant->>'transitionId'=p_publication.id
    AND m_grant->>'intentHash'=p_publication."intentHash" AND m_grant->>'outcomeHash'=p_publication."outcomeHash" AND m_grant->>'assetId'=p_b.id AND m_grant->'assetVersion'=to_jsonb(p_b.version)
    AND jsonb_array_length(m_manifest->'captions')<=64,false)
  THEN RAISE EXCEPTION 'Manual rollback caption manifest lost its actual B video birth'; END IF;
  SELECT count(*) INTO m_sidecars FROM jsonb_array_elements(p_intent#>'{successor,subtitles}') AS c(value) WHERE c.value->>'storageKind'='sidecar';
  IF jsonb_array_length(m_manifest->'captions')<>m_sidecars OR (SELECT count(DISTINCT c.value#>>'{snapshot,id}') FROM jsonb_array_elements(m_manifest->'captions') AS c(value))<>m_sidecars
    THEN RAISE EXCEPTION 'Manual rollback requires the complete actual B-owned sidecar union'; END IF;
  SELECT (j.value->>'raw')::jsonb INTO STRICT m_journal FROM jsonb_array_elements(p_intent#>'{source,outcome,entries,0,journals}') AS j(value)
    WHERE j.value->>'path'='journal/'||(p_publication.intent#>>'{entries,0,entry,operationId}')||'.json';
  m_library_prefix:=left(m_journal->>'target',length(m_journal->>'target')-length(p_publication.intent#>>'{entries,0,entry,libraryPath}'));
  SELECT s.value->'physical' INTO STRICT m_staged FROM jsonb_array_elements(p_publication.intent#>'{entries,0,participants}') AS s(value)
    WHERE s.value#>>'{physical,root}'='control' AND s.value#>>'{physical,path}'='staging/'||(p_publication.intent#>>'{entries,0,entry,operationId}');
  m_control_prefix:=regexp_replace(m_staged#>>'{identity,ancestors,0,path}','/staging$','');
  FOR m_caption IN SELECT c.value FROM jsonb_array_elements(m_manifest->'captions') AS c(value) LOOP
    m_old:=m_caption->'snapshot'; m_parent:=m_caption->'parent';
    IF NOT COALESCE(m_caption ?& ARRAY['operationId','snapshot','parent','source','target','storedTargetPath','workerSourcePath','workerTargetPath']
      AND (m_caption-ARRAY['operationId','snapshot','parent','source','target','storedTargetPath','workerSourcePath','workerTargetPath'])='{}'::jsonb
      AND m_caption->>'operationId'='rollback-caption-'||(p_intent->>'id')||'-'||m_index::text
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_intent#>'{successor,subtitles}') AS c(value) WHERE c.value=m_old)
      AND m_old->>'state'='installed' AND m_old->>'storageKind'='sidecar' AND m_old->>'assetId'=p_b.id
      AND m_old->'videoVersion'=to_jsonb(p_b.version) AND m_old->>'videoChecksum'=p_b.checksum AND m_old->'ownershipEpoch'=to_jsonb(p_b."ownershipEpoch")
      AND m_caption#>>'{source,state}'='present' AND m_caption#>>'{source,root}'='library' AND m_caption#>>'{source,sha256}'=m_old->>'checksum'
      AND m_old->>'path'='/data/movies/'||(m_caption#>>'{source,path}')
      AND m_caption#>>'{target,state}'='absent' AND m_caption#>>'{target,root}'='control' AND m_caption#>>'{target,path}'='quarantine/'||(m_caption->>'operationId')
      AND m_caption->>'storedTargetPath'='/data/movies/.media-control/quarantine/'||(m_caption->>'operationId')
      AND m_caption->>'workerSourcePath'=m_library_prefix||(m_caption#>>'{source,path}')
      AND m_caption->>'workerTargetPath'=m_control_prefix||'/quarantine/'||(m_caption->>'operationId')
      AND m_parent#>>'{publication,kind}'='movie_publication_transition_v2' AND m_parent#>>'{publication,transitionId}'=p_publication.id
      AND m_parent#>>'{publication,intentHash}'=p_publication."intentHash" AND m_parent#>>'{publication,outcomeHash}'=p_publication."outcomeHash"
      AND m_parent#>>'{publication,assetId}'=p_b.id AND m_parent#>'{publication,assetVersion}'=to_jsonb(p_b.version) AND m_parent#>'{publication,scope}'=m_scope,false)
    THEN RAISE EXCEPTION 'Manual rollback caption lost its exact current B identity or distinct native operation'; END IF;
    IF m_parent#>>'{source,kind}'='video_baseline' THEN
      IF m_parent#>'{source,publication}' IS DISTINCT FROM m_parent->'publication' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_publication.outcome#>'{entries,0,successor,subtitles}') AS c(value) WHERE c.value=m_old)
        THEN RAISE EXCEPTION 'Manual rollback cannot infer a caption baseline'; END IF;
    ELSIF m_parent#>>'{source,kind}' IN ('installation_v4','replacement_v2') THEN
      IF NOT media_movie_replacement_source_v2(m_parent->'source',m_old,p_b,m_scope,m_parent->'publication') THEN RAISE EXCEPTION 'Manual rollback caption lost its actual immutable installation or replacement parent'; END IF;
    ELSE RAISE EXCEPTION 'Unknown manual rollback caption source'; END IF;
    m_index:=m_index+1;
  END LOOP;
END;
$$;

CREATE FUNCTION media_movie_requested_rollback_intent_birth_v1(p_command "Operation",p_intent jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m_scope jsonb:=p_intent->'scope'; m_review jsonb; m_source jsonb:=p_intent#>'{invocation,source}';
  m_attempt "AcquisitionAttempt"; m_publication "MediaPublicationTransition"; m_source_command "Operation";
  m_target "MediaIntent"; m_runtime "MediaRuntimeState"; m_pointer "PlexBindingCurrent"; m_b_evidence "PlexAssociationEvidence"; m_a_evidence "PlexAssociationEvidence";
  m_profile "QualityProfile"; m_cleanup "UpgradeCleanup"; m_event "ApplicationEvent"; m_media "MediaItem"; m_capture record; m_cleanup_birth text;
  m_playback jsonb; m_original jsonb; m_serving jsonb; m_a jsonb:=p_intent->'predecessor'; m_b jsonb:=p_intent->'successor'; m_b_row "LibraryAsset";
BEGIN
  PERFORM media_plex_assert_deadline();
  m_review:=media_movie_requested_rollback_command_v1(p_command,m_scope);
  SELECT a.* INTO STRICT m_attempt FROM "AcquisitionAttempt" a WHERE a.id=m_source->>'attemptId';
  SELECT p.* INTO STRICT m_publication FROM "MediaPublicationTransition" p WHERE p."attemptId"=m_attempt.id;
  SELECT o.* INTO STRICT m_source_command FROM "Operation" o WHERE o.id=m_attempt."coordinatorOperationId";
  SELECT t.* INTO STRICT m_target FROM "MediaIntent" t WHERE t."mediaId"=m_scope->>'mediaId' AND t.edition=m_scope->>'edition';
  SELECT r.* INTO STRICT m_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT p.* INTO STRICT m_pointer FROM "PlexBindingCurrent" p WHERE p."mediaId"=m_scope->>'mediaId' AND p.edition=m_scope->>'edition';
  SELECT e.* INTO STRICT m_b_evidence FROM "PlexAssociationEvidence" e WHERE e.id=m_pointer."evidenceId";
  SELECT e.* INTO STRICT m_a_evidence FROM "PlexAssociationEvidence" e WHERE e.id=p_intent#>>'{originalItem,binding,evidenceId}';
  SELECT p.* INTO STRICT m_profile FROM "QualityProfile" p WHERE p.id=p_intent#>>'{authority,profileId}';
  SELECT c AS actual_row,c.xmin::text AS actual_xmin INTO STRICT m_capture FROM "UpgradeCleanup" c WHERE c.id=m_review#>>'{cleanup,id}';
  m_cleanup:=m_capture.actual_row; m_cleanup_birth:=m_capture.actual_xmin;
  SELECT e.* INTO STRICT m_event FROM "ApplicationEvent" e WHERE e.id=p_intent#>>'{playback,eventId}';
  SELECT a.* INTO STRICT m_b_row FROM "LibraryAsset" a WHERE a.id=m_b->>'id';
  SELECT m.* INTO STRICT m_media FROM "MediaItem" m WHERE m.id=m_scope->>'mediaId';
  m_playback:=m_event.payload->'guard'; m_original:=m_publication.intent#>'{entries,0,predecessor}';
  m_serving:=COALESCE(m_source_command.result#>'{moviePlexReceiptV3,receipt}',m_source_command.result#>'{moviePlexReceiptV2,receipt}');
  IF NOT COALESCE(p_intent->'schemaVersion'='1'::jsonb AND p_intent->>'operationId'=p_command.id AND p_intent#>>'{invocation,mode}'='manual_verified'
    AND p_intent#>'{invocation,command}'=jsonb_build_object('schemaVersion',1,'operationId',p_command.id,'sourceAttemptId',m_attempt.id,'scope',m_scope)
    AND m_source=p_command.payload->'source' AND m_source=jsonb_build_object('schemaVersion',4,'operationId',m_source_command.id,'attemptId',m_attempt.id,'scope',m_scope)
    AND p_intent#>'{command,kind}'=to_jsonb(p_command.kind) AND p_intent#>>'{command,targetId}'=p_command."targetId" AND p_intent#>>'{command,userId}'=p_command."userId"
    AND (p_intent#>>'{command,payloadRaw}')::jsonb=p_command.payload AND p_intent#>>'{command,payloadHash}'=encode(sha256(convert_to(p_intent#>>'{command,payloadRaw}','UTF8')),'hex')
    AND (p_intent#>>'{source,commandPayloadRaw}')::jsonb=m_source_command.payload
    AND (p_intent#>>'{source,commandRaw}')::jsonb=jsonb_build_object('kind',m_source_command.kind,'targetId',m_source_command."targetId",'userId',m_source_command."userId",'payloadHash',encode(sha256(convert_to(p_intent#>>'{source,commandPayloadRaw}','UTF8')),'hex'))
    AND p_intent#>>'{source,commandHash}'=encode(sha256(convert_to(p_intent#>>'{source,commandRaw}','UTF8')),'hex')
    AND p_intent#>>'{source,attemptHash}'=encode(sha256(convert_to(p_intent#>>'{source,attemptRaw}','UTF8')),'hex')
    AND media_movie_rollback_attempt_hashes_v1(m_attempt,(p_intent#>>'{source,attemptRaw}')::jsonb,p_intent->'authority',m_publication."filePlanHash")
    AND m_attempt.state='completed' AND p_intent#>>'{source,state}'='completed' AND m_attempt."mediaIds"=ARRAY[m_scope->>'mediaId'] AND m_attempt.edition=m_scope->>'edition'
    AND m_attempt."identityEvidence"->'scope'=m_scope AND m_attempt."filePlan"->'scope'=m_scope AND m_attempt."recoveryEpoch"=m_runtime."recoveryEpoch"
    AND p_intent#>'{source,reference,intent}'=m_publication.intent AND p_intent#>>'{source,reference,transitionId}'=m_publication.id AND p_intent#>>'{source,reference,intentHash}'=m_publication."intentHash"
    AND p_intent#>'{source,outcome}'=m_publication.outcome AND p_intent#>>'{source,outcomeHash}'=m_publication."outcomeHash" AND m_publication.outcome->>'kind'='published'
    AND m_serving#>'{input}'=m_source AND m_serving#>>'{publication,transitionId}'=m_publication.id AND m_serving#>>'{publication,outcomeHash}'=m_publication."outcomeHash"
    AND m_a->>'id'=m_publication.outcome#>>'{entries,0,predecessor,id}' AND m_a->>'state'='superseded' AND m_a->>'supersededByAssetId'=m_b->>'id'
    AND (m_a-'rollbackExpiresAt')=(m_publication.outcome#>'{entries,0,predecessor}')-'rollbackExpiresAt'
    AND m_b->>'id'=m_publication.outcome#>>'{entries,0,successor,id}' AND m_b->>'state'='published'
    AND (m_b-ARRAY['plexPublishedAt','subtitles','subtitleHistory'])=((m_publication.outcome#>'{entries,0,successor}')-ARRAY['plexPublishedAt','subtitles','subtitleHistory'])
    AND m_review#>>'{predecessor,id}'=m_a->>'id' AND m_review#>'{predecessor,version}'=m_a->'version' AND m_review#>>'{predecessor,checksum}'=m_a->>'checksum'
    AND m_review#>>'{successor,id}'=m_b->>'id' AND m_review#>'{successor,version}'=m_b->'version' AND m_review#>>'{successor,checksum}'=m_b->>'checksum'
    AND encode(sha256(convert_to(p_intent->>'successorGrantRaw','UTF8')),'hex')=m_review#>>'{successor,publicationHash}'
    AND m_target.availability='available' AND m_target.monitoring AND m_target."desiredPresence" AND m_target."intentionallyRemovedAt" IS NULL AND m_target."editionRootId"=m_scope->>'rootMediaId'
    AND to_jsonb(m_target.version)=m_review->'targetVersion' AND to_jsonb(m_target.generation)=m_review->'generation' AND m_target."automationEpoch"=m_runtime."recoveryEpoch" AND to_jsonb(m_media.version)=m_review->'mediaVersion'
    AND to_jsonb(m_runtime."recoveryEpoch")=m_review->'recoveryEpoch' AND m_runtime.mode='active' AND m_runtime."ownershipConfirmed"
    AND p_intent#>'{authority,generation}'=m_review->'generation' AND p_intent#>'{authority,recoveryEpoch}'=m_review->'recoveryEpoch'
    AND m_target."profileId"=m_profile.id AND to_jsonb(m_profile.version)=p_intent#>'{authority,profileVersion}'
    AND p_intent->'pointer'=jsonb_build_object('scope',m_scope-'rootMediaId','revision',m_pointer.revision,'evidence',jsonb_build_object('id',m_b_evidence.id,'associationHash',m_b_evidence."associationHash"))
    AND m_review->'binding'=jsonb_build_object('scope',m_scope-'rootMediaId','revision',m_pointer.revision,'evidenceId',m_b_evidence.id,'associationHash',m_b_evidence."associationHash")
    AND m_b_evidence."assetId"=m_b->>'id' AND m_b_evidence."associationHash"=m_pointer."associationHash" AND m_b_evidence.evidence#>'{group,assetVersion}'=m_b->'version'
    AND m_a_evidence.id=m_serving#>>'{expected,previous,0,evidence,id}' AND m_a_evidence."associationHash"=m_serving#>>'{expected,previous,0,evidence,associationHash}'
    AND m_a_evidence."mediaId"=m_scope->>'mediaId' AND m_a_evidence.edition=m_scope->>'edition' AND m_a_evidence."assetId"=m_original->>'id'
    AND p_intent#>'{originalItem,binding}'=jsonb_build_object('scope',m_scope-'rootMediaId','revision',m_serving#>'{expected,previous,0,revision}','evidenceId',m_a_evidence.id,'associationHash',m_a_evidence."associationHash")
    AND m_a_evidence.evidence#>'{group,assetVersion}'=m_original->'version' AND m_a_evidence.evidence#>>'{group,checksum}'=m_original->>'checksum' AND m_a_evidence.evidence#>>'{group,canonicalPath}'=m_original->>'path'
    AND p_intent->'originalAccess'=m_a_evidence.evidence->'access' AND p_intent#>>'{access,serverMachineId}'=m_a_evidence."serverMachineId"
    AND p_intent#>>'{access,movieSectionId}'=m_a_evidence.evidence#>>'{access,sectionId}'
    AND p_intent#>'{originalItem,ratingKey}'=m_a_evidence.evidence#>'{item,ratingKey}' AND p_intent#>'{originalItem,part}'=jsonb_build_object('id',m_a_evidence.evidence#>'{item,media,0,parts,0,id}','file',m_a_evidence.evidence#>'{item,media,0,parts,0,file}')
    AND p_intent->'rejection'='null'::jsonb AND p_intent->'cleanup'=m_review->'cleanup'
    AND m_cleanup.state='cancelled' AND m_cleanup.version=(m_review#>>'{cleanup,version}')::integer+1 AND m_cleanup."assetId"=m_a->>'id' AND m_cleanup."successorAssetId"=m_b->>'id'
    AND (m_cleanup."expiresAt" AT TIME ZONE 'UTC')=(m_review#>>'{cleanup,expiresAt}')::timestamptz AND (m_cleanup."expiresAt" AT TIME ZONE 'UTC')=(m_a->>'rollbackExpiresAt')::timestamptz
    AND m_cleanup_birth=(txid_current()%4294967296)::text AND (p_intent->>'admittedAt')::timestamptz<(m_cleanup."expiresAt" AT TIME ZONE 'UTC')
    AND m_event.kind='movie_rollback_playback_v1' AND m_event.payload->>'guardHash'=p_intent#>>'{playback,guardHash}' AND p_intent->'playback'=p_command.result->'movieRollbackPlaybackV1'
    AND m_playback->>'phase'='admission' AND m_playback->'review'=m_review AND m_playback#>>'{input,operationId}'=p_command.id
    AND (p_intent->>'admittedAt')::timestamptz>=(m_playback->>'completedAt')::timestamptz AND (p_intent->>'expiresAt')::timestamptz<=(m_playback->>'expiresAt')::timestamptz
    AND p_intent#>>'{owner,workflowId}'='media-operation-'||p_command.id AND length(p_intent#>>'{owner,runId}')>0 AND length(p_intent#>>'{owner,activityId}')>0
    AND (p_intent->>'admittedAt')::timestamptz>=(p_intent->>'observedAt')::timestamptz AND (p_intent->>'admittedAt')::timestamptz<(p_intent->>'expiresAt')::timestamptz
    AND (p_intent->>'expiresAt')::timestamptz<=LEAST((p_intent->>'sdkExpiresAt')::timestamptz,(p_intent->>'observedAt')::timestamptz+interval '60 seconds')
    AND (p_intent->>'admittedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (p_intent->>'admittedAt')::timestamptz<=clock_timestamp()
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (p_intent->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Manual rollback admission lost its actual owner, successful B, original pair or original cleanup deadline'; END IF;
  IF EXISTS(SELECT 1 FROM "AcquisitionReservation" r WHERE r."mediaId"=m_scope->>'mediaId' AND r.edition=m_scope->>'edition')
    OR EXISTS(SELECT 1 FROM "SubtitleReplacement" r WHERE r."assetId" IN (m_a->>'id',m_b->>'id') AND r."reservationActive")
    OR EXISTS(SELECT 1 FROM "RecoveryHold" h WHERE h."mediaId"=m_scope->>'mediaId' AND h.edition=m_scope->>'edition' AND h."releasedAt" IS NULL)
  THEN RAISE EXCEPTION 'Manual rollback cannot borrow an active acquisition, replacement or recovery participant'; END IF;
  IF NOT media_movie_rollback_asset_v1(m_a,m_scope) OR NOT media_movie_rollback_asset_v1(m_b,m_scope) THEN RAISE EXCEPTION 'Manual rollback current complete asset/caption union changed'; END IF;
  PERFORM media_movie_requested_rollback_captions_v1(p_intent,m_publication,m_b_row);
  PERFORM media_movie_requested_rollback_owner_v1(p_command,p_intent->'access',(p_intent->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
END;
$$;

CREATE FUNCTION media_movie_requested_rollback_caption_completion_v1(p_intent jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m_manifest jsonb:=p_intent->'captionManifest'; m_done jsonb:=p_proof->'successorCaptions'; m_before jsonb:=p_intent->'successor'; m_after jsonb:=p_proof->'successor';
  m_caption jsonb; m_old jsonb; m_new jsonb; m_target jsonb; m_source jsonb; m_journal jsonb; m_descriptor jsonb; m_effect jsonb; m_restored jsonb; m_index integer:=0; m_offset integer; m_path jsonb;
BEGIN
  IF NOT COALESCE(m_done ?& ARRAY['schemaVersion','manifestHash','effects','targets','closedSources','journals']
    AND (m_done-ARRAY['schemaVersion','manifestHash','effects','targets','closedSources','journals'])='{}'::jsonb
    AND m_done->'schemaVersion'='1'::jsonb AND m_done->>'manifestHash'=encode(sha256(convert_to(p_intent->>'captionManifestRaw','UTF8')),'hex')
    AND jsonb_array_length(m_done->'effects')=3*jsonb_array_length(m_manifest->'captions') AND jsonb_array_length(m_done->'targets')=jsonb_array_length(m_manifest->'captions')
    AND jsonb_array_length(m_done->'closedSources')=jsonb_array_length(m_manifest->'captions') AND jsonb_array_length(m_done->'journals')=jsonb_array_length(m_manifest->'captions')
    AND m_after->'subtitles'='[]'::jsonb AND jsonb_array_length(m_after->'subtitleHistory')=jsonb_array_length(m_before->'subtitles')+jsonb_array_length(m_before->'subtitleHistory'),false)
  THEN RAISE EXCEPTION 'Manual rollback requires its complete separate B-caption causal closure'; END IF;
  FOR m_old IN SELECT c.value FROM jsonb_array_elements(m_before->'subtitleHistory') AS c(value) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m_after->'subtitleHistory') AS c(value) WHERE c.value=m_old) THEN RAISE EXCEPTION 'Manual rollback changed independent B-caption history'; END IF;
  END LOOP;
  FOR m_old IN SELECT c.value FROM jsonb_array_elements(m_before->'subtitles') AS c(value) LOOP
    SELECT c.value INTO STRICT m_new FROM jsonb_array_elements(m_after->'subtitleHistory') AS c(value) WHERE c.value->>'id'=m_old->>'id';
    m_path:=m_old->'path';
    IF m_old->>'storageKind'='sidecar' THEN
      SELECT c.value INTO STRICT m_caption FROM jsonb_array_elements(m_manifest->'captions') AS c(value) WHERE c.value#>>'{snapshot,id}'=m_old->>'id';
      m_path:=m_caption->'storedTargetPath';
    ELSIF m_old->>'storageKind'<>'embedded' THEN RAISE EXCEPTION 'Unknown retained B-caption storage kind'; END IF;
    IF NOT COALESCE(m_old->>'state'='installed' AND m_old->>'assetId'=m_before->>'id' AND m_old->'videoVersion'=m_before->'version' AND m_old->>'videoChecksum'=m_before->>'checksum'
      AND m_old->'ownershipEpoch'=p_intent#>'{authority,recoveryEpoch}' AND m_new=m_old||jsonb_build_object('version',(m_old->>'version')::integer+1,'state','quarantined','videoVersion',(m_after->>'version')::integer,'path',m_path),false)
    THEN RAISE EXCEPTION 'Manual rollback retained caption lost its exact original B-owned transition'; END IF;
  END LOOP;
  FOR m_caption IN SELECT c.value FROM jsonb_array_elements(m_manifest->'captions') AS c(value) LOOP
    m_target:=m_done#>ARRAY['targets',m_index::text]; m_source:=m_done#>ARRAY['closedSources',m_index::text]; m_journal:=m_done#>ARRAY['journals',m_index::text]; m_descriptor:=(m_journal->>'raw')::jsonb;
    FOR m_offset IN 0..2 LOOP
      m_effect:=m_done#>ARRAY['effects',(m_index*3+m_offset)::text];
      IF NOT COALESCE(m_effect->'ordinal'=to_jsonb(m_index*3+m_offset) AND m_effect->>'libraryKind'='movies' AND m_effect->>'operationId'=m_caption->>'operationId'
        AND m_effect->>'step'=(ARRAY['move_link','move_unlink','journal_complete'])[m_offset+1] AND m_effect->>'effectHash' ~ '^[a-f0-9]{64}$',false)
      THEN RAISE EXCEPTION 'Manual rollback caption effect prefix changed'; END IF;
    END LOOP;
    IF NOT COALESCE(m_target->>'assetId'=m_before->>'id' AND m_target->>'subtitleId'=m_caption#>>'{snapshot,id}' AND m_target->>'libraryKind'='movies' AND m_target->>'role'='quarantine'
      AND m_target#>>'{physical,state}'='present' AND m_target#>>'{physical,root}'='control' AND m_target#>'{physical,path}'=m_caption#>'{target,path}'
      AND m_target#>'{physical,sha256}'=m_caption#>'{source,sha256}' AND m_target#>'{physical,sizeBytes}'=m_caption#>'{source,sizeBytes}'
      AND m_target#>'{physical,identity,device}'=m_caption#>'{source,identity,device}' AND m_target#>'{physical,identity,inode}'=m_caption#>'{source,identity,inode}'
      AND m_source->>'subtitleId'=m_caption#>>'{snapshot,id}' AND m_source#>>'{physical,root}'='library' AND m_source#>'{physical,path}'=m_caption#>'{source,path}'
      AND m_journal->>'path'='journal/'||(m_caption->>'operationId')||'.json' AND encode(sha256(convert_to(m_journal->>'raw','UTF8')),'hex')=m_journal->>'sha256' AND octet_length(m_journal->>'raw')::text=m_journal->>'sizeBytes'
      AND m_descriptor->>'version'='1' AND m_descriptor->>'operationId'=m_caption->>'operationId' AND m_descriptor->>'kind'='quarantine' AND m_descriptor->>'phase'='complete'
      AND m_descriptor->>'source'=m_caption->>'workerSourcePath' AND m_descriptor->>'target'=m_caption->>'workerTargetPath' AND m_descriptor->>'sha256'=m_caption#>>'{snapshot,checksum}' AND m_descriptor->'previousSha256'='null'::jsonb,false)
    THEN RAISE EXCEPTION 'Manual rollback retained B caption lost its actual original inode or literal quarantine journal'; END IF;
    SELECT c.value INTO m_restored FROM jsonb_array_elements(p_proof->'participants') AS c(value) WHERE c.value#>>'{physical,root}'='library' AND c.value#>'{physical,path}'=m_caption#>'{source,path}';
    IF (m_restored IS NULL AND m_source#>>'{physical,state}' IS DISTINCT FROM 'absent') OR (m_restored IS NOT NULL AND m_restored->'physical' IS DISTINCT FROM m_source->'physical') THEN RAISE EXCEPTION 'Manual caption source is not its actual final original-inverse state'; END IF;
    m_index:=m_index+1;
  END LOOP;
END;
$$;

CREATE FUNCTION media_movie_requested_rollback_physical_birth_v1(p_command "Operation",p_intent jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m_scope jsonb:=p_intent->'scope'; m_a jsonb:=p_intent->'predecessor'; m_b jsonb:=p_intent->'successor';
  m_after_a jsonb:=p_proof->'predecessor'; m_after_b jsonb:=p_proof->'successor'; m_review jsonb;
  m_original jsonb:=p_intent#>'{source,reference,intent,entries,0,predecessor}'; m_attempt "AcquisitionAttempt"; m_target "MediaIntent"; m_runtime "MediaRuntimeState";
  m_pointer "PlexBindingCurrent"; m_profile "QualityProfile"; m_media "MediaItem"; m_event "ApplicationEvent"; m_cleanup "UpgradeCleanup";
  m_capture record; m_target_birth text; m_pointer_birth text; m_playback jsonb; m_changed_a text[]; m_changed_b text[];
BEGIN
  PERFORM media_plex_assert_deadline();
  m_review:=media_movie_requested_rollback_command_v1(p_command,m_scope);
  SELECT a.* INTO STRICT m_attempt FROM "AcquisitionAttempt" a WHERE a.id=p_intent#>>'{invocation,source,attemptId}';
  SELECT t AS actual_row,t.xmin::text AS actual_xmin INTO STRICT m_capture FROM "MediaIntent" t WHERE t."mediaId"=m_scope->>'mediaId' AND t.edition=m_scope->>'edition';
  m_target:=m_capture.actual_row; m_target_birth:=m_capture.actual_xmin;
  SELECT r.* INTO STRICT m_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT p AS actual_row,p.xmin::text AS actual_xmin INTO STRICT m_capture FROM "PlexBindingCurrent" p WHERE p."mediaId"=m_scope->>'mediaId' AND p.edition=m_scope->>'edition';
  m_pointer:=m_capture.actual_row; m_pointer_birth:=m_capture.actual_xmin;
  SELECT p.* INTO STRICT m_profile FROM "QualityProfile" p WHERE p.id=p_intent#>>'{authority,profileId}';
  SELECT m.* INTO STRICT m_media FROM "MediaItem" m WHERE m.id=m_scope->>'mediaId';
  SELECT e.* INTO STRICT m_event FROM "ApplicationEvent" e WHERE e.id=p_proof#>>'{playback,eventId}';
  SELECT c.* INTO STRICT m_cleanup FROM "UpgradeCleanup" c WHERE c.id=m_review#>>'{cleanup,id}';
  m_playback:=m_event.payload->'guard';
  IF NOT COALESCE(p_proof->'schemaVersion'='1'::jsonb AND p_proof->>'operationId'=p_command.id AND p_proof->>'intentId'=p_intent->>'id'
    AND p_intent#>>'{invocation,mode}'='manual_verified' AND p_proof->>'intentHash'=p_command.result#>>'{movieRollbackIntentV1,intentHash}' AND p_proof->'scope'=m_scope
    AND m_attempt.state='completed' AND m_attempt.state=p_intent#>>'{source,state}' AND m_attempt."coordinatorOperationId"=p_intent#>>'{invocation,source,operationId}'
    AND m_attempt."recoveryEpoch"=m_runtime."recoveryEpoch" AND to_jsonb(m_attempt."recoveryEpoch")=m_review->'recoveryEpoch'
    AND m_runtime.mode='active' AND m_runtime."ownershipConfirmed" AND m_target."automationEpoch"=m_runtime."recoveryEpoch"
    AND m_target.availability='importing' AND m_target.monitoring AND m_target."desiredPresence" AND m_target."intentionallyRemovedAt" IS NULL
    AND to_jsonb(m_target.generation)=m_review->'generation' AND to_jsonb(m_target.version)=m_review->'targetVersion' AND m_media.version=(m_review->>'mediaVersion')::integer+1
    AND m_target."profileId"=m_profile.id AND to_jsonb(m_profile.version)=p_intent#>'{authority,profileVersion}'
    AND m_after_a->>'id'=m_a->>'id' AND m_after_b->>'id'=m_b->>'id' AND m_after_a->>'state'='published' AND m_after_b->>'state'='rejected'
    AND (m_after_a->>'version')::integer=(m_a->>'version')::integer+1 AND (m_after_a->>'version')::integer=(m_original->>'version')::integer+2 AND (m_after_b->>'version')::integer=(m_b->>'version')::integer+1
    AND m_after_a->>'path'=m_original->>'path' AND m_after_b->>'path'=regexp_replace(m_a->>'path','[^/]+$','')||'recover-'||(m_b->>'id')
    AND m_after_a->'supersededByAssetId'='null'::jsonb AND m_after_b->'supersededByAssetId'=m_b->'supersededByAssetId'
    AND (m_after_a-ARRAY['version','state','path','coverage','supersededByAssetId','subtitles','subtitleHistory'])=(m_a-ARRAY['version','state','path','coverage','supersededByAssetId','subtitles','subtitleHistory'])
    AND (m_after_b-ARRAY['version','state','path','coverage','subtitles','subtitleHistory'])=(m_b-ARRAY['version','state','path','coverage','subtitles','subtitleHistory'])
    AND m_after_a->'coverage'=jsonb_build_array(jsonb_build_object('mediaId',m_scope->>'mediaId','edition',m_scope->>'edition','current',true))
    AND m_after_b->'coverage'=jsonb_build_array(jsonb_build_object('mediaId',m_scope->>'mediaId','edition',m_scope->>'edition','current',false))
    AND (p_proof->>'bindingRaw')::jsonb=m_after_a AND encode(sha256(convert_to(p_proof->>'bindingRaw','UTF8')),'hex')=p_proof->>'bindingHash'
    AND (p_proof->>'physicalEvidenceRaw')::jsonb=jsonb_build_object('effects',p_proof->'effects','participants',p_proof->'participants','journals',p_proof->'journals','successorCaptions',p_proof->'successorCaptions')
    AND encode(sha256(convert_to(p_proof->>'physicalEvidenceRaw','UTF8')),'hex')=p_proof->>'physicalEvidenceHash'
    AND m_pointer."evidenceId" IS NULL AND m_pointer."associationHash" IS NULL AND m_pointer.revision=(p_intent#>>'{pointer,revision}')::integer+1
    AND p_proof->'retiredPointer'=(p_intent->'pointer')||jsonb_build_object('revision',m_pointer.revision,'evidence',NULL)
    AND m_target_birth=(txid_current()%4294967296)::text AND m_pointer_birth=(txid_current()%4294967296)::text
    AND m_cleanup.state='cancelled' AND m_cleanup.version=(m_review#>>'{cleanup,version}')::integer+1 AND (m_cleanup."expiresAt" AT TIME ZONE 'UTC')=(m_review#>>'{cleanup,expiresAt}')::timestamptz
    AND m_cleanup."assetId"=m_a->>'id' AND m_cleanup."successorAssetId"=m_b->>'id' AND p_intent->'cleanup'=m_review->'cleanup'
    AND p_proof->'playback'=p_command.result->'movieRollbackPlaybackV1' AND m_event.kind='movie_rollback_playback_v1' AND m_event.payload->>'guardHash'=p_proof#>>'{playback,guardHash}'
    AND m_playback->>'phase'='physical' AND m_playback->'review'=m_review AND m_playback#>>'{input,operationId}'=p_command.id
    AND m_playback#>>'{admission,intentId}'=p_intent->>'id' AND m_playback#>>'{admission,intentHash}'=p_proof->>'intentHash'
    AND (p_proof->>'observedAt')::timestamptz>=(m_playback->>'completedAt')::timestamptz AND (p_proof->>'expiresAt')::timestamptz<=(m_playback->>'expiresAt')::timestamptz
    AND (p_proof->>'committedAt')::timestamptz>=(p_proof->>'observedAt')::timestamptz AND (p_proof->>'committedAt')::timestamptz<(p_proof->>'expiresAt')::timestamptz
    AND (p_proof->>'expiresAt')::timestamptz<=LEAST((p_proof->>'sdkExpiresAt')::timestamptz,(p_proof->>'observedAt')::timestamptz+interval '60 seconds')
    AND (p_proof->>'committedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (p_proof->>'committedAt')::timestamptz<=clock_timestamp()
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (p_proof->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Manual inverse lost its exact current owner, admitted physical pair or fresh playback'; END IF;
  IF EXISTS(SELECT 1 FROM "AcquisitionReservation" r WHERE r."mediaId"=m_scope->>'mediaId' AND r.edition=m_scope->>'edition') THEN RAISE EXCEPTION 'Manual inverse cannot borrow a new acquisition reservation'; END IF;
  SELECT array_agg(c.value->>'id') INTO m_changed_a FROM jsonb_array_elements(m_a->'subtitles') AS c(value);
  SELECT array_agg(c.value->>'id') INTO m_changed_b FROM jsonb_array_elements(m_b->'subtitles') AS c(value);
  IF NOT media_movie_rollback_asset_v1(m_after_a,m_scope,txid_current()::text,COALESCE(m_changed_a,ARRAY[]::text[])) OR NOT media_movie_rollback_asset_v1(m_after_b,m_scope,txid_current()::text,COALESCE(m_changed_b,ARRAY[]::text[])) THEN RAISE EXCEPTION 'Manual inverse complete actual assets/captions changed'; END IF;
  PERFORM media_movie_requested_rollback_caption_completion_v1(p_intent,p_proof);
  PERFORM media_movie_requested_rollback_inverse_v1(p_intent,p_proof);
  PERFORM media_movie_requested_rollback_owner_v1(p_command,p_intent->'access',(p_proof->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
END;
$$;

-- The original publication's inverse descriptors remain literal. The manual
-- B-caption namespace above must close independently before these ACKs exist.
CREATE FUNCTION media_movie_requested_rollback_inverse_v1(p_intent jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m_before_a jsonb:=p_intent->'predecessor'; m_before_b jsonb:=p_intent->'successor'; m_after_a jsonb:=p_proof->'predecessor'; m_after_b jsonb:=p_proof->'successor';
  m_original jsonb:=p_intent#>'{source,reference,intent,entries,0,predecessor}'; m_entry jsonb:=p_intent#>'{source,reference,intent,entries,0,entry}';
  m_source jsonb:=p_intent#>'{source,reference,intent}'; m_caption jsonb; m_restored jsonb; m_original_caption jsonb; m_sidecar jsonb;
  m_prefix integer; m_sidecars integer; m_expected text[]; m_index integer; m_effect jsonb; m_operation text; m_journal jsonb; m_manifest jsonb; m_participant jsonb;
BEGIN
  IF m_before_a->'subtitleHistory' IS DISTINCT FROM m_after_a->'subtitleHistory' OR jsonb_array_length(m_before_a->'subtitles')<>jsonb_array_length(m_after_a->'subtitles') THEN RAISE EXCEPTION 'Manual inverse changed independent A-caption history'; END IF;
  FOR m_caption IN SELECT c.value FROM jsonb_array_elements(m_before_a->'subtitles') AS c(value) LOOP
    SELECT c.value INTO STRICT m_restored FROM jsonb_array_elements(m_after_a->'subtitles') AS c(value) WHERE c.value->>'id'=m_caption->>'id';
    SELECT c.value INTO STRICT m_original_caption FROM jsonb_array_elements((m_original->'subtitles')||(m_original->'subtitleHistory')) AS c(value) WHERE c.value->>'id'=m_caption->>'id';
    IF NOT COALESCE(m_caption->>'state'='superseded' AND m_caption->'videoVersion'=m_before_a->'version' AND m_caption->>'videoChecksum'=m_before_a->>'checksum'
      AND m_caption->'ownershipEpoch'=p_intent#>'{authority,recoveryEpoch}'
      AND m_restored=m_caption||jsonb_build_object('version',(m_caption->>'version')::integer+1,'state','installed','videoVersion',(m_after_a->>'version')::integer,'path',m_original_caption->'path'),false)
    THEN RAISE EXCEPTION 'Manual inverse A-caption is not its original owned transition'; END IF;
  END LOOP;
  m_sidecars:=jsonb_array_length(m_entry->'previousSidecars'); m_prefix:=jsonb_array_length(p_intent#>'{source,outcome,effects}');
  IF jsonb_array_length(p_proof->'effects')<>m_prefix+4+3*m_sidecars OR jsonb_array_length(p_proof->'journals')<>1+m_sidecars
    OR jsonb_array_length(p_proof->'participants')<>6+2*m_sidecars+jsonb_array_length(m_entry->'embeddedSubtitles') THEN RAISE EXCEPTION 'Manual inverse effect/participant/journal inventory is incomplete'; END IF;
  m_expected:=ARRAY['recover-'||(m_before_b->>'id')];
  FOR m_sidecar IN SELECT c.value FROM jsonb_array_elements(m_entry->'previousSidecars') AS c(value) LOOP m_expected:=array_append(m_expected,'recover-'||(m_sidecar->>'quarantineId')); END LOOP;
  FOR m_index IN 0..jsonb_array_length(p_proof->'effects')-1 LOOP
    m_effect:=p_proof#>ARRAY['effects',m_index::text];
    IF (m_effect->>'ordinal')::integer<>m_index OR (m_index<m_prefix AND m_effect IS DISTINCT FROM p_intent#>ARRAY['source','outcome','effects',m_index::text])
      OR (m_index>=m_prefix AND (m_effect->>'libraryKind'<>'movies' OR NOT(m_effect->>'operationId'=ANY(m_expected)) OR m_effect->>'effectHash' !~ '^[a-f0-9]{64}$'))
    THEN RAISE EXCEPTION 'Manual inverse lost the literal original committed prefix'; END IF;
  END LOOP;
  FOREACH m_operation IN ARRAY m_expected LOOP
    SELECT c.value INTO STRICT m_journal FROM jsonb_array_elements(p_proof->'journals') AS c(value) WHERE c.value->>'path'='journal/'||m_operation||'.json';
    m_manifest:=(m_journal->>'raw')::jsonb;
    IF NOT COALESCE(encode(sha256(convert_to(m_journal->>'raw','UTF8')),'hex')=m_journal->>'sha256' AND octet_length(m_journal->>'raw')::text=m_journal->>'sizeBytes'
      AND m_manifest->>'operationId'=m_operation AND m_manifest->>'phase'='complete' AND jsonb_typeof(m_journal#>'{identity,ancestors}')='array'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'effects') AS c(value) WHERE c.value->>'operationId'=m_operation AND c.value->>'step'='journal_complete'),false)
    THEN RAISE EXCEPTION 'Manual inverse lacks its real completed original inverse journal'; END IF;
    IF m_operation='recover-'||(m_before_b->>'id') THEN
      IF NOT COALESCE(m_manifest->>'kind'='rollback' AND m_manifest->>'sha256'=m_before_a->>'checksum' AND m_manifest->>'previousSha256'=m_before_b->>'checksum'
        AND right(m_manifest->>'source',length('/rollback/'||(m_entry->>'operationId')))='/rollback/'||(m_entry->>'operationId')
        AND right(m_manifest->>'target',length(m_entry->>'libraryPath')+1)='/'||(m_entry->>'libraryPath'),false) THEN RAISE EXCEPTION 'Manual inverse video journal changed its real original pair'; END IF;
    ELSE
      SELECT c.value INTO STRICT m_sidecar FROM jsonb_array_elements(m_entry->'previousSidecars') AS c(value) WHERE 'recover-'||(c.value->>'quarantineId')=m_operation;
      IF NOT COALESCE(m_manifest->>'kind'='restore' AND m_manifest->>'sha256'=m_sidecar->>'checksum' AND m_manifest->'previousSha256'='null'::jsonb
        AND right(m_manifest->>'source',length('/quarantine/'||(m_sidecar->>'quarantineId')))='/quarantine/'||(m_sidecar->>'quarantineId')
        AND right(m_manifest->>'target',length(m_sidecar->>'libraryPath')+1)='/'||(m_sidecar->>'libraryPath'),false) THEN RAISE EXCEPTION 'Manual inverse sidecar journal changed its original descriptor'; END IF;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'participants') AS c(value) WHERE c.value->>'assetId'=m_after_a->>'id' AND c.value->'subtitleId'='null'::jsonb AND c.value#>>'{physical,root}'='library' AND c.value#>>'{physical,path}'=m_entry->>'libraryPath' AND c.value#>>'{physical,state}'='present' AND c.value#>>'{physical,sha256}'=m_after_a->>'checksum' AND c.value#>>'{physical,identity,inode}' ~ '^[0-9]+$')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'participants') AS c(value) WHERE c.value->>'assetId'=m_after_b->>'id' AND c.value#>>'{physical,root}'='control' AND c.value#>>'{physical,path}'='rollback/recover-'||(m_after_b->>'id') AND c.value#>>'{physical,state}'='present' AND c.value#>>'{physical,sha256}'=m_after_b->>'checksum' AND c.value#>>'{physical,identity,inode}' ~ '^[0-9]+$')
  THEN RAISE EXCEPTION 'Manual inverse omitted actual restored A or retained B'; END IF;
  IF (SELECT count(DISTINCT jsonb_build_array(c.value->>'assetId',c.value->'subtitleId',c.value->>'role',c.value#>>'{physical,root}',c.value#>>'{physical,path}')) FROM jsonb_array_elements(p_proof->'participants') AS c(value))<>jsonb_array_length(p_proof->'participants') THEN RAISE EXCEPTION 'Manual inverse repeated a physical participant'; END IF;
  FOR m_participant IN SELECT c.value FROM jsonb_array_elements(p_proof->'participants') AS c(value) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m_source#>'{entries,0,participants}') AS c(value)
      WHERE (c.value-'physical')=(m_participant-'physical') AND c.value#>'{physical,root}'=m_participant#>'{physical,root}' AND c.value#>'{physical,path}'=m_participant#>'{physical,path}')
      OR m_participant->>'libraryKind'<>'movies' OR m_participant#>>'{physical,state}' NOT IN ('present','absent')
    THEN RAISE EXCEPTION 'Manual inverse participant left the literal original plan'; END IF;
    IF m_participant#>>'{physical,root}'='library' AND m_participant->>'role' IN ('video','sidecar') THEN
      SELECT c.value INTO STRICT m_original_caption FROM jsonb_array_elements(m_source#>'{entries,0,participants}') AS c(value)
        WHERE (c.value-'physical')=(m_participant-'physical') AND c.value#>'{physical,root}'=m_participant#>'{physical,root}' AND c.value#>'{physical,path}'=m_participant#>'{physical,path}';
      IF NOT COALESCE(m_participant#>>'{physical,state}'='present' AND m_original_caption#>>'{physical,state}'='present'
        AND m_participant#>'{physical,sha256}'=m_original_caption#>'{physical,sha256}' AND m_participant#>'{physical,sizeBytes}'=m_original_caption#>'{physical,sizeBytes}'
        AND m_participant#>'{physical,identity,device}'=m_original_caption#>'{physical,identity,device}' AND m_participant#>'{physical,identity,inode}'=m_original_caption#>'{physical,identity,inode}',false)
      THEN RAISE EXCEPTION 'Manual inverse restored bytes lost their original inode'; END IF;
    END IF;
  END LOOP;
  SELECT c.value INTO STRICT m_original_caption FROM jsonb_array_elements(p_intent#>'{source,outcome,entries,0,participants}') AS c(value) WHERE c.value->>'assetId'=m_after_b->>'id' AND c.value->'subtitleId'='null'::jsonb AND c.value->>'role'='video' AND c.value#>>'{physical,root}'='library';
  SELECT c.value INTO STRICT m_participant FROM jsonb_array_elements(p_proof->'participants') AS c(value) WHERE c.value->>'assetId'=m_after_b->>'id' AND c.value->'subtitleId'='null'::jsonb AND c.value#>>'{physical,root}'='control' AND c.value#>>'{physical,path}'='rollback/recover-'||(m_after_b->>'id');
  IF NOT COALESCE(m_original_caption#>'{physical,identity,device}'=m_participant#>'{physical,identity,device}' AND m_original_caption#>'{physical,identity,inode}'=m_participant#>'{physical,identity,inode}'
    AND m_original_caption#>'{physical,sha256}'=m_participant#>'{physical,sha256}' AND m_original_caption#>'{physical,sizeBytes}'=m_participant#>'{physical,sizeBytes}',false)
  THEN RAISE EXCEPTION 'Manual inverse retained B lost its actual original inode'; END IF;
  FOR m_sidecar IN SELECT c.value FROM jsonb_array_elements(m_entry->'previousSidecars') AS c(value) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'participants') AS c(value) WHERE c.value->>'assetId'=m_after_a->>'id' AND c.value->>'subtitleId'=m_sidecar->>'subtitleId'
      AND c.value#>>'{physical,root}'='library' AND c.value#>>'{physical,path}'=m_sidecar->>'libraryPath' AND c.value#>>'{physical,state}'='present' AND c.value#>>'{physical,sha256}'=m_sidecar->>'checksum' AND c.value#>>'{physical,identity,inode}' ~ '^[0-9]+$')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'participants') AS c(value) WHERE c.value->>'assetId'=m_after_a->>'id' AND c.value->>'subtitleId'=m_sidecar->>'subtitleId'
        AND c.value#>>'{physical,root}'='control' AND c.value#>>'{physical,path}'='quarantine/'||(m_sidecar->>'quarantineId') AND c.value#>>'{physical,state}'='absent')
    THEN RAISE EXCEPTION 'Manual inverse omitted its actual restored original caption or quarantine closure'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_movie_requested_rollback_plex_birth_v1(p_command "Operation",p_intent jsonb,p_physical jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_scope jsonb:=p_intent->'scope'; v_expected jsonb:=p_proof->'expected'; v_association jsonb:=p_proof#>'{observation,associations,0}';
  v_group jsonb:=p_proof#>'{expected,newGroups,0}'; v_binding jsonb:=p_proof->'binding'; v_verification jsonb:=p_proof#>'{observation,verification}';
  v_reference jsonb:=p_proof->'publication'; v_original "PlexAssociationEvidence"; v_evidence "PlexAssociationEvidence";
  v_attempt "AcquisitionAttempt"; v_target "MediaIntent"; v_runtime "MediaRuntimeState"; v_writer "LegacyWriterLease"; v_media "MediaItem";
  v_pointer "PlexBindingCurrent"; v_claim "PlexClaimGroup"; v_member "PlexClaimGroupMember"; v_item "PlexItemClaim"; v_part "PlexPartClaim"; v_path "PlexPathClaim"; v_profile "QualityProfile";
  v_pointer_xmin text; v_evidence_xmin text; v_claim_xmin text; v_changed_captions text[]; v_capture record;
  m_review jsonb;
BEGIN
  m_review:=media_movie_requested_rollback_command_v1(p_command,v_scope);
  IF NOT COALESCE(p_intent#>>'{invocation,mode}'='manual_verified'
    AND (v_expected#>>'{targets,0,mediaVersion}')::integer=(m_review->>'mediaVersion')::integer+1
    AND v_expected#>'{targets,0,intentVersion}'=m_review->'targetVersion'
    AND v_expected#>'{targets,0,generation}'=m_review->'generation'
    AND v_expected->'recoveryEpoch'=m_review->'recoveryEpoch',false)
  THEN RAISE EXCEPTION 'Manual rollback rebind lost its distinct owner command CAS'; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=p_intent#>>'{invocation,source,attemptId}';
  SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT w.* INTO STRICT v_writer FROM "LegacyWriterLease" w WHERE w.id='singleton';
  SELECT m.* INTO STRICT v_media FROM "MediaItem" m WHERE m.id=v_scope->>'mediaId';
  SELECT p AS actual_row,p.xmin::text AS actual_xmin INTO STRICT v_capture FROM "PlexBindingCurrent" p WHERE p."mediaId"=v_scope->>'mediaId' AND p.edition=v_scope->>'edition';
  v_pointer:=v_capture.actual_row; v_pointer_xmin:=v_capture.actual_xmin;
  SELECT e.* INTO STRICT v_original FROM "PlexAssociationEvidence" e WHERE e.id=p_intent#>>'{originalItem,binding,evidenceId}';
  SELECT e AS actual_row,e.xmin::text AS actual_xmin INTO STRICT v_capture FROM "PlexAssociationEvidence" e WHERE e.id=v_binding->>'evidenceId';
  v_evidence:=v_capture.actual_row; v_evidence_xmin:=v_capture.actual_xmin;
  SELECT g AS actual_row,g.xmin::text AS actual_xmin INTO STRICT v_capture FROM "PlexClaimGroup" g WHERE g."serverMachineId"=v_evidence."serverMachineId" AND g."group"=v_group;
  v_claim:=v_capture.actual_row; v_claim_xmin:=v_capture.actual_xmin;
  SELECT m.* INTO STRICT v_member FROM "PlexClaimGroupMember" m WHERE m."groupId"=v_claim.id;
  SELECT i.* INTO STRICT v_item FROM "PlexItemClaim" i WHERE i."groupId"=v_claim.id;
  SELECT p.* INTO STRICT v_part FROM "PlexPartClaim" p WHERE p."groupId"=v_claim.id;
  SELECT p.* INTO STRICT v_path FROM "PlexPathClaim" p WHERE p."groupId"=v_claim.id;
  SELECT p.* INTO STRICT v_profile FROM "QualityProfile" p WHERE p.id=p_intent#>>'{authority,profileId}';
  IF NOT COALESCE(p_proof->'schemaVersion'='1'::jsonb AND p_proof->>'operationId'=p_command.id AND p_proof->>'intentId'=p_intent->>'id'
    AND p_proof->>'intentHash'=p_command.result#>>'{movieRollbackIntentV1,intentHash}' AND p_proof->>'physicalHash'=p_command.result#>>'{movieRollbackPhysicalV1,receiptHash}'
    AND p_proof->'invocation'=p_intent->'invocation' AND v_reference->>'kind'='movie_rollback_publication_v1' AND v_reference->'scope'=v_scope
    AND v_reference->>'operationId'=p_command.id AND v_reference->>'intentId'=p_intent->>'id' AND v_reference->>'intentHash'=p_proof->>'intentHash'
    AND v_reference->>'physicalHash'=p_proof->>'physicalHash' AND v_reference->>'assetId'=p_physical#>>'{predecessor,id}' AND v_reference->'assetVersion'=p_physical#>'{predecessor,version}'
    AND v_reference->>'bindingHash'=p_physical->>'bindingHash' AND v_reference->>'physicalEvidenceHash'=p_physical->>'physicalEvidenceHash'
    AND v_expected->'schemaVersion'='4'::jsonb AND v_expected#>'{parents,0,reference}'=v_reference AND v_expected#>>'{parents,0,kind}'='movie_rollback_publication_v1'
    AND jsonb_array_length(v_expected->'parents')=1 AND jsonb_array_length(v_expected->'targets')=1 AND jsonb_array_length(v_expected->'newGroups')=1 AND jsonb_array_length(v_expected->'previous')=1
    AND v_expected->'oldGroups'='[]'::jsonb AND v_expected->'originalItem'=p_intent->'originalItem' AND v_expected#>'{previous,0}'=p_physical->'retiredPointer'
    AND v_expected#>'{targets,0,scope}'=v_scope-'rootMediaId' AND v_expected#>>'{targets,0,editionRootId}'=v_scope->>'rootMediaId'
    AND v_expected#>'{targets,0,generation}'=p_intent#>'{authority,generation}' AND v_expected#>'{targets,0,intentVersion}'=to_jsonb(v_target.version)
    AND (v_expected#>>'{targets,0,mediaVersion}')::integer+1=v_media.version
    AND v_group->>'assetId'=p_physical#>>'{predecessor,id}' AND v_group->'assetVersion'=p_physical#>'{predecessor,version}'
    AND v_group->>'checksum'=p_physical#>>'{predecessor,checksum}' AND v_group->>'sizeBytes'=p_physical#>>'{predecessor,sizeBytes}' AND v_group->>'canonicalPath'=p_physical#>>'{predecessor,path}'
    AND v_group->'ownershipEpoch'=p_intent#>'{authority,recoveryEpoch}' AND v_group->>'canonicalRootId'=v_scope->>'rootMediaId' AND v_group->>'edition'=v_scope->>'edition'
    AND v_group->'coverage'=jsonb_build_array(v_scope-'rootMediaId') AND v_association->'group'=v_group AND v_association->'scope'=v_scope-'rootMediaId'
    AND v_association->'schemaVersion'='2'::jsonb AND v_association->>'kind'='movie' AND v_association->>'editionRootId'=v_scope->>'rootMediaId'
    AND v_association->'access'=p_intent->'originalAccess' AND v_expected->'access'=jsonb_build_array(v_association->'access')
    AND v_association->>'canonicalIdentityHash'=v_expected#>>'{targets,0,canonicalIdentityHash}' AND v_association->>'numberingHash'=v_expected#>>'{targets,0,numberingHash}' AND v_association->'definition'=v_expected#>'{targets,0,definition}'
    AND v_association#>'{item,ratingKey}'=p_intent#>'{originalItem,ratingKey}' AND v_association#>'{item,media,0,parts,0,id}'=p_intent#>'{originalItem,part,id}' AND v_association#>'{item,media,0,parts,0,file}'=p_intent#>'{originalItem,part,file}'
    AND v_original."associationHash"=p_intent#>>'{originalItem,binding,associationHash}' AND v_original.evidence->'access'=v_association->'access'
    AND v_evidence.evidence=v_association AND v_evidence."associationHash"=v_binding->>'associationHash' AND v_evidence."assetId"=v_group->>'assetId'
    AND v_evidence."mediaId"=v_scope->>'mediaId' AND v_evidence.edition=v_scope->>'edition' AND v_evidence."serverMachineId"=p_intent#>>'{access,serverMachineId}'
    AND v_binding->'scope'=v_scope-'rootMediaId' AND (v_binding->>'revision')::integer=(p_physical#>>'{retiredPointer,revision}')::integer+1
    AND v_pointer."evidenceId"=v_evidence.id AND v_pointer."associationHash"=v_evidence."associationHash" AND to_jsonb(v_pointer.revision)=v_binding->'revision'
    AND (v_pointer."verifiedStartedAt" AT TIME ZONE 'UTC')=(v_verification->>'startedAt')::timestamptz AND (v_pointer."verifiedCompletedAt" AT TIME ZONE 'UTC')=(v_verification->>'completedAt')::timestamptz
    AND v_attempt.state=p_intent#>>'{source,state}' AND v_attempt."coordinatorOperationId"=p_intent#>>'{invocation,source,operationId}' AND v_attempt."recoveryEpoch"=v_runtime."recoveryEpoch"
    AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_target.availability='available' AND v_target.monitoring AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL
    AND to_jsonb(v_target.generation)=p_intent#>'{authority,generation}' AND v_target."automationEpoch"=v_attempt."recoveryEpoch"
    AND v_target."profileId"=v_profile.id AND to_jsonb(v_profile.version)=p_intent#>'{authority,profileVersion}'
    AND v_writer."recoveryEpoch"=v_attempt."recoveryEpoch" AND v_writer."revokedAt" IS NULL AND (v_writer."observedAt" AT TIME ZONE 'UTC')<=clock_timestamp() AND (v_writer."expiresAt" AT TIME ZONE 'UTC')=(p_proof->>'writerExpiresAt')::timestamptz
    AND (p_proof->>'assetPlexPublishedAt') IS NOT DISTINCT FROM (p_physical#>>'{predecessor,plexPublishedAt}')
    AND v_member."mediaId"=v_scope->>'mediaId' AND v_member.edition=v_scope->>'edition' AND v_member."evidenceId"=v_evidence.id AND v_member."associationHash"=v_evidence."associationHash"
    AND v_item."mediaId"=v_scope->>'mediaId' AND v_item.edition=v_scope->>'edition' AND v_item."evidenceId"=v_evidence.id AND v_item."associationHash"=v_evidence."associationHash"
    AND v_item."serverMachineId"=v_evidence."serverMachineId" AND v_item."sectionId"=v_association#>>'{access,sectionId}' AND v_item."ratingKey"=v_association#>>'{item,ratingKey}'
    AND v_part."serverMachineId"=v_evidence."serverMachineId" AND v_part."partId"=p_intent#>>'{originalItem,part,id}' AND v_part."canonicalPath"=v_group->>'canonicalPath'
    AND v_path."serverMachineId"=v_evidence."serverMachineId" AND v_path."canonicalPath"=v_group->>'canonicalPath'
    AND v_pointer_xmin=(txid_current()%4294967296)::text AND v_evidence_xmin=(txid_current()%4294967296)::text AND v_claim_xmin=(txid_current()%4294967296)::text
    AND (p_proof#>>'{sdk,observedAt}')::timestamptz<=(v_verification->>'startedAt')::timestamptz AND (v_verification->>'completedAt')::timestamptz>=(v_verification->>'startedAt')::timestamptz
    AND (v_verification->>'expiresAt')::timestamptz<=(p_proof#>>'{sdk,expiresAt}')::timestamptz AND (v_verification->>'expiresAt')::timestamptz<=(p_proof#>>'{sdk,observedAt}')::timestamptz+interval '60 seconds'
    AND (v_verification->>'expiresAt')::timestamptz<=(v_writer."expiresAt" AT TIME ZONE 'UTC') AND (p_proof->>'reboundAt')::timestamptz>=(v_verification->>'completedAt')::timestamptz
    AND (p_proof->>'committedAt')::timestamptz>=(p_proof->>'reboundAt')::timestamptz AND (p_proof->>'committedAt')::timestamptz<(v_verification->>'expiresAt')::timestamptz
    AND (p_proof->>'committedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (p_proof->>'committedAt')::timestamptz<=clock_timestamp()
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (v_verification->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Movie rollback Plex completion lost its actual same-transaction serving closure'; END IF;
  IF EXISTS(SELECT 1 FROM "AcquisitionReservation" r WHERE r."mediaId"=v_scope->>'mediaId' AND r.edition=v_scope->>'edition') THEN RAISE EXCEPTION 'Movie rollback serving must release only its completed source reservation'; END IF;
  SELECT array_agg(e.value->>'id') INTO v_changed_captions FROM jsonb_array_elements(p_physical#>'{predecessor,subtitles}') AS e(value);
  IF NOT media_movie_rollback_asset_v1(p_physical->'predecessor',v_scope,p_physical->>'transactionId',COALESCE(v_changed_captions,ARRAY[]::text[])) OR NOT media_movie_rollback_asset_v1(p_physical->'successor',v_scope,p_physical->>'transactionId') THEN RAISE EXCEPTION 'Movie rollback Plex current physical and caption parents changed'; END IF;
  PERFORM media_movie_requested_rollback_owner_v1(p_command,p_intent->'access',(v_verification->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_rollback_operation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_marker text; v_envelope jsonb; v_body jsonb; v_event "ApplicationEvent"; v_receipt jsonb; v_attempt_id text; v_event_xmin text; v_capture record; v_shape jsonb; v_manual boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ?| ARRAY['movieRollbackRejectionV1','movieRollbackIntentV1','movieRollbackPhysicalV1','movieRollbackPlexV1'] THEN RAISE EXCEPTION 'Movie rollback source and immutable records must survive'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ?| ARRAY['movieRollbackIntentV1','movieRollbackPhysicalV1','movieRollbackPlexV1'] THEN
    IF (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload,OLD."createdAt") THEN RAISE EXCEPTION 'Movie rollback command is immutable'; END IF;
    IF NEW.result->'movieRollbackRejectionV1' IS DISTINCT FROM OLD.result->'movieRollbackRejectionV1' THEN RAISE EXCEPTION 'Movie rollback retains its actual admitted rejection pointer'; END IF;
  END IF;
  FOREACH v_marker IN ARRAY ARRAY['movieRollbackIntentV1','movieRollbackPhysicalV1','movieRollbackPlexV1'] LOOP
    IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? v_marker THEN
      IF NEW.result->v_marker IS DISTINCT FROM OLD.result->v_marker THEN RAISE EXCEPTION 'Movie rollback intent, physical and Plex records are immutable'; END IF;
    ELSIF COALESCE(NEW.result,'{}'::jsonb) ? v_marker THEN
      v_envelope:=NEW.result->v_marker; v_body:=CASE WHEN v_marker='movieRollbackIntentV1' THEN v_envelope->'intent' ELSE v_envelope->'receipt' END;
      v_shape:=v_body;
      v_manual:=NEW.kind='rollback_movie_edition_v1' AND NEW.result#>>'{movieRollbackIntentV1,intent,invocation,mode}'='manual_verified';
      IF v_manual AND v_marker='movieRollbackIntentV1' THEN
        IF NOT COALESCE(v_body ?& ARRAY['playback','captionManifest','captionManifestRaw','successorGrantRaw'],false) THEN RAISE EXCEPTION 'Manual admission requires its complete named playback/caption/grant parents'; END IF;
        v_shape:=v_body-ARRAY['playback','captionManifest','captionManifestRaw','successorGrantRaw'];
      ELSIF v_manual AND v_marker='movieRollbackPhysicalV1' THEN
        IF NOT COALESCE(v_body ?& ARRAY['playback','successorCaptions'],false) THEN RAISE EXCEPTION 'Manual inverse requires its actual playback and complete B-caption closure'; END IF;
        v_shape:=v_body-ARRAY['playback','successorCaptions'];
      END IF;
      IF NOT COALESCE(jsonb_typeof(v_envelope)='object' AND (v_envelope->>'raw')::jsonb=v_body
        AND encode(sha256(convert_to(v_envelope->>'raw','UTF8')),'hex')=CASE WHEN v_marker='movieRollbackIntentV1' THEN v_envelope->>'intentHash' ELSE v_envelope->>'receiptHash' END
        AND v_body->'schemaVersion'='1'::jsonb AND v_body->>'transactionId'=txid_current()::text,false)
      THEN RAISE EXCEPTION 'Movie rollback record requires its exact canonical bytes and actual transaction birth'; END IF;
      IF v_marker='movieRollbackIntentV1' THEN
        IF NOT COALESCE(v_envelope ?& ARRAY['intent','intentHash','raw'] AND v_envelope-ARRAY['intent','intentHash','raw']='{}'::jsonb
          AND v_shape ?& ARRAY['schemaVersion','id','transactionId','operationId','scope','invocation','command','source','rejection','predecessor','successor','successorGrant','originalItem','originalAccess','pointer','access','authority','cleanup','observedAt','sdkExpiresAt','expiresAt','admittedAt','owner']
          AND v_shape-ARRAY['schemaVersion','id','transactionId','operationId','scope','invocation','command','source','rejection','predecessor','successor','successorGrant','originalItem','originalAccess','pointer','access','authority','cleanup','observedAt','sdkExpiresAt','expiresAt','admittedAt','owner']='{}'::jsonb,false)
        THEN RAISE EXCEPTION 'Movie rollback admission shape changed'; END IF;
      ELSIF v_marker='movieRollbackPhysicalV1' THEN
        IF NOT COALESCE(v_envelope ?& ARRAY['receipt','receiptHash','raw'] AND v_envelope-ARRAY['receipt','receiptHash','raw']='{}'::jsonb
          AND v_shape ?& ARRAY['schemaVersion','transactionId','operationId','intentId','intentHash','scope','predecessor','successor','bindingRaw','bindingHash','physicalEvidenceRaw','physicalEvidenceHash','retiredPointer','effects','participants','journals','observedAt','sdkExpiresAt','expiresAt','committedAt']
          AND v_shape-ARRAY['schemaVersion','transactionId','operationId','intentId','intentHash','scope','predecessor','successor','bindingRaw','bindingHash','physicalEvidenceRaw','physicalEvidenceHash','retiredPointer','effects','participants','journals','observedAt','sdkExpiresAt','expiresAt','committedAt']='{}'::jsonb
          AND NEW.result#>>'{movieRollbackIntentV1,intent,transactionId}'<>txid_current()::text,false)
        THEN RAISE EXCEPTION 'Movie rollback physical completion requires its separate actual admission'; END IF;
      ELSE
        IF NOT COALESCE(v_envelope ?& ARRAY['receipt','receiptHash','raw'] AND v_envelope-ARRAY['receipt','receiptHash','raw']='{}'::jsonb
          AND v_shape ?& ARRAY['schemaVersion','transactionId','operationId','invocation','intentId','intentHash','physicalHash','publication','expected','observation','binding','sdk','writerExpiresAt','assetPlexPublishedAt','reboundAt','committedAt']
          AND v_shape-ARRAY['schemaVersion','transactionId','operationId','invocation','intentId','intentHash','physicalHash','publication','expected','observation','binding','sdk','writerExpiresAt','assetPlexPublishedAt','reboundAt','committedAt']='{}'::jsonb
          AND NEW.result#>>'{movieRollbackPhysicalV1,receipt,transactionId}'<>txid_current()::text,false)
        THEN RAISE EXCEPTION 'Movie rollback serving requires its separate actual physical completion'; END IF;
      END IF;
    END IF;
  END LOOP;
  IF NEW.result->'movieRollbackRejectionV1' IS DISTINCT FROM (CASE WHEN TG_OP='UPDATE' THEN OLD.result->'movieRollbackRejectionV1' ELSE NULL END) THEN
    v_envelope:=NEW.result->'movieRollbackRejectionV1';
    IF NOT COALESCE(v_envelope ?& ARRAY['eventId','receiptHash'] AND v_envelope-ARRAY['eventId','receiptHash']='{}'::jsonb,false) THEN RAISE EXCEPTION 'Movie rejection pointer shape changed'; END IF;
    SELECT e AS actual_row,e.xmin::text AS actual_xmin INTO STRICT v_capture FROM "ApplicationEvent" e WHERE e.id=v_envelope->>'eventId';
    v_event:=v_capture.actual_row; v_event_xmin:=v_capture.actual_xmin;
    v_receipt:=v_event.payload->'receipt';
    IF NOT COALESCE(v_event.kind='movie_plex_rejected_v1' AND v_event.payload->>'receiptHash'=v_envelope->>'receiptHash'
      AND v_receipt#>>'{input,operationId}'=NEW.id AND v_receipt#>>'{command,kind}'=NEW.kind AND v_receipt#>>'{command,targetId}'=NEW."targetId"
      AND v_receipt->>'transactionId'=txid_current()::text
      AND v_event_xmin=(txid_current()%4294967296)::text,false)
    THEN RAISE EXCEPTION 'Movie rejection pointer requires its same-transaction actual immutable observation'; END IF;
  END IF;
  FOREACH v_marker IN ARRAY ARRAY['moviePlexReceiptV2','moviePlexReceiptV3'] LOOP
    IF COALESCE(NEW.result,'{}'::jsonb) ? v_marker AND NOT(CASE WHEN TG_OP='UPDATE' THEN COALESCE(OLD.result,'{}'::jsonb) ? v_marker ELSE false END) THEN
      v_attempt_id:=NEW.result#>>ARRAY[v_marker,'receipt','input','attemptId'];
      IF EXISTS(SELECT 1 FROM "Operation" o WHERE o.result#>>'{movieRollbackIntentV1,intent,invocation,source,attemptId}'=v_attempt_id) THEN RAISE EXCEPTION 'Admitted rollback prevents a delayed original B serving receipt'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Existing automatic functions retain their complete literal bodies. Dispatch
-- recognizes only the two explicitly supported rollback purposes.
ALTER FUNCTION media_movie_rollback_intent_birth_v1("Operation",jsonb) RENAME TO media_movie_automatic_rollback_intent_birth_v1;
CREATE FUNCTION media_movie_rollback_intent_birth_v1(p_command "Operation",p_intent jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_intent#>>'{invocation,mode}'='automatic_failed_plex' THEN PERFORM media_movie_automatic_rollback_intent_birth_v1(p_command,p_intent);
  ELSIF p_intent#>>'{invocation,mode}'='manual_verified' THEN PERFORM media_movie_requested_rollback_intent_birth_v1(p_command,p_intent);
  ELSE RAISE EXCEPTION 'Unknown movie rollback admission purpose'; END IF;
END;
$$;
ALTER FUNCTION media_movie_rollback_physical_birth_v1("Operation",jsonb,jsonb) RENAME TO media_movie_automatic_rollback_physical_birth_v1;
CREATE FUNCTION media_movie_rollback_physical_birth_v1(p_command "Operation",p_intent jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_intent#>>'{invocation,mode}'='automatic_failed_plex' THEN PERFORM media_movie_automatic_rollback_physical_birth_v1(p_command,p_intent,p_proof);
  ELSIF p_intent#>>'{invocation,mode}'='manual_verified' THEN PERFORM media_movie_requested_rollback_physical_birth_v1(p_command,p_intent,p_proof);
  ELSE RAISE EXCEPTION 'Unknown movie rollback physical purpose'; END IF;
END;
$$;
ALTER FUNCTION media_movie_rollback_plex_birth_v1("Operation",jsonb,jsonb,jsonb) RENAME TO media_movie_automatic_rollback_plex_birth_v1;
CREATE FUNCTION media_movie_rollback_plex_birth_v1(p_command "Operation",p_intent jsonb,p_physical jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_intent#>>'{invocation,mode}'='automatic_failed_plex' THEN PERFORM media_movie_automatic_rollback_plex_birth_v1(p_command,p_intent,p_physical,p_proof);
  ELSIF p_intent#>>'{invocation,mode}'='manual_verified' THEN PERFORM media_movie_requested_rollback_plex_birth_v1(p_command,p_intent,p_physical,p_proof);
  ELSE RAISE EXCEPTION 'Unknown movie rollback rebind purpose'; END IF;
END;
$$;

CREATE FUNCTION media_movie_requested_rollback_cleanup_literal_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m_ids text[]; m_row record; m_count integer:=0; m_intent jsonb; m_original jsonb;
BEGIN
  IF TG_OP='DELETE' THEN m_ids:=ARRAY[OLD.id]; ELSE m_ids:=ARRAY[OLD.id,NEW.id]; END IF;
  FOR m_row IN SELECT o.id,o.result FROM "Operation" o WHERE o.result#>>'{movieRollbackIntentV1,intent,invocation,mode}'='manual_verified'
    AND o.result#>>'{movieRollbackIntentV1,intent,cleanup,id}'=ANY(m_ids) LOOP
    m_count:=m_count+1; m_intent:=m_row.result#>'{movieRollbackIntentV1,intent}'; m_original:=m_intent->'cleanup';
    IF m_count>1 OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Admitted manual rollback retains its exact original cleanup row'; END IF;
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      IF NOT COALESCE(m_intent->>'transactionId'=txid_current()::text AND OLD.state='pending' AND NEW.state='cancelled'
        AND OLD.id=m_original->>'id' AND OLD.version=(m_original->>'version')::integer AND NEW.version=OLD.version+1
        AND (OLD."expiresAt" AT TIME ZONE 'UTC')=(m_original->>'expiresAt')::timestamptz AND OLD."assetId"=m_intent#>>'{predecessor,id}' AND OLD."successorAssetId"=m_intent#>>'{successor,id}'
        AND (to_jsonb(NEW)-ARRAY['state','version'])=(to_jsonb(OLD)-ARRAY['state','version']),false)
      THEN RAISE EXCEPTION 'Manual rollback cannot renew, move or rewrite its original cleanup window'; END IF;
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_requested_rollback_cleanup_literal_v1 AFTER UPDATE OR DELETE ON "UpgradeCleanup" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_requested_rollback_cleanup_literal_v1();

CREATE FUNCTION media_movie_rollback_pending_replacement_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reservationActive" AND EXISTS(SELECT 1 FROM "Operation" o WHERE NOT(COALESCE(o.result,'{}'::jsonb)?'movieRollbackPlexV1')
    AND (o.result#>>'{movieRollbackIntentV1,intent,predecessor,id}'=NEW."assetId" OR o.result#>>'{movieRollbackIntentV1,intent,successor,id}'=NEW."assetId"))
  THEN RAISE EXCEPTION 'Pending movie rollback owns its actual caption participant reservations'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_rollback_pending_replacement_v1 BEFORE INSERT OR UPDATE ON "SubtitleReplacement" FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_pending_replacement_v1();

-- A retry changes only the executor. Original admission, physical and Plex
-- receipts remain literal; current execution authority has its own exact birth.
CREATE FUNCTION media_movie_rollback_retry_command_v1(h_command "Operation",h_intent jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE h_payload jsonb:=h_command.payload; h_request jsonb:=h_command.payload->'retry'; h_scope jsonb:=h_intent->'scope';
BEGIN
  IF NOT COALESCE(h_command.kind='rollback_movie_edition_v1' AND h_command."targetId"=h_scope->>'mediaId' AND h_command."userId"=h_payload->>'actorId'
    AND h_payload ?& ARRAY['schemaVersion','operationId','sourceAttemptId','scope','resume','kind','mediaId','generation','recoveryEpoch','actorId','source','invocation','retry']
    AND (h_payload-ARRAY['schemaVersion','operationId','sourceAttemptId','scope','resume','kind','mediaId','generation','recoveryEpoch','actorId','source','invocation','retry'])='{}'::jsonb
    AND h_payload->'schemaVersion'='1'::jsonb AND h_payload->>'operationId'=h_command.id AND h_payload->>'kind'=h_command.kind
    AND h_payload->'scope'=h_scope AND h_payload->>'mediaId'=h_scope->>'mediaId'
    AND h_payload->'source'=h_intent#>'{invocation,source}' AND h_payload->'invocation'=h_intent->'invocation'
    AND h_payload->>'sourceAttemptId'=h_intent#>>'{invocation,source,attemptId}'
    AND h_payload->'resume'=jsonb_build_object('operationId',h_intent->>'operationId','intentHash',h_request#>>'{resume,intentHash}')
    AND h_payload->'resume'=h_request->'resume' AND h_request->'scope'=h_scope AND h_request->'schemaVersion'='1'::jsonb
    AND h_request->>'sourceAttemptId'=h_payload->>'sourceAttemptId'
    AND h_request ?& ARRAY['schemaVersion','scope','sourceAttemptId','resume','expected','reason','confirmResumeAdmittedRollback']
    AND (h_request-ARRAY['schemaVersion','scope','sourceAttemptId','resume','expected','reason','confirmResumeAdmittedRollback'])='{}'::jsonb
    AND h_request->'confirmResumeAdmittedRollback'='true'::jsonb AND length(btrim(h_request->>'reason')) BETWEEN 10 AND 2000
    AND h_request->'expected' ?& ARRAY['mediaVersion','targetVersion','generation','recoveryEpoch','predecessor','successor','pointer','physicalHash','previousHandoff','originalCleanup']
    AND ((h_request->'expected')-ARRAY['mediaVersion','targetVersion','generation','recoveryEpoch','predecessor','successor','pointer','physicalHash','previousHandoff','originalCleanup'])='{}'::jsonb
    AND h_payload->'generation'=h_request#>'{expected,generation}' AND h_payload->'recoveryEpoch'=h_request#>'{expected,recoveryEpoch}'
    AND h_request#>'{expected,originalCleanup}'=h_intent->'cleanup',false)
  THEN RAISE EXCEPTION 'Movie rollback retry requires its distinct exact owner command'; END IF;
  RETURN h_request->'expected';
END;
$$;

CREATE FUNCTION media_movie_rollback_handoff_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h_envelope jsonb:=NEW.payload; h_body jsonb:=NEW.payload->'handoff'; h_scope jsonb:=NEW.payload#>'{handoff,scope}';
  h_original "Operation"; h_command "Operation"; h_intent jsonb; h_review jsonb; h_physical jsonb; h_previous "ApplicationEvent";
  h_media "MediaItem"; h_target "MediaIntent"; h_runtime "MediaRuntimeState"; h_profile "QualityProfile"; h_writer "LegacyWriterLease";
  h_pointer "PlexBindingCurrent"; h_pointer_body jsonb; h_cleanup "UpgradeCleanup"; h_before_owner jsonb; h_previous_ref jsonb; h_ref jsonb;
BEGIN
  IF NEW.kind<>'movie_rollback_owner_handoff_v1' THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT o.* INTO STRICT h_original FROM "Operation" o WHERE o.id=h_body->>'operationId';
  SELECT o.* INTO STRICT h_command FROM "Operation" o WHERE o.id=h_body#>>'{input,operationId}';
  h_intent:=h_original.result#>'{movieRollbackIntentV1,intent}'; h_physical:=h_original.result#>'{movieRollbackPhysicalV1,receipt}';
  h_review:=media_movie_rollback_retry_command_v1(h_command,h_intent);
  SELECT m.* INTO STRICT h_media FROM "MediaItem" m WHERE m.id=h_scope->>'mediaId';
  SELECT t.* INTO STRICT h_target FROM "MediaIntent" t WHERE t."mediaId"=h_scope->>'mediaId' AND t.edition=h_scope->>'edition';
  SELECT r.* INTO STRICT h_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT p.* INTO STRICT h_profile FROM "QualityProfile" p WHERE p.id=h_intent#>>'{authority,profileId}';
  SELECT w.* INTO STRICT h_writer FROM "LegacyWriterLease" w WHERE w.id='singleton';
  SELECT p.* INTO STRICT h_pointer FROM "PlexBindingCurrent" p WHERE p."mediaId"=h_scope->>'mediaId' AND p.edition=h_scope->>'edition';
  h_pointer_body:=jsonb_build_object('scope',h_scope-'rootMediaId','revision',h_pointer.revision,'evidence',
    CASE WHEN h_pointer."evidenceId" IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',h_pointer."evidenceId",'associationHash',h_pointer."associationHash") END);
  h_previous_ref:=h_body->'previous'; h_ref:=jsonb_build_object('eventId',NEW.id,'handoffHash',h_envelope->>'handoffHash');
  IF h_previous_ref='null'::jsonb THEN h_before_owner:=h_intent->'owner';
  ELSE
    SELECT e.* INTO STRICT h_previous FROM "ApplicationEvent" e WHERE e.id=h_previous_ref->>'eventId';
    IF NOT COALESCE(h_previous.kind='movie_rollback_owner_handoff_v1' AND h_previous.payload->>'handoffHash'=h_previous_ref->>'handoffHash'
      AND h_previous.payload#>>'{handoff,operationId}'=h_original.id AND h_previous.payload#>>'{handoff,intentHash}'=h_body->>'intentHash',false)
    THEN RAISE EXCEPTION 'Movie rollback handoff lost its actual previous execution parent'; END IF;
    h_before_owner:=h_previous.payload#>'{handoff,owner}';
  END IF;
  IF NOT COALESCE(h_envelope ?& ARRAY['handoff','handoffHash','raw'] AND (h_envelope-ARRAY['handoff','handoffHash','raw'])='{}'::jsonb
    AND (h_envelope->>'raw')::jsonb=h_body AND encode(sha256(convert_to(h_envelope->>'raw','UTF8')),'hex')=h_envelope->>'handoffHash'
    AND h_body ?& ARRAY['schemaVersion','id','transactionId','operationId','intentId','intentHash','scope','input','commandHash','commandRaw','actorId','expected','predecessor','predecessorRaw','successor','successorRaw','previous','previousOwner','closedOwner','closedSourceRoot','owner','observedAt','sdkExpiresAt','writerExpiresAt','expiresAt','grantedAt']
    AND (h_body-ARRAY['schemaVersion','id','transactionId','operationId','intentId','intentHash','scope','input','commandHash','commandRaw','actorId','expected','predecessor','predecessorRaw','successor','successorRaw','previous','previousOwner','closedOwner','closedSourceRoot','owner','observedAt','sdkExpiresAt','writerExpiresAt','expiresAt','grantedAt'])='{}'::jsonb
    AND h_body->'schemaVersion'='1'::jsonb AND h_body->>'transactionId'=txid_current()::text AND h_body->>'id'=NEW.id
    AND NEW."dedupeKey"='movie-rollback-owner-v1:'||NEW.id AND NEW."mediaId"=h_scope->>'mediaId' AND NEW."actorId"=h_command."userId"
    AND h_body->>'actorId'=h_command."userId" AND h_scope=h_intent->'scope' AND h_body->>'intentId'=h_intent->>'id'
    AND h_body->>'intentHash'=h_original.result#>>'{movieRollbackIntentV1,intentHash}' AND h_body#>'{input,resume}'=h_command.payload->'resume'
    AND h_body->'input'=jsonb_build_object('schemaVersion',1,'operationId',h_command.id,'sourceAttemptId',h_command.payload->>'sourceAttemptId','scope',h_scope,'resume',h_command.payload->'resume')
    AND (h_body->>'commandRaw')::jsonb=h_command.payload AND encode(sha256(convert_to(h_body->>'commandRaw','UTF8')),'hex')=h_body->>'commandHash'
    AND h_body->'expected'=h_review AND h_review->'previousHandoff'=h_previous_ref
    AND h_review->'physicalHash'=COALESCE(h_original.result#>'{movieRollbackPhysicalV1,receiptHash}','null'::jsonb)
    AND h_body->'predecessor'=COALESCE(h_physical->'predecessor',h_intent->'predecessor') AND h_body->'successor'=COALESCE(h_physical->'successor',h_intent->'successor')
    AND (h_body->>'predecessorRaw')::jsonb=h_body->'predecessor' AND (h_body->>'successorRaw')::jsonb=h_body->'successor'
    AND h_review->'predecessor'=jsonb_build_object('id',h_body#>>'{predecessor,id}','version',h_body#>'{predecessor,version}','checksum',h_body#>>'{predecessor,checksum}','snapshotHash',encode(sha256(convert_to(h_body->>'predecessorRaw','UTF8')),'hex'))
    AND h_review->'successor'=jsonb_build_object('id',h_body#>>'{successor,id}','version',h_body#>'{successor,version}','checksum',h_body#>>'{successor,checksum}','snapshotHash',encode(sha256(convert_to(h_body->>'successorRaw','UTF8')),'hex'))
    AND h_review->'pointer'=h_pointer_body AND h_pointer_body=COALESCE(h_physical->'retiredPointer',h_intent->'pointer')
    AND h_review->'mediaVersion'=to_jsonb(h_media.version) AND h_review->'targetVersion'=to_jsonb(h_target.version)
    AND h_review->'generation'=to_jsonb(h_target.generation) AND h_review->'generation'=h_intent#>'{authority,generation}'
    AND h_review->'recoveryEpoch'=to_jsonb(h_runtime."recoveryEpoch") AND h_review->'recoveryEpoch'=h_intent#>'{authority,recoveryEpoch}'
    AND h_runtime.mode='active' AND h_runtime."ownershipConfirmed" AND h_target."automationEpoch"=h_runtime."recoveryEpoch"
    AND h_target.monitoring AND h_target."desiredPresence" AND h_target."intentionallyRemovedAt" IS NULL AND h_target."editionRootId"=h_scope->>'rootMediaId'
    AND h_target."profileId"=h_profile.id AND to_jsonb(h_profile.version)=h_intent#>'{authority,profileVersion}'
    AND h_body->'previousOwner'=h_before_owner AND h_body#>>'{closedOwner,workflowId}'=h_before_owner->>'workflowId' AND h_body#>>'{closedOwner,runId}'=h_before_owner->>'runId'
    AND (h_body->'closedOwner') ?& ARRAY['workflowId','runId','status'] AND ((h_body->'closedOwner')-ARRAY['workflowId','runId','status'])='{}'::jsonb
    AND h_body#>>'{closedOwner,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND h_body#>>'{owner,workflowId}'='media-operation-'||h_command.id AND length(h_body#>>'{owner,runId}')>0 AND length(h_body#>>'{owner,activityId}')>0
    AND (h_body->'owner') ?& ARRAY['workflowId','runId','activityId'] AND ((h_body->'owner')-ARRAY['workflowId','runId','activityId'])='{}'::jsonb
    AND h_body#>>'{owner,runId}'<>h_before_owner->>'runId' AND h_command.id<>h_original.id
    AND h_original.result->'movieRollbackOwnerV1'=h_ref AND h_command.result->'movieRollbackHandoffV1'=h_ref
    AND NOT(COALESCE(h_original.result,'{}'::jsonb)?'movieRollbackPlexV1')
    AND h_writer."revokedAt" IS NULL AND h_writer."recoveryEpoch"=h_runtime."recoveryEpoch"
    AND (h_writer."observedAt" AT TIME ZONE 'UTC')<=clock_timestamp() AND (h_writer."expiresAt" AT TIME ZONE 'UTC')=(h_body->>'writerExpiresAt')::timestamptz
    AND (h_body->>'grantedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (h_body->>'grantedAt')::timestamptz<=clock_timestamp()
    AND (h_body->>'grantedAt')::timestamptz>=(h_body->>'observedAt')::timestamptz AND (h_body->>'grantedAt')::timestamptz<(h_body->>'expiresAt')::timestamptz
    AND (h_body->>'expiresAt')::timestamptz<=LEAST((h_body->>'sdkExpiresAt')::timestamptz,(h_body->>'observedAt')::timestamptz+interval '60 seconds',(h_writer."expiresAt" AT TIME ZONE 'UTC'))
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (h_body->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Movie rollback ownership handoff lost its actual original inverse, current review or new SDK executor'; END IF;
  IF h_previous_ref='null'::jsonb AND h_intent#>>'{invocation,mode}'='automatic_failed_plex' THEN
    IF NOT COALESCE(h_body#>>'{closedOwner,workflowId}'='media-acquire-'||(h_intent#>>'{invocation,source,attemptId}')
      AND h_body#>>'{closedSourceRoot,workflowId}'='media-operation-'||(h_intent#>>'{invocation,source,operationId}')
      AND length(h_body#>>'{closedSourceRoot,runId}')>0 AND h_body#>>'{closedSourceRoot,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
      AND (h_body->'closedSourceRoot') ?& ARRAY['workflowId','runId','status'] AND ((h_body->'closedSourceRoot')-ARRAY['workflowId','runId','status'])='{}'::jsonb,false)
    THEN RAISE EXCEPTION 'Automatic rollback handoff must close its actual original child and source coordinator'; END IF;
  ELSIF h_body->'closedSourceRoot' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Movie rollback handoff cannot invent another source execution'; END IF;
  IF h_intent->'cleanup'<>'null'::jsonb THEN
    SELECT c.* INTO STRICT h_cleanup FROM "UpgradeCleanup" c WHERE c.id=h_intent#>>'{cleanup,id}';
    IF NOT COALESCE(h_cleanup.state='cancelled' AND h_cleanup.version=(h_intent#>>'{cleanup,version}')::integer+1
      AND (h_cleanup."expiresAt" AT TIME ZONE 'UTC')=(h_intent#>>'{cleanup,expiresAt}')::timestamptz
      AND h_cleanup."assetId"=h_intent#>>'{predecessor,id}' AND h_cleanup."successorAssetId"=h_intent#>>'{successor,id}',false)
    THEN RAISE EXCEPTION 'Movie rollback handoff cannot renew or replace the original cleanup claim'; END IF;
  END IF;
  IF NOT media_movie_rollback_asset_v1(h_body->'predecessor',h_scope) OR NOT media_movie_rollback_asset_v1(h_body->'successor',h_scope)
  THEN RAISE EXCEPTION 'Movie rollback handoff lost its complete current asset and caption union'; END IF;
  PERFORM media_movie_requested_rollback_owner_v1(h_command,h_intent->'access',(h_body->>'expiresAt')::timestamptz);
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_rollback_handoff_birth_v1 AFTER INSERT ON "ApplicationEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_handoff_birth_v1();

CREATE FUNCTION media_movie_rollback_handoff_literal_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind IN ('movie_rollback_owner_handoff_v1','movie_rollback_retry_playback_v1') THEN RAISE EXCEPTION 'Movie rollback execution handoffs and playback are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF (OLD.kind IN ('movie_rollback_owner_handoff_v1','movie_rollback_retry_playback_v1') OR NEW.kind IN ('movie_rollback_owner_handoff_v1','movie_rollback_retry_playback_v1')) AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW)
  THEN RAISE EXCEPTION 'Movie rollback execution evidence requires its actual immutable birth'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_rollback_handoff_literal_v1 BEFORE UPDATE OR DELETE ON "ApplicationEvent" FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_handoff_literal_v1();

CREATE FUNCTION media_movie_rollback_owner_pointer_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h_marker text; h_old jsonb; h_ref jsonb; h_event "ApplicationEvent"; h_body jsonb; h_capture record; h_birth text;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ?| ARRAY['movieRollbackOwnerV1','movieRollbackHandoffV1','movieRollbackRetryPlaybackV1'] THEN RAISE EXCEPTION 'Movie rollback execution retains its actual original and retry commands'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ?| ARRAY['movieRollbackOwnerV1','movieRollbackHandoffV1','movieRollbackRetryPlaybackV1'] THEN
    IF (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload,OLD."createdAt")
    THEN RAISE EXCEPTION 'Movie rollback handoff commands remain literal'; END IF;
  END IF;
  FOREACH h_marker IN ARRAY ARRAY['movieRollbackOwnerV1','movieRollbackHandoffV1','movieRollbackRetryPlaybackV1'] LOOP
    h_ref:=NEW.result->h_marker; h_old:=CASE WHEN TG_OP='UPDATE' THEN OLD.result->h_marker ELSE NULL END;
    IF h_ref IS NOT DISTINCT FROM h_old THEN CONTINUE; END IF;
    IF h_ref IS NULL OR (h_marker='movieRollbackHandoffV1' AND h_old IS NOT NULL)
    THEN RAISE EXCEPTION 'Movie rollback retry retains its one actual execution grant'; END IF;
    IF h_marker='movieRollbackRetryPlaybackV1' THEN
      IF NOT COALESCE(h_ref ?& ARRAY['eventId','guardHash'] AND (h_ref-ARRAY['eventId','guardHash'])='{}'::jsonb
        AND NOT(COALESCE(NEW.result,'{}'::jsonb)?'movieRollbackPhysicalV1'),false)
      THEN RAISE EXCEPTION 'Movie rollback retry playback cannot replace completed physical evidence'; END IF;
    ELSIF NOT COALESCE(h_ref ?& ARRAY['eventId','handoffHash'] AND (h_ref-ARRAY['eventId','handoffHash'])='{}'::jsonb,false)
    THEN RAISE EXCEPTION 'Movie rollback handoff pointer shape changed'; END IF;
    SELECT e AS actual_row,e.xmin::text AS actual_xmin INTO STRICT h_capture FROM "ApplicationEvent" e WHERE e.id=h_ref->>'eventId';
    h_event:=h_capture.actual_row; h_birth:=h_capture.actual_xmin;
    IF h_birth IS DISTINCT FROM (txid_current()%4294967296)::text THEN RAISE EXCEPTION 'Movie rollback execution requires its actual same-transaction event'; END IF;
    IF h_marker='movieRollbackRetryPlaybackV1' THEN
      h_body:=h_event.payload->'guard';
      IF NOT COALESCE(h_event.kind='movie_rollback_retry_playback_v1' AND h_event.payload->>'guardHash'=h_ref->>'guardHash'
        AND h_body->>'operationId'=NEW.id AND h_body->>'transactionId'=txid_current()::text
        AND h_body->'handoff'=NEW.result->'movieRollbackOwnerV1' AND h_body->>'intentHash'=NEW.result#>>'{movieRollbackIntentV1,intentHash}',false)
      THEN RAISE EXCEPTION 'Movie rollback retry playback requires its current actual handoff'; END IF;
      CONTINUE;
    END IF;
    h_body:=h_event.payload->'handoff';
    IF NOT COALESCE(h_event.kind='movie_rollback_owner_handoff_v1' AND h_event.payload->>'handoffHash'=h_ref->>'handoffHash'
      AND h_body->>'transactionId'=txid_current()::text,false)
    THEN RAISE EXCEPTION 'Movie rollback ownership requires its actual same-transaction handoff event'; END IF;
    IF h_marker='movieRollbackOwnerV1' THEN
      IF NOT COALESCE(NEW.id=h_body->>'operationId' AND NEW.result#>>'{movieRollbackIntentV1,intentHash}'=h_body->>'intentHash'
        AND h_body->'previous'=COALESCE(h_old,'null'::jsonb),false)
      THEN RAISE EXCEPTION 'Movie rollback ownership lost the exact original pointer CAS'; END IF;
    ELSE
      IF NOT COALESCE(NEW.id=h_body#>>'{input,operationId}' AND NEW."userId"=h_body->>'actorId'
        AND NEW.payload=(h_body->>'commandRaw')::jsonb,false)
      THEN RAISE EXCEPTION 'Movie rollback ownership lost its new actual command'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_rollback_owner_pointer_v1 BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_owner_pointer_v1();

-- Four actual parents on a granted source: Event, retry command, current actor
-- and mapping. A setting alone cannot supply execution or permission authority.
CREATE FUNCTION media_movie_rollback_execution_v1(h_original "Operation",h_proof jsonb,h_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h_ref jsonb:=h_original.result->'movieRollbackOwnerV1'; h_setting jsonb; h_event "ApplicationEvent"; h_body jsonb; h_command "Operation";
  h_observed timestamptz; h_sdk timestamptz; h_expires timestamptz; h_intent jsonb:=h_original.result#>'{movieRollbackIntentV1,intent}';
  h_playback "ApplicationEvent"; h_guard jsonb; h_playback_ref jsonb;
BEGIN
  IF h_ref IS NULL THEN RETURN; END IF;
  h_setting:=NULLIF(current_setting('media.movie_rollback_execution_v1',true),'')::jsonb;
  SELECT e.* INTO STRICT h_event FROM "ApplicationEvent" e WHERE e.id=h_ref->>'eventId';
  h_body:=h_event.payload->'handoff';
  SELECT o.* INTO STRICT h_command FROM "Operation" o WHERE o.id=h_body#>>'{input,operationId}';
  PERFORM media_movie_rollback_retry_command_v1(h_command,h_intent);
  IF h_phase='physical' THEN h_observed:=(h_proof->>'observedAt')::timestamptz; h_sdk:=(h_proof->>'sdkExpiresAt')::timestamptz; h_expires:=(h_proof->>'expiresAt')::timestamptz;
  ELSIF h_phase='plex' THEN h_observed:=(h_proof#>>'{sdk,observedAt}')::timestamptz; h_sdk:=(h_proof#>>'{sdk,expiresAt}')::timestamptz; h_expires:=(h_proof#>>'{observation,verification,expiresAt}')::timestamptz;
  ELSIF h_phase='playback' THEN h_observed:=(h_proof#>>'{sdk,observedAt}')::timestamptz; h_sdk:=(h_proof#>>'{sdk,expiresAt}')::timestamptz; h_expires:=(h_proof->>'expiresAt')::timestamptz;
  ELSE RAISE EXCEPTION 'Unknown movie rollback execution phase'; END IF;
  IF NOT COALESCE(h_setting ?& ARRAY['schemaVersion','operationId','reference','input','owner','observedAt','sdkExpiresAt','expiresAt']
    AND (h_setting-ARRAY['schemaVersion','operationId','reference','input','owner','observedAt','sdkExpiresAt','expiresAt'])='{}'::jsonb AND h_setting->'schemaVersion'='1'::jsonb
    AND h_setting->>'operationId'=h_original.id AND h_setting->'reference'=h_ref AND h_setting->'input'=h_body->'input'
    AND h_setting#>>'{owner,workflowId}'=h_body#>>'{owner,workflowId}' AND h_setting#>>'{owner,runId}'=h_body#>>'{owner,runId}' AND length(h_setting#>>'{owner,activityId}')>0
    AND h_event.kind='movie_rollback_owner_handoff_v1' AND h_event.payload->>'handoffHash'=h_ref->>'handoffHash'
    AND h_body->>'operationId'=h_original.id AND h_body->>'intentHash'=h_original.result#>>'{movieRollbackIntentV1,intentHash}'
    AND h_command.result->'movieRollbackHandoffV1'=h_ref AND h_command."userId"=h_body->>'actorId' AND h_command.payload=(h_body->>'commandRaw')::jsonb
    AND (h_setting->>'observedAt')::timestamptz=h_observed AND (h_setting->>'sdkExpiresAt')::timestamptz=h_sdk
    AND h_expires<=(h_setting->>'expiresAt')::timestamptz AND (h_setting->>'expiresAt')::timestamptz<=LEAST(h_sdk,h_observed+interval '60 seconds')
    AND clock_timestamp()<(h_setting->>'expiresAt')::timestamptz AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (h_setting->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Movie rollback execution requires its actual current owner command and original SDK capability'; END IF;
  IF h_phase='playback' AND h_intent#>>'{invocation,mode}'='automatic_failed_plex' THEN
    IF NOT COALESCE(h_proof->'input'=h_body->'input' AND h_proof->'handoff'=h_ref
      AND (h_proof->>'commandRaw')::jsonb=h_command.payload AND h_proof->>'commandHash'=h_body->>'commandHash',false)
    THEN RAISE EXCEPTION 'Automatic rollback playback requires its exact actual current retry command'; END IF;
  END IF;
  IF h_phase='physical' AND h_intent#>>'{invocation,mode}'='automatic_failed_plex' THEN
    h_playback_ref:=h_original.result->'movieRollbackRetryPlaybackV1';
    SELECT e.* INTO STRICT h_playback FROM "ApplicationEvent" e WHERE e.id=h_playback_ref->>'eventId';
    h_guard:=h_playback.payload->'guard';
    IF NOT COALESCE(h_playback.kind='movie_rollback_retry_playback_v1' AND h_playback.payload->>'guardHash'=h_playback_ref->>'guardHash'
      AND h_guard->'handoff'=h_ref AND h_guard->'input'=h_body->'input' AND h_guard->>'operationId'=h_original.id
      AND h_guard->>'intentHash'=h_original.result#>>'{movieRollbackIntentV1,intentHash}'
      AND (h_guard->>'completedAt')::timestamptz<=h_observed AND h_expires<=(h_guard->>'expiresAt')::timestamptz,false)
    THEN RAISE EXCEPTION 'Automatic rollback inverse requires fresh actual sessions for its current execution handoff'; END IF;
  END IF;
  PERFORM media_movie_requested_rollback_owner_v1(h_command,h_intent->'access',h_expires);
END;
$$;

ALTER FUNCTION media_movie_rollback_physical_birth_v1("Operation",jsonb,jsonb) RENAME TO media_movie_rollback_physical_before_handoff_v1;
CREATE FUNCTION media_movie_rollback_physical_birth_v1(h_command "Operation",h_intent jsonb,h_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM media_movie_rollback_execution_v1(h_command,h_proof,'physical');
  PERFORM media_movie_rollback_physical_before_handoff_v1(h_command,h_intent,h_proof);
END;
$$;
ALTER FUNCTION media_movie_rollback_plex_birth_v1("Operation",jsonb,jsonb,jsonb) RENAME TO media_movie_rollback_plex_before_handoff_v1;
CREATE FUNCTION media_movie_rollback_plex_birth_v1(h_command "Operation",h_intent jsonb,h_physical jsonb,h_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM media_movie_rollback_execution_v1(h_command,h_proof,'plex');
  PERFORM media_movie_rollback_plex_before_handoff_v1(h_command,h_intent,h_physical,h_proof);
END;
$$;

CREATE FUNCTION media_movie_rollback_retry_playback_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h_envelope jsonb:=NEW.payload; h_guard jsonb:=NEW.payload->'guard'; h_original "Operation"; h_intent jsonb; h_scope jsonb;
  h_target "MediaIntent"; h_runtime "MediaRuntimeState"; h_profile "QualityProfile"; h_writer "LegacyWriterLease";
  h_pointer "PlexBindingCurrent"; h_association "PlexAssociationEvidence"; h_source jsonb; h_entry jsonb; h_paths jsonb;
  h_library text; h_control text; h_pointer_body jsonb;
BEGIN
  IF NEW.kind<>'movie_rollback_retry_playback_v1' THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT o.* INTO STRICT h_original FROM "Operation" o WHERE o.id=h_guard->>'operationId';
  h_intent:=h_original.result#>'{movieRollbackIntentV1,intent}'; h_scope:=h_intent->'scope';
  SELECT t.* INTO STRICT h_target FROM "MediaIntent" t WHERE t."mediaId"=h_scope->>'mediaId' AND t.edition=h_scope->>'edition';
  SELECT r.* INTO STRICT h_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT p.* INTO STRICT h_profile FROM "QualityProfile" p WHERE p.id=h_intent#>>'{authority,profileId}';
  SELECT w.* INTO STRICT h_writer FROM "LegacyWriterLease" w WHERE w.id='singleton';
  SELECT p.* INTO STRICT h_pointer FROM "PlexBindingCurrent" p WHERE p."mediaId"=h_scope->>'mediaId' AND p.edition=h_scope->>'edition';
  SELECT e.* INTO STRICT h_association FROM "PlexAssociationEvidence" e WHERE e.id=h_intent#>>'{originalItem,binding,evidenceId}';
  h_pointer_body:=jsonb_build_object('scope',h_scope-'rootMediaId','revision',h_pointer.revision,'evidence',
    CASE WHEN h_pointer."evidenceId" IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',h_pointer."evidenceId",'associationHash',h_pointer."associationHash") END);
  IF NOT COALESCE(h_envelope ?& ARRAY['guard','guardHash','raw'] AND (h_envelope-ARRAY['guard','guardHash','raw'])='{}'::jsonb
    AND (h_envelope->>'raw')::jsonb=h_guard AND encode(sha256(convert_to(h_envelope->>'raw','UTF8')),'hex')=h_envelope->>'guardHash'
    AND h_guard ?& ARRAY['schemaVersion','id','transactionId','operationId','intentId','intentHash','input','handoff','commandRaw','commandHash','originalAssociation','paths','pathsRaw','pathsHash','sessions','sdk','writerExpiresAt','expiresAt','completedAt']
    AND (h_guard-ARRAY['schemaVersion','id','transactionId','operationId','intentId','intentHash','input','handoff','commandRaw','commandHash','originalAssociation','paths','pathsRaw','pathsHash','sessions','sdk','writerExpiresAt','expiresAt','completedAt'])='{}'::jsonb
    AND h_guard->'schemaVersion'='1'::jsonb AND h_guard->>'id'=NEW.id AND h_guard->>'transactionId'=txid_current()::text
    AND NEW."dedupeKey"='movie-rollback-retry-playback-v1:'||NEW.id AND NEW."mediaId"=h_scope->>'mediaId'
    AND h_guard->>'intentId'=h_intent->>'id' AND h_guard->>'intentHash'=h_original.result#>>'{movieRollbackIntentV1,intentHash}'
    AND h_intent#>>'{invocation,mode}'='automatic_failed_plex' AND NOT(COALESCE(h_original.result,'{}'::jsonb)?'movieRollbackPhysicalV1')
    AND h_original.result->'movieRollbackRetryPlaybackV1'=jsonb_build_object('eventId',NEW.id,'guardHash',h_envelope->>'guardHash')
    AND h_guard->'handoff'=h_original.result->'movieRollbackOwnerV1'
    AND h_guard->'originalAssociation'=h_association.evidence AND h_association."associationHash"=h_intent#>>'{originalItem,binding,associationHash}'
    AND h_pointer_body=h_intent->'pointer' AND h_pointer."evidenceId"=h_association.id AND h_pointer."associationHash"=h_association."associationHash"
    AND h_runtime.mode='active' AND h_runtime."ownershipConfirmed" AND to_jsonb(h_runtime."recoveryEpoch")=h_intent#>'{authority,recoveryEpoch}'
    AND h_target."automationEpoch"=h_runtime."recoveryEpoch" AND h_target."editionRootId"=h_scope->>'rootMediaId'
    AND h_target.monitoring AND h_target."desiredPresence" AND h_target."intentionallyRemovedAt" IS NULL
    AND to_jsonb(h_target.generation)=h_intent#>'{authority,generation}' AND h_target."profileId"=h_profile.id
    AND to_jsonb(h_profile.version)=h_intent#>'{authority,profileVersion}'
    AND h_guard#>>'{sessions,state}'='clear' AND h_guard#>>'{sessions,pathsHash}'=h_guard->>'pathsHash'
    AND (h_guard->>'pathsRaw')::jsonb=h_guard->'paths' AND encode(sha256(convert_to(h_guard->>'pathsRaw','UTF8')),'hex')=h_guard->>'pathsHash'
    AND (h_guard#>>'{sessions,checkedAt}')::timestamptz>=(h_guard#>>'{sdk,observedAt}')::timestamptz
    AND (h_guard->>'completedAt')::timestamptz>=(h_guard#>>'{sessions,checkedAt}')::timestamptz
    AND (h_guard->>'completedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp()) AND (h_guard->>'completedAt')::timestamptz<=clock_timestamp()
    AND (h_guard->>'completedAt')::timestamptz<(h_guard->>'expiresAt')::timestamptz
    AND (h_guard->>'expiresAt')::timestamptz<=LEAST((h_guard#>>'{sdk,expiresAt}')::timestamptz,(h_guard#>>'{sdk,observedAt}')::timestamptz+interval '60 seconds',(h_writer."expiresAt" AT TIME ZONE 'UTC'))
    AND (h_writer."expiresAt" AT TIME ZONE 'UTC')=(h_guard->>'writerExpiresAt')::timestamptz AND (h_writer."observedAt" AT TIME ZONE 'UTC')<=clock_timestamp()
    AND h_writer."revokedAt" IS NULL AND h_writer."recoveryEpoch"=h_runtime."recoveryEpoch"
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (h_guard->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Automatic rollback retry playback lost its actual admitted scope and Network deadline'; END IF;
  -- The original immutable intent supplies every path and stored alias. Current
  -- row validation below is one complete caption traversal for each video.
  h_source:=h_intent#>'{source,reference,intent,entries,0}'; h_entry:=h_source->'entry';
  IF NOT COALESCE(right(h_intent#>>'{successor,path}',length(h_entry->>'libraryPath')+1)='/'||(h_entry->>'libraryPath')
    AND right(h_intent#>>'{predecessor,path}',length(h_entry->>'operationId')+10)='/rollback/'||(h_entry->>'operationId'),false)
  THEN RAISE EXCEPTION 'Automatic rollback retry lost its actual stored library and control aliases'; END IF;
  h_library:=left(h_intent#>>'{successor,path}',length(h_intent#>>'{successor,path}')-length(h_entry->>'libraryPath'));
  h_control:=left(h_intent#>>'{predecessor,path}',length(h_intent#>>'{predecessor,path}')-length('rollback/'||(h_entry->>'operationId')));
  SELECT jsonb_agg(to_jsonb(p.path) ORDER BY p.path) INTO h_paths FROM (
    SELECT DISTINCT all_paths.path FROM (
      SELECT a.value->>'path' AS path FROM jsonb_array_elements(jsonb_build_array(h_intent->'predecessor',h_intent->'successor',h_source->'predecessor')) AS a(value)
      UNION ALL SELECT c.value->>'path' FROM jsonb_array_elements(jsonb_build_array(h_intent->'predecessor',h_intent->'successor',h_source->'predecessor')) AS a(value),jsonb_array_elements((a.value->'subtitles')||(a.value->'subtitleHistory')) AS c(value)
      UNION ALL SELECT (CASE WHEN p.value#>>'{physical,root}'='library' THEN h_library ELSE h_control END)||(p.value#>>'{physical,path}') FROM jsonb_array_elements(h_source->'participants') AS p(value)
      UNION ALL SELECT h_library||(c.value->>'libraryPath') FROM jsonb_array_elements(h_entry->'previousSidecars') AS c(value)
      UNION ALL SELECT h_control||'rollback/recover-'||(h_intent#>>'{successor,id}')
      UNION ALL SELECT h_control||'staging/recover-'||(h_intent#>>'{successor,id}')
      UNION ALL SELECT h_association.evidence#>>'{group,canonicalPath}'
      UNION ALL SELECT p.value->>'file' FROM jsonb_array_elements(h_association.evidence#>'{item,media}') AS m(value),jsonb_array_elements(m.value->'parts') AS p(value)
    ) AS all_paths WHERE all_paths.path IS NOT NULL
  ) AS p;
  IF h_paths IS DISTINCT FROM h_guard->'paths' OR jsonb_array_length(h_paths) NOT BETWEEN 1 AND 1000
    OR NOT media_movie_rollback_asset_v1(h_intent->'predecessor',h_scope) OR NOT media_movie_rollback_asset_v1(h_intent->'successor',h_scope)
  THEN RAISE EXCEPTION 'Automatic rollback retry omitted an actual inverse video, caption or journal namespace participant'; END IF;
  PERFORM media_movie_rollback_execution_v1(h_original,h_guard,'playback');
  -- The same current command, already checked by the execution closure, also
  -- binds the caller-visible actor and command hash without another row read.
  IF NOT COALESCE(h_guard#>>'{input,operationId}'=(h_guard->>'commandRaw')::jsonb->>'operationId'
    AND (h_guard->>'commandRaw')::jsonb->>'actorId'=NEW."actorId"
    AND encode(sha256(convert_to(h_guard->>'commandRaw','UTF8')),'hex')=h_guard->>'commandHash',false)
  THEN RAISE EXCEPTION 'Automatic rollback retry playback lost its actual current command'; END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_rollback_retry_playback_birth_v1 AFTER INSERT ON "ApplicationEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_rollback_retry_playback_birth_v1();
