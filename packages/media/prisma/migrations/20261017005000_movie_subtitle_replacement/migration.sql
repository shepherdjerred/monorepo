-- Schema2 is a distinct scoped protocol. Historical schema1 guards remain literal.
CREATE FUNCTION media_movie_replacement_scope_v2(p_asset "LibraryAsset", p_scope jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_scope ?& ARRAY['rootMediaId','mediaId','edition']
    AND p_scope-ARRAY['rootMediaId','mediaId','edition']='{}'::jsonb
    AND p_scope->>'rootMediaId'=p_asset."editionRootId" AND p_scope->>'mediaId'=p_asset."editionRootId"
    AND p_scope->>'edition'=p_asset.edition AND p_asset.owned AND p_asset.state='published'
    AND EXISTS (SELECT 1 FROM "MediaItem" m WHERE m.id=p_asset."editionRootId" AND m.kind='movie')
    AND (SELECT count(*)=1 FROM "AssetCoverage" c WHERE c."assetId"=p_asset.id AND c.current)
    AND EXISTS (SELECT 1 FROM "AssetCoverage" c WHERE c."assetId"=p_asset.id AND c."mediaId"=p_asset."editionRootId" AND c.edition=p_asset.edition AND c.current),false);
$$;

-- The application supplies its existing canonical bytes, not a new SQL serializer.
-- Their parsed value and SHA256 must bind the actual immutable receipt row.
CREATE FUNCTION media_movie_replacement_receipt_hash_v2(p_receipt "SubtitleReplacementReceipt") RETURNS text LANGUAGE sql STABLE AS $$
  SELECT e.payload->>'receiptHash' FROM "ApplicationEvent" e
  WHERE e."dedupeKey"='movie-subtitle-replaced-v2:'||p_receipt."replacementId"
    AND e.kind='movie_subtitle_replacement_settled_v2' AND e.payload->'schemaVersion'='2'::jsonb
    AND e.payload->>'replacementId'=p_receipt."replacementId" AND e.payload->>'receiptId'=p_receipt.id
    AND e.payload->>'outcome'=p_receipt.outcome AND (e.payload->>'receiptRaw')::jsonb=p_receipt.evidence
    AND encode(sha256(convert_to(e.payload->>'receiptRaw','UTF8')),'hex')=e.payload->>'receiptHash';
$$;

CREATE FUNCTION media_movie_replacement_source_v2(p_source jsonb, p_old jsonb, p_asset "LibraryAsset", p_scope jsonb, p_publication jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
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

CREATE FUNCTION media_movie_replacement_requested_v2(p_scope jsonb, p_language text, p_forced boolean, p_hi boolean, p_epoch integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_policy "MediaSubtitlePolicyVersion";
BEGIN
  IF EXISTS (SELECT 1 FROM "MediaRequest" r JOIN "MovieEditionChoice" c ON c.id=r."movieEditionChoiceId"
    JOIN "MediaUser" u ON u.id=r."userId"
    WHERE r."mediaId"=p_scope->>'mediaId' AND r.edition=p_scope->>'edition' AND r.active AND NOT r.excluded AND r.direct
      AND r."subtitleLanguages" @> ARRAY[p_language]::text[] AND NOT u.restricted
      AND c."requestId"=r.id AND c."subjectUserId"=r."userId" AND c."rootMediaId"=p_scope->>'rootMediaId'
      AND c.edition=r.edition AND c."choiceRevision"=r."movieEditionChoiceRevision") THEN RETURN true; END IF;
  SELECT p.* INTO v_policy FROM "MediaSubtitlePolicyVersion" p WHERE p."mediaId"=p_scope->>'mediaId' AND p.edition IN ('default',p_scope->>'edition')
    ORDER BY (p.edition=p_scope->>'edition') DESC,p.version DESC LIMIT 1;
  RETURN COALESCE(v_policy."recoveryEpoch"=p_epoch AND jsonb_array_length(v_policy.rules->'protectedReasons')=0
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_policy.rules->'targets') AS entry(value) WHERE entry.value->>'language'=p_language
      AND (NOT entry.value ? 'forced' OR entry.value->'forced'=to_jsonb(p_forced))
      AND (entry.value->>'hearingImpaired'='any' OR (entry.value->>'hearingImpaired'='required' AND p_hi IS TRUE) OR (entry.value->>'hearingImpaired'='excluded' AND p_hi IS FALSE))),false);
END;
$$;

CREATE FUNCTION media_movie_replacement_capture_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_asset "LibraryAsset"; v_old "SubtitleAsset"; v_candidate "SubtitleAsset"; v_owner "MediaUser";
  v_event "ApplicationEvent"; v_target "MediaIntent"; v_runtime "MediaRuntimeState"; v_scope jsonb; v_capture jsonb;
BEGIN
  IF NEW.snapshot->'schemaVersion' IS DISTINCT FROM '2'::jsonb THEN RETURN NEW; END IF;
  v_capture:=NEW.snapshot; v_scope:=v_capture->'scope';
  SELECT a.* INTO STRICT v_asset FROM "LibraryAsset" a WHERE a.id=NEW."assetId";
  SELECT s.* INTO STRICT v_old FROM "SubtitleAsset" s WHERE s.id=NEW."oldSubtitleId";
  SELECT s.* INTO STRICT v_candidate FROM "SubtitleAsset" s WHERE s.id=NEW."candidateSubtitleId";
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=NEW."ownerId";
  SELECT e.* INTO STRICT v_event FROM "ApplicationEvent" e WHERE e.id=v_capture#>>'{candidateSource,eventId}';
  SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  IF NOT COALESCE(media_movie_replacement_scope_v2(v_asset,v_scope) AND v_owner.role='owner' AND NOT v_owner.restricted
    AND NEW."snapshotHash" ~ '^[a-f0-9]{64}$' AND v_capture->>'libraryKind'='movies'
    AND NEW."importOperationId"='subtitle-replace-'||NEW.id AND NEW."rollbackOperationId"='subtitle-revert-'||NEW.id
    AND NEW."recoveryEpoch"=v_asset."ownershipEpoch" AND NEW."recoveryEpoch"=v_runtime."recoveryEpoch" AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed"
    AND NEW."runtimeVersion"=v_runtime.version AND v_capture->'recoveryEpoch'=to_jsonb(NEW."recoveryEpoch") AND v_capture->'runtimeVersion'=to_jsonb(v_runtime.version)
    AND v_capture#>>'{asset,id}'=v_asset.id AND v_capture#>'{asset,version}'=to_jsonb(v_asset.version) AND v_capture#>>'{asset,path}'=v_asset.path AND v_capture#>>'{asset,checksum}'=v_asset.checksum
    AND v_capture#>'{asset,ownershipEpoch}'=to_jsonb(v_asset."ownershipEpoch") AND jsonb_array_length(v_capture#>'{asset,coverage}')=1
    AND v_capture#>>'{asset,coverage,0,mediaId}'=v_scope->>'mediaId' AND v_capture#>'{asset,coverage,0,generation}'=to_jsonb(v_target.generation)
    AND v_target."editionRootId"=v_scope->>'rootMediaId' AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL AND v_target."automationEpoch"=v_runtime."recoveryEpoch"
    AND v_old."assetId"=v_asset.id AND v_old.state='installed' AND v_old."storageKind"='sidecar'
    AND v_old."videoChecksum"=v_asset.checksum AND v_old."videoVersion"=v_asset.version AND v_old."ownershipEpoch"=v_asset."ownershipEpoch"
    AND v_candidate."assetId"=v_asset.id AND v_candidate.state='validated' AND v_candidate.version=0 AND v_candidate."qualityStatus"='accepted' AND v_candidate."storageKind"='sidecar' AND v_candidate.path IS NULL
    AND v_candidate."videoChecksum"=v_asset.checksum AND v_candidate."videoVersion"=v_asset.version AND v_candidate."ownershipEpoch"=v_asset."ownershipEpoch"
    AND v_candidate.checksum=encode(sha256(v_candidate.content),'hex') AND v_candidate.checksum<>v_old.checksum
    AND v_candidate."matchingEvidence"->'movieScope'=v_scope AND v_candidate."matchingEvidence"->>'targetAuthority'=v_capture->>'targetAuthority'
    AND v_candidate."matchingEvidence"#>>'{replacementFor,oldSubtitleId}'=v_old.id AND v_candidate."matchingEvidence"#>'{replacementFor,expectedOldVersion}'=to_jsonb(v_old.version)
    AND v_candidate."matchingEvidence"#>>'{movieManualReplacementV2,eventId}'=v_event.id
    AND v_event.kind='movie_subtitle_replacement_candidate_v2' AND v_event.payload->'scope'=v_scope AND v_event.payload->>'subtitleId'=v_candidate.id
    AND v_event.payload->>'oldSubtitleId'=v_old.id AND v_event.payload->>'assetId'=v_asset.id AND v_event.payload->>'checksum'=v_candidate.checksum
    AND v_event."actorId"=v_capture#>>'{candidateSource,actorId}' AND v_capture#>>'{candidateSource,payloadHash}' ~ '^[a-f0-9]{64}$'
    AND v_capture->'old'=media_movie_restore_caption_snapshot(v_old) AND v_capture->'candidate'=media_movie_restore_caption_snapshot(v_candidate)
    AND v_capture->>'destination'=v_old.path AND media_movie_subtitle_parent(v_capture->'publication',v_asset,v_scope)
    AND media_movie_replacement_source_v2(v_capture->'source',v_capture->'old',v_asset,v_scope,v_capture->'publication')
    AND media_movie_replacement_requested_v2(v_scope,v_candidate.language,v_candidate.forced,v_candidate."hearingImpaired",v_runtime."recoveryEpoch"),false)
  THEN RAISE EXCEPTION 'Movie caption replacement requires its exact actual owner, video, upload and caption source'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_replacement_capture_v2 BEFORE INSERT ON "SubtitleReplacement" FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_capture_v2();

CREATE FUNCTION media_movie_replacement_receipt_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_replacement "SubtitleReplacement"; v_asset "LibraryAsset"; v_old "SubtitleAsset"; v_candidate "SubtitleAsset";
  v_command "Operation"; v_review "SubtitleReplacementReview"; v_target "MediaIntent"; v_runtime "MediaRuntimeState";
  v_proof jsonb; v_capture jsonb; v_scope jsonb; v_expected jsonb;
BEGIN
  SELECT r.* INTO STRICT v_replacement FROM "SubtitleReplacement" r WHERE r.id=NEW."replacementId";
  IF v_replacement.snapshot->'schemaVersion' IS DISTINCT FROM '2'::jsonb THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  v_proof:=NEW.evidence; v_capture:=v_replacement.snapshot; v_scope:=v_capture->'scope';
  SELECT a.* INTO STRICT v_asset FROM "LibraryAsset" a WHERE a.id=v_replacement."assetId";
  SELECT s.* INTO STRICT v_old FROM "SubtitleAsset" s WHERE s.id=v_replacement."oldSubtitleId";
  SELECT s.* INTO STRICT v_candidate FROM "SubtitleAsset" s WHERE s.id=v_replacement."candidateSubtitleId";
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=v_proof#>>'{command,operationId}';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  IF NOT COALESCE(v_proof->'schemaVersion'='2'::jsonb AND v_proof->'scope'=v_scope AND v_proof->>'snapshotHash'=v_replacement."snapshotHash"
    AND v_proof->'recoveryEpoch'=to_jsonb(v_replacement."recoveryEpoch") AND v_proof->>'oldSubtitleId'=v_replacement."oldSubtitleId" AND v_proof->>'candidateSubtitleId'=v_replacement."candidateSubtitleId"
    AND v_proof->'videoVersion'=v_capture#>'{asset,version}' AND v_proof->>'oldPath'=v_capture->>'destination'
    AND v_proof->>'importOperationId'=v_replacement."importOperationId" AND v_proof->>'rollbackOperationId'=v_replacement."rollbackOperationId"
    AND v_proof->'source'=v_capture->'source' AND v_proof#>'{before,old}'=v_capture->'old' AND v_proof#>'{before,candidate}'=v_capture->'candidate'
    AND v_command.id=v_replacement."coordinatorOperationId" AND v_command.kind IN ('apply_subtitle_replacement','reconcile_subtitle_replacement','prepare_subtitle_replacement')
    AND v_command."targetId"=v_replacement.id AND v_command.payload->>'replacementId'=v_replacement.id AND v_command.payload->'movieScope'=v_scope
    AND v_proof#>>'{command,kind}'=v_command.kind AND v_proof#>'{command,actorId}'=COALESCE(to_jsonb(v_command."userId"),'null'::jsonb)
    AND v_proof#>>'{command,payloadHash}' ~ '^[a-f0-9]{64}$' AND media_movie_replacement_scope_v2(v_asset,v_scope)
    AND v_asset.version=(v_capture#>>'{asset,version}')::integer AND v_asset.path=v_capture#>>'{asset,path}' AND v_asset.checksum=v_capture#>>'{asset,checksum}'
    AND v_asset."ownershipEpoch"=v_replacement."recoveryEpoch" AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_runtime."recoveryEpoch"=v_replacement."recoveryEpoch" AND v_runtime.version=v_replacement."runtimeVersion"
    AND v_proof#>'{after,old}'=media_movie_restore_caption_snapshot(v_old) AND v_proof#>'{after,candidate}'=media_movie_restore_caption_snapshot(v_candidate)
    AND EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s.id=v_candidate.id AND s.xmin::text=(txid_current()%4294967296)::text)
    AND media_movie_replacement_source_v2(v_capture->'source',v_capture->'old',v_asset,v_scope,v_capture->'publication')
    AND (v_proof->>'settledAt')::timestamptz<=clock_timestamp() AND (v_proof->>'settledAt')::timestamptz>=(v_proof->>'observedAt')::timestamptz
    AND (v_proof->>'settledAt')::timestamptz<(v_proof->>'expiresAt')::timestamptz
    AND (v_proof->>'expiresAt')::timestamptz<=(v_proof->>'observedAt')::timestamptz+interval '60 seconds'
    AND (v_proof->>'expiresAt')::timestamptz<=(v_proof->>'sdkExpiresAt')::timestamptz
    AND EXTRACT(EPOCH FROM (v_proof->>'expiresAt')::timestamptz)*1000<=NULLIF(current_setting('media.plex_deadline_ms',true),'')::numeric,false)
  THEN RAISE EXCEPTION 'Movie caption replacement receipt requires its exact native transition and original deadline'; END IF;
  IF NEW.outcome='installed' THEN
    SELECT r.* INTO STRICT v_review FROM "SubtitleReplacementReview" r WHERE r."replacementId"=v_replacement.id;
    SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
    v_expected:=(v_capture->'candidate')||jsonb_build_object('state','installed','path',v_capture->>'destination','version',(v_capture#>>'{candidate,version}')::integer+1,
      'matchingEvidence',(v_capture#>'{candidate,matchingEvidence}')||jsonb_build_object('movieReplacementV2',jsonb_build_object('schemaVersion',2,'replacementId',v_replacement.id)));
    IF NOT COALESCE(v_candidate.state='installed' AND v_candidate.version=(v_capture#>>'{candidate,version}')::integer+1 AND v_proof#>'{after,candidate}'=v_expected
      AND v_old.state='superseded' AND v_old.version=(v_capture#>>'{old,version}')::integer+1
      AND v_old.path=v_proof->>'archivePath' AND v_old.path='/data/movies/.media-control/rollback/'||v_replacement."importOperationId"
      AND v_proof#>'{after,old}'=(v_capture->'old')||jsonb_build_object('state','superseded','path',v_old.path,'version',v_old.version)
      AND EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s.id=v_old.id AND s.xmin::text=(txid_current()%4294967296)::text)
      AND v_review."approvedById" IS NOT NULL AND v_review."approvedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
      AND v_review."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
      AND EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=v_review."approvedById" AND u.role='owner' AND NOT u.restricted)
      AND EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=v_replacement."ownerId" AND u.role='owner' AND NOT u.restricted)
      AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL AND v_target."automationEpoch"=v_replacement."recoveryEpoch"
      AND media_movie_replacement_requested_v2(v_scope,v_candidate.language,v_candidate.forced,v_candidate."hearingImpaired",v_runtime."recoveryEpoch")
      AND to_jsonb(v_target.generation)=v_capture#>'{asset,coverage,0,generation}'
      AND v_proof#>>'{journal,operationId}'=v_replacement."importOperationId" AND v_proof#>>'{journal,kind}'='import' AND v_proof#>>'{journal,phase}'='complete'
      AND v_proof#>>'{journal,target}'=v_candidate.path AND v_proof#>>'{journal,sha256}'=v_candidate.checksum AND v_proof#>>'{journal,previousSha256}'=v_old.checksum,false)
    THEN RAISE EXCEPTION 'Installed movie replacement requires its exact reviewed same-transaction caption swap'; END IF;
  ELSE
    IF NOT COALESCE(v_candidate.state='failed' AND v_proof#>'{after,old}'=v_capture->'old'
      AND v_proof#>'{after,candidate}'=(v_capture->'candidate')||jsonb_build_object('state','failed','version',(v_capture#>>'{candidate,version}')::integer+1),false)
    THEN RAISE EXCEPTION 'Movie replacement compensation changed its unchanged original caption'; END IF;
  END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_replacement_receipt_v2 BEFORE INSERT ON "SubtitleReplacementReceipt" FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_receipt_v2();

CREATE FUNCTION media_movie_replacement_event_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_candidate "SubtitleAsset"; v_old "SubtitleAsset"; v_asset "LibraryAsset"; v_actor "MediaUser"; v_runtime "MediaRuntimeState";
  v_choice "MovieEditionChoice"; v_request "MediaRequest"; v_target "MediaIntent"; v_replacement "SubtitleReplacement"; v_receipt "SubtitleReplacementReceipt"; v_body jsonb; v_hash text;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind IN ('movie_subtitle_replacement_candidate_v2','movie_subtitle_replacement_settled_v2') OR OLD.payload->>'kind'='movie_subtitle_replacement'
    THEN RAISE EXCEPTION 'Movie replacement event source is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.kind IN ('movie_subtitle_replacement_candidate_v2','movie_subtitle_replacement_settled_v2') OR OLD.payload->>'kind'='movie_subtitle_replacement') THEN
    IF (NEW.id,NEW."dedupeKey",NEW."mediaId",NEW."actorId",NEW.kind,NEW.payload) IS DISTINCT FROM (OLD.id,OLD."dedupeKey",OLD."mediaId",OLD."actorId",OLD.kind,OLD.payload)
    THEN RAISE EXCEPTION 'Movie replacement event source is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind='movie_subtitle_replacement_candidate_v2' THEN
    SELECT s.* INTO STRICT v_candidate FROM "SubtitleAsset" s WHERE s.id=NEW.payload->>'subtitleId';
    SELECT s.* INTO STRICT v_old FROM "SubtitleAsset" s WHERE s.id=NEW.payload->>'oldSubtitleId';
    SELECT a.* INTO STRICT v_asset FROM "LibraryAsset" a WHERE a.id=v_candidate."assetId";
    SELECT u.* INTO STRICT v_actor FROM "MediaUser" u WHERE u.id=NEW."actorId";
    SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
    IF NOT COALESCE(v_actor.role='owner' AND NOT v_actor.restricted AND media_movie_replacement_scope_v2(v_asset,NEW.payload->'scope')
      AND NEW."mediaId"=v_asset."editionRootId" AND NEW.payload->>'assetId'=v_asset.id AND NEW.payload->'assetVersion'=to_jsonb(v_asset.version)
      AND NEW.payload->>'checksum'=v_candidate.checksum AND v_candidate.state='validated' AND v_candidate.version=0 AND v_candidate."providerId"='manual' AND v_candidate."qualityStatus"='accepted'
      AND v_candidate."videoChecksum"=v_asset.checksum AND v_candidate."videoVersion"=v_asset.version AND v_candidate."ownershipEpoch"=v_asset."ownershipEpoch"
      AND v_candidate.checksum=encode(sha256(v_candidate.content),'hex') AND v_candidate."matchingEvidence"->'movieScope'=NEW.payload->'scope'
      AND v_candidate."matchingEvidence"#>'{movieManualReplacementV2,schemaVersion}'='2'::jsonb AND v_candidate."matchingEvidence"#>>'{movieManualReplacementV2,eventId}'=NEW.id
      AND v_candidate.provenance->>'uploadedBy'=v_actor.id AND v_old."assetId"=v_asset.id AND v_old.state='installed' AND v_old."storageKind"='sidecar'
      AND to_jsonb(v_old.version)=NEW.payload->'expectedOldVersion' AND v_old."videoVersion"=v_asset.version AND v_old."videoChecksum"=v_asset.checksum
      AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_runtime."recoveryEpoch"=v_asset."ownershipEpoch"
      AND media_movie_replacement_requested_v2(NEW.payload->'scope',v_candidate.language,v_candidate.forced,v_candidate."hearingImpaired",v_runtime."recoveryEpoch"),false)
    THEN RAISE EXCEPTION 'Movie replacement upload requires its actual owner, candidate and requested target'; END IF;
  ELSIF NEW.kind='movie_subtitle_replacement_settled_v2' THEN
    SELECT r.* INTO STRICT v_replacement FROM "SubtitleReplacement" r WHERE r.id=NEW.payload->>'replacementId';
    SELECT r.* INTO STRICT v_receipt FROM "SubtitleReplacementReceipt" r WHERE r.id=NEW.payload->>'receiptId' AND r."replacementId"=v_replacement.id;
    IF NOT COALESCE(NEW.payload->'schemaVersion'='2'::jsonb AND v_replacement.snapshot->'schemaVersion'='2'::jsonb
      AND NEW."dedupeKey"='movie-subtitle-replaced-v2:'||v_replacement.id AND NEW."mediaId"=v_replacement.snapshot#>>'{scope,mediaId}'
      AND NEW.payload->'scope'=v_replacement.snapshot->'scope' AND NEW.payload->>'outcome'=v_receipt.outcome
      AND COALESCE(to_jsonb(NEW."actorId"),'null'::jsonb)=v_receipt.evidence#>'{command,actorId}'
      AND (NEW.payload->>'receiptRaw')::jsonb=v_receipt.evidence
      AND encode(sha256(convert_to(NEW.payload->>'receiptRaw','UTF8')),'hex')=NEW.payload->>'receiptHash',false)
    THEN RAISE EXCEPTION 'Movie replacement settlement event requires its actual immutable receipt bytes'; END IF;
  ELSIF NEW.payload->>'kind'='movie_subtitle_replacement' THEN
    PERFORM media_plex_assert_deadline();
    v_body:=NEW.payload;
    SELECT r.* INTO STRICT v_replacement FROM "SubtitleReplacement" r WHERE r.id=v_body#>>'{source,replacementId}';
    SELECT r.* INTO STRICT v_receipt FROM "SubtitleReplacementReceipt" r WHERE r."replacementId"=v_replacement.id;
    SELECT c.* INTO STRICT v_choice FROM "MovieEditionChoice" c WHERE c.id=v_body#>>'{request,choiceId}';
    SELECT r.* INTO STRICT v_request FROM "MediaRequest" r WHERE r.id=v_body#>>'{request,id}';
    SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=NEW."mediaId" AND t.edition=v_body#>>'{source,scope,edition}';
    SELECT a.* INTO STRICT v_asset FROM "LibraryAsset" a WHERE a.id=v_replacement."assetId";
    v_hash:=media_movie_replacement_receipt_hash_v2(v_receipt);
    IF NOT COALESCE(NEW.kind='subtitles_ready' AND v_body->'schemaVersion'='4'::jsonb AND v_body->>'eventKind'=NEW.kind
      AND v_body#>'{source,schemaVersion}'='2'::jsonb AND v_body#>'{source,scope}'=v_replacement.snapshot->'scope' AND v_receipt.evidence->'scope'=v_replacement.snapshot->'scope'
      AND v_receipt.outcome='installed' AND v_receipt.evidence->'schemaVersion'='2'::jsonb AND v_replacement.state='applied' AND NOT v_replacement."reservationActive"
      AND v_body#>>'{source,assetId}'=v_asset.id AND v_body#>>'{source,subtitleId}'=v_replacement."candidateSubtitleId" AND v_body#>>'{asset,id}'=v_asset.id
      AND v_body#>'{asset,version}'=to_jsonb(v_asset.version) AND v_body#>>'{asset,checksum}'=v_asset.checksum AND v_body->'recoveryEpoch'=to_jsonb(v_asset."ownershipEpoch")
      AND v_body->>'captionHash'=v_hash AND v_body->>'targetAuthority'=v_replacement.snapshot->>'targetAuthority'
      AND media_movie_replacement_scope_v2(v_asset,v_body#>'{source,scope}')
      AND v_body#>>'{request,id}'=v_choice."requestId" AND v_body#>'{request,choiceRevision}'=to_jsonb(v_choice."choiceRevision")
      AND v_choice."actorId"=NEW."actorId" AND v_choice."subjectUserId"=v_request."userId" AND v_choice."rootMediaId"=NEW."mediaId" AND v_choice.edition=v_target.edition
      AND v_request."mediaId"=NEW."mediaId" AND v_request.edition=v_target.edition AND v_request.active AND NOT v_request.excluded AND v_request.direct
      AND v_request."movieEditionChoiceId"=v_choice.id AND v_request."movieEditionChoiceRevision"=v_choice."choiceRevision"
      AND v_target.availability='available' AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL AND to_jsonb(v_target.generation)=v_body->'generation'
      AND to_jsonb(v_target."automationEpoch")=v_body->'recoveryEpoch',false)
    THEN RAISE EXCEPTION 'Movie replacement readiness requires its actual scoped receipt and current recipient choice'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_replacement_event_v2 BEFORE INSERT OR UPDATE OR DELETE ON "ApplicationEvent" FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_event_v2();

CREATE FUNCTION media_movie_replacement_command_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_replacement "SubtitleReplacement"; v_original "SubtitleReplacement";
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.payload ? 'movieScope' AND OLD.kind IN ('prepare_subtitle_replacement','apply_subtitle_replacement','reconcile_subtitle_replacement','cleanup_subtitle_replacement') THEN
    SELECT r.* INTO v_original FROM "SubtitleReplacement" r WHERE r.id=OLD.payload->>'replacementId';
    IF v_original.snapshot->'schemaVersion'='2'::jsonb AND (TG_OP='DELETE' OR
      (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload) IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload))
    THEN RAISE EXCEPTION 'Movie replacement command and original scope are immutable'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.kind IN ('prepare_subtitle_replacement','apply_subtitle_replacement','reconcile_subtitle_replacement','cleanup_subtitle_replacement') THEN
    SELECT r.* INTO v_replacement FROM "SubtitleReplacement" r WHERE r.id=NEW.payload->>'replacementId';
    IF v_replacement.snapshot->'schemaVersion'='2'::jsonb AND NOT COALESCE(NEW."targetId"=v_replacement.id AND NEW.payload->'movieScope'=v_replacement.snapshot->'scope'
      AND NEW.payload->>'operationId'=NEW.id AND NEW.payload->>'kind'=NEW.kind AND NEW.payload->'recoveryEpoch'=to_jsonb(v_replacement."recoveryEpoch"),false)
    THEN RAISE EXCEPTION 'Movie replacement command requires its exact actual stored scope'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_replacement_command_v2 BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_command_v2();

CREATE FUNCTION media_movie_replacement_settlement_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_replacement "SubtitleReplacement"; v_receipt "SubtitleReplacementReceipt"; v_command "Operation";
BEGIN
  SELECT r.* INTO STRICT v_replacement FROM "SubtitleReplacement" r WHERE r.id=NEW.id;
  IF v_replacement.snapshot->'schemaVersion' IS DISTINCT FROM '2'::jsonb THEN RETURN NEW; END IF;
  IF v_replacement."coordinatorOperationId" IS NULL THEN RAISE EXCEPTION 'Movie replacement requires its actual coordinator before commit'; END IF;
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=v_replacement."coordinatorOperationId";
  IF NOT COALESCE(v_command."targetId"=v_replacement.id AND v_command.payload->'movieScope'=v_replacement.snapshot->'scope' AND v_command.payload->>'replacementId'=v_replacement.id,false)
  THEN RAISE EXCEPTION 'Movie replacement coordinator changed its exact actual scope'; END IF;
  IF v_replacement."reservationActive" THEN RETURN NEW; END IF;
  SELECT r.* INTO STRICT v_receipt FROM "SubtitleReplacementReceipt" r WHERE r."replacementId"=v_replacement.id;
  IF NOT COALESCE(v_receipt.evidence->'schemaVersion'='2'::jsonb AND v_receipt.evidence->>'snapshotHash'=v_replacement."snapshotHash"
    AND v_replacement.state=CASE v_receipt.outcome WHEN 'installed' THEN 'applied' WHEN 'compensated' THEN 'rolled_back' WHEN 'abandoned' THEN 'abandoned' END
    AND v_replacement."appliedAt"=((v_receipt.evidence->>'settledAt')::timestamptz AT TIME ZONE 'UTC')
    AND v_replacement."archiveExpiresAt"=v_replacement."appliedAt"+interval '7 days'
    AND media_movie_replacement_receipt_hash_v2(v_receipt) IS NOT NULL,false)
  THEN RAISE EXCEPTION 'Movie replacement reservation requires its exact actual settlement receipt'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_replacement_settlement_v2 AFTER INSERT OR UPDATE ON "SubtitleReplacement" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_settlement_v2();

CREATE FUNCTION media_movie_replacement_receipt_closure_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evidence->'schemaVersion' IS DISTINCT FROM '2'::jsonb THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ApplicationEvent" e WHERE e."dedupeKey"='movie-subtitle-replaced-v2:'||NEW."replacementId"
    AND e.xmin::text=(txid_current()%4294967296)::text AND e.payload->>'receiptId'=NEW.id)
    OR media_movie_replacement_receipt_hash_v2(NEW) IS NULL
  THEN RAISE EXCEPTION 'Movie replacement requires its exact same-transaction canonical receipt bytes'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_replacement_receipt_closure_v2 AFTER INSERT ON "SubtitleReplacementReceipt" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_receipt_closure_v2();

CREATE FUNCTION media_movie_replacement_native_closure_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_replacement "SubtitleReplacement"; v_receipt "SubtitleReplacementReceipt"; v_actual "SubtitleAsset"; v_expected jsonb;
BEGIN
  FOR v_replacement IN SELECT r.* FROM "SubtitleReplacement" r WHERE r.snapshot->'schemaVersion'='2'::jsonb
    AND (r."oldSubtitleId"=NEW.id OR r."candidateSubtitleId"=NEW.id)
    AND (r."reservationActive" OR EXISTS (SELECT 1 FROM "SubtitleReplacementReceipt" p WHERE p."replacementId"=r.id AND p.xmin::text=(txid_current()%4294967296)::text)) LOOP
    SELECT s.* INTO STRICT v_actual FROM "SubtitleAsset" s WHERE s.id=NEW.id;
    IF v_replacement."reservationActive" THEN
      v_expected:=CASE WHEN v_replacement."oldSubtitleId"=NEW.id THEN v_replacement.snapshot->'old' ELSE v_replacement.snapshot->'candidate' END;
    ELSE
      SELECT r.* INTO STRICT v_receipt FROM "SubtitleReplacementReceipt" r WHERE r."replacementId"=v_replacement.id;
      IF NOT EXISTS (SELECT 1 FROM "SubtitleReplacementReceipt" p WHERE p.id=v_receipt.id AND p.xmin::text=(txid_current()%4294967296)::text)
      THEN RAISE EXCEPTION 'Movie replacement requires its exact same-transaction native receipt'; END IF;
      v_expected:=CASE WHEN v_replacement."oldSubtitleId"=NEW.id THEN v_receipt.evidence#>'{after,old}' ELSE v_receipt.evidence#>'{after,candidate}' END;
    END IF;
    IF media_movie_restore_caption_snapshot(v_actual) IS DISTINCT FROM v_expected
    THEN RAISE EXCEPTION 'Movie replacement native captions require their exact same-transaction receipt closure'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_replacement_native_closure_v2 AFTER UPDATE ON "SubtitleAsset" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_native_closure_v2();

CREATE FUNCTION media_movie_replacement_notice_delivery_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event "ApplicationEvent"; v_previous "ApplicationEvent"; v_choice "MovieEditionChoice";
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT e.* INTO STRICT v_previous FROM "ApplicationEvent" e WHERE e.id=OLD."eventId";
    IF v_previous.payload->>'kind'='movie_subtitle_replacement' AND (TG_OP='DELETE' OR
      (NEW.id,NEW."eventId",NEW."userId",NEW.channel,NEW."recoveryEpoch") IS DISTINCT FROM (OLD.id,OLD."eventId",OLD."userId",OLD.channel,OLD."recoveryEpoch"))
    THEN RAISE EXCEPTION 'Movie replacement notice recipient and original source are immutable'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT e.* INTO STRICT v_event FROM "ApplicationEvent" e WHERE e.id=NEW."eventId";
  IF v_event.payload->>'kind' IS DISTINCT FROM 'movie_subtitle_replacement' THEN RETURN NEW; END IF;
  SELECT c.* INTO STRICT v_choice FROM "MovieEditionChoice" c WHERE c.id=v_event.payload#>>'{request,choiceId}';
  IF NOT COALESCE(NEW."userId"=v_choice."subjectUserId" AND NEW.channel IN ('email','discord') AND to_jsonb(NEW."recoveryEpoch")=v_event.payload->'recoveryEpoch',false)
  THEN RAISE EXCEPTION 'Movie replacement notice must retain its exact original recipient'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_replacement_notice_delivery_v2 BEFORE INSERT OR UPDATE OR DELETE ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_notice_delivery_v2();

CREATE FUNCTION media_movie_replacement_candidate_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD."matchingEvidence" ? 'movieManualReplacementV2') THEN RETURN NEW; END IF;
  IF (NEW.id,NEW."assetId",NEW.language,NEW."providerId",NEW."qualityStatus",NEW."storageKind",NEW.checksum,NEW.content,
      NEW."videoChecksum",NEW.forced,NEW."hearingImpaired",NEW."streamIndex",NEW.codec,NEW.provenance)
    IS DISTINCT FROM (OLD.id,OLD."assetId",OLD.language,OLD."providerId",OLD."qualityStatus",OLD."storageKind",OLD.checksum,OLD.content,
      OLD."videoChecksum",OLD.forced,OLD."hearingImpaired",OLD."streamIndex",OLD.codec,OLD.provenance)
    OR (NEW."matchingEvidence"-'movieReplacementV2') IS DISTINCT FROM (OLD."matchingEvidence"-'movieReplacementV2')
    OR (OLD."matchingEvidence" ? 'movieReplacementV2' AND NEW."matchingEvidence"->'movieReplacementV2' IS DISTINCT FROM OLD."matchingEvidence"->'movieReplacementV2')
  THEN RAISE EXCEPTION 'Movie replacement uploaded bytes and source are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_replacement_candidate_v2 BEFORE UPDATE ON "SubtitleAsset" FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_candidate_v2();

CREATE FUNCTION media_movie_replacement_candidate_source_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_candidate "SubtitleAsset"; v_event "ApplicationEvent";
BEGIN
  IF NOT (NEW."matchingEvidence" ? 'movieManualReplacementV2') THEN RETURN NEW; END IF;
  SELECT s.* INTO STRICT v_candidate FROM "SubtitleAsset" s WHERE s.id=NEW.id;
  SELECT e.* INTO STRICT v_event FROM "ApplicationEvent" e WHERE e.id=v_candidate."matchingEvidence"#>>'{movieManualReplacementV2,eventId}';
  IF NOT COALESCE(v_event.kind='movie_subtitle_replacement_candidate_v2' AND v_event.payload->>'subtitleId'=v_candidate.id AND v_event.payload->>'assetId'=v_candidate."assetId"
    AND v_event.payload->'scope'=v_candidate."matchingEvidence"->'movieScope' AND v_event.payload->>'checksum'=v_candidate.checksum
    AND v_event."actorId"=v_candidate.provenance->>'uploadedBy' AND v_candidate."matchingEvidence"#>'{movieManualReplacementV2,schemaVersion}'='2'::jsonb,false)
  THEN RAISE EXCEPTION 'Movie replacement candidate requires its actual immutable owner upload event'; END IF;
  IF TG_OP='UPDATE' AND NOT EXISTS (SELECT 1 FROM "SubtitleReplacement" r JOIN "SubtitleReplacementReceipt" p ON p."replacementId"=r.id
    WHERE r.id=v_candidate."matchingEvidence"#>>'{movieReplacementV2,replacementId}' AND r."candidateSubtitleId"=v_candidate.id
      AND p.outcome='installed' AND p.evidence#>'{after,candidate}'=media_movie_restore_caption_snapshot(v_candidate)
      AND p.xmin::text=(txid_current()%4294967296)::text)
  THEN RAISE EXCEPTION 'Movie replacement candidate marker requires its exact same-transaction native receipt'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_replacement_candidate_source_v2 AFTER INSERT ON "SubtitleAsset" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION media_movie_replacement_candidate_source_v2();
CREATE CONSTRAINT TRIGGER movie_replacement_candidate_marker_v2 AFTER UPDATE ON "SubtitleAsset" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NOT (OLD."matchingEvidence" ? 'movieReplacementV2') AND NEW."matchingEvidence" ? 'movieReplacementV2')
  EXECUTE FUNCTION media_movie_replacement_candidate_source_v2();
