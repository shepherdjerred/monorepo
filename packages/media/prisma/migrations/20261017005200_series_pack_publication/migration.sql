-- Explicit TV pack batches are new authority. Literal publication v1/movie v2
-- retain their schemas, immutability trigger and original transaction meaning.
ALTER TABLE "MediaPublicationTransition" DROP CONSTRAINT "media_pub_transition_valid";
ALTER TABLE "MediaPublicationTransition" ADD CONSTRAINT "media_pub_transition_valid" CHECK (
  "birthEpoch">=0 AND "filePlanHash" ~ '^[a-f0-9]{64}$' AND "intentHash" ~ '^[a-f0-9]{64}$'
  AND COALESCE("intent"->'schemaVersion' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb)
    AND "intent"->>'transitionId'="id" AND "intent"->>'attemptId'="attemptId"
    AND "intent"->'birthEpoch'=to_jsonb("birthEpoch") AND "intent"->>'filePlanHash'="filePlanHash",false)
  AND (("outcome" IS NULL AND "outcomeHash" IS NULL) OR
    ("outcome" IS NOT NULL AND "outcomeHash" ~ '^[a-f0-9]{64}$'
      AND COALESCE("outcome"->'schemaVersion'="intent"->'schemaVersion'
        AND "outcome"->>'transitionId'="id" AND "outcome"->>'intentHash'="intentHash"
        AND "outcome"->>'kind' IN ('published','compensated'),false)))
);

CREATE FUNCTION media_series_pack_subtitle_snapshot_v1(p_s "SubtitleAsset") RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id',p_s.id,'assetId',p_s."assetId",'version',p_s.version,'ownershipEpoch',p_s."ownershipEpoch",
    'state',p_s.state,'qualityStatus',p_s."qualityStatus",'storageKind',p_s."storageKind",'language',p_s.language,
    'providerId',p_s."providerId",'path',p_s.path,'checksum',p_s.checksum,'videoChecksum',p_s."videoChecksum",
    'videoVersion',p_s."videoVersion",'forced',p_s.forced,'hearingImpaired',p_s."hearingImpaired",'streamIndex',p_s."streamIndex",
    'codec',p_s.codec,'provenance',p_s.provenance,'matchingEvidence',p_s."matchingEvidence",
    'contentChecksum',CASE WHEN p_s.content IS NULL THEN NULL ELSE encode(sha256(p_s.content),'hex') END)
$$;
CREATE FUNCTION media_series_pack_asset_snapshot_v1(p_asset_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id',a.id,'version',a.version,'edition',a.edition,'editionRootId',a."editionRootId",
    'owned',a.owned,'ownershipEpoch',a."ownershipEpoch",'state',a.state,'path',a.path,'sourcePath',a."sourcePath",
    'checksum',a.checksum,'sizeBytes',a."sizeBytes"::text,'properties',a.properties,'supersededByAssetId',a."supersededByAssetId",
    'plexPublishedAt',CASE WHEN a."plexPublishedAt" IS NULL THEN NULL ELSE to_char(a."plexPublishedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'rollbackExpiresAt',CASE WHEN a."rollbackExpiresAt" IS NULL THEN NULL ELSE to_char(a."rollbackExpiresAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'coverage',COALESCE((SELECT jsonb_agg(jsonb_build_object('mediaId',c."mediaId",'edition',c.edition,'current',c.current) ORDER BY c."mediaId")
      FROM "AssetCoverage" c WHERE c."assetId"=a.id),'[]'::jsonb),
    'subtitles',COALESCE((SELECT jsonb_agg(media_series_pack_subtitle_snapshot_v1(s) ORDER BY s.id) FROM "SubtitleAsset" s WHERE s."assetId"=a.id
      AND s.state IN ('installed','superseded') AND NOT (s.state IN ('superseded','purged') AND EXISTS
        (SELECT 1 FROM "SubtitleReplacement" r JOIN "SubtitleReplacementReceipt" receipt ON receipt."replacementId"=r.id
          WHERE r."oldSubtitleId"=s.id AND receipt.outcome='installed'))),'[]'::jsonb),
    'subtitleHistory',COALESCE((SELECT jsonb_agg(media_series_pack_subtitle_snapshot_v1(s) ORDER BY s.id) FROM "SubtitleAsset" s WHERE s."assetId"=a.id
      AND NOT (s.state IN ('installed','superseded') AND NOT (s.state IN ('superseded','purged') AND EXISTS
        (SELECT 1 FROM "SubtitleReplacement" r JOIN "SubtitleReplacementReceipt" receipt ON receipt."replacementId"=r.id
          WHERE r."oldSubtitleId"=s.id AND receipt.outcome='installed')))),'[]'::jsonb))
  FROM "LibraryAsset" a WHERE a.id=p_asset_id
$$;

CREATE FUNCTION media_series_pack_current_policy_v1(p_attempt "AcquisitionAttempt") RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_parent "Operation"; v_value jsonb; v_profile "QualityProfile"; v_management jsonb; v_approval jsonb;
  v_receipt "MediaHandoffReceipt"; v_plan "MediaHandoffPlan"; v_actor "MediaUser"; v_association "PlexAssociationEvidence";
  v_target "MediaIntent"; v_captured jsonb; v_leaf "MediaItem"; v_ids text[]; v_actual_ids text[];
BEGIN
  SELECT o.* INTO STRICT v_parent FROM "Operation" o WHERE o.id=p_attempt."identityEvidence"#>>'{source,seriesPackV1,operationId}' FOR SHARE;
  v_value:=v_parent.payload->'interpretation';
  SELECT q.* INTO STRICT v_profile FROM "QualityProfile" q WHERE q.id=v_value#>>'{profile,id}' FOR SHARE;
  IF NOT COALESCE(v_parent.kind='assess_series_pack_v1' AND v_parent.status='completed' AND v_parent."userId" IS NULL
    AND v_parent.payload->>'interpretationHash'=p_attempt."identityEvidence"#>>'{source,seriesPackV1,interpretationHash}'
    AND v_profile.version=(v_value#>>'{profile,version}')::integer AND (v_parent.payload->>'profileRaw')::jsonb=v_profile.rules
    AND EXISTS (SELECT 1 FROM "QualityProfileVersion" p WHERE p."profileId"=v_profile.id AND p.version=v_profile.version AND p.rules=v_profile.rules)
    AND EXISTS (SELECT 1 FROM "ReleaseCandidate" r WHERE r.id=p_attempt."releaseId" AND r."encryptedSource" IS NOT NULL
      AND (v_parent.payload->>'sourceRaw')::jsonb=jsonb_build_object('providerId',r."providerId",'providerReleaseId',r."providerReleaseId",'title',r.title,'attributes',r.attributes,'source',r."sourceEvidence")),false)
  THEN RAISE EXCEPTION 'Series pack publication current retained source or profile authority changed'; END IF;
  SELECT array_agg(q.id ORDER BY q.id) INTO v_ids FROM unnest(p_attempt."mediaIds") q(id);
  SELECT array_agg(e.id ORDER BY e.id) INTO v_actual_ids FROM "MediaItem" e WHERE e.kind='episode'
    AND e."seasonNumber" IN (SELECT season::text::integer FROM jsonb_array_elements(v_value#>'{range,seasons}') season)
    AND (e."parentId"=v_value->>'seriesId' OR EXISTS (SELECT 1 FROM "MediaItem" s WHERE s.id=e."parentId" AND s.kind='season' AND s."parentId"=v_value->>'seriesId'));
  IF v_ids IS DISTINCT FROM v_actual_ids THEN RAISE EXCEPTION 'Series pack publication complete selected catalog changed'; END IF;
  FOR v_captured IN SELECT item FROM jsonb_array_elements(p_attempt."identityEvidence"#>'{canonical,coordinates,episodes}') item LOOP
    SELECT m.* INTO STRICT v_leaf FROM "MediaItem" m WHERE m.id=v_captured->>'mediaId';
    SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_leaf.id AND t.edition='default' FOR SHARE;
    IF NOT COALESCE(v_leaf.kind='episode' AND v_leaf."catalogState"='ready' AND (v_leaf."airDate" IS NULL OR v_leaf."airDate"<=clock_timestamp())
      AND v_captured->'seasonNumber'=to_jsonb(v_leaf."seasonNumber") AND v_captured->'episodeNumber'=to_jsonb(v_leaf."episodeNumber")
      AND v_target."profileId"=v_profile.id AND v_target."editionRootId"=v_value->>'seriesId',false)
    THEN RAISE EXCEPTION 'Series pack publication current canonical coordinates or target profile changed'; END IF;
  END LOOP;
  IF p_attempt."identityEvidence"->>'schemaVersion'<>'4' THEN RETURN; END IF;
  v_management:=p_attempt."identityEvidence"->'management';
  FOR v_approval IN SELECT item FROM jsonb_array_elements(CASE WHEN v_management->>'schemaVersion'='3' THEN v_management->'approvals' ELSE jsonb_build_array(v_management) END) item LOOP
    SELECT r.* INTO STRICT v_receipt FROM "MediaHandoffReceipt" r WHERE r.id=v_approval->>'receiptId' FOR SHARE;
    SELECT p.* INTO STRICT v_plan FROM "MediaHandoffPlan" p WHERE p.id=v_receipt."planId" FOR SHARE;
    SELECT u.* INTO STRICT v_actor FROM "MediaUser" u WHERE u.id=v_receipt."actorId" FOR SHARE;
    SELECT e.* INTO STRICT v_association FROM "PlexAssociationEvidence" e WHERE e.id=v_approval#>>'{association,evidenceId}' FOR SHARE;
    IF NOT COALESCE(v_actor.role='owner' AND NOT v_actor.restricted AND v_actor.id=v_approval->>'actorId'
      AND v_receipt."planId"=v_approval->>'planId' AND v_receipt."planHash"=v_approval->>'planHash'
      AND v_plan.state='applied' AND v_plan."planHash"=v_receipt."planHash" AND v_receipt."recoveryEpoch"=p_attempt."recoveryEpoch"
      AND v_approval->>'profileId'=v_profile.id AND (v_approval->>'profileVersionAtCapture')::integer=v_profile.version
      AND v_approval->>'seriesId'=v_value->>'seriesId'
      AND v_association."associationHash"=v_approval#>>'{association,associationHash}'
      AND v_association.evidence->>'kind'='episode' AND v_association.evidence->>'editionRootId'=v_value->>'seriesId'
      AND v_association.evidence#>>'{access,serverMachineId}'=v_approval->>'serverMachineId'
      AND v_association.evidence#>>'{access,sectionId}'=v_approval->>'sectionId'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_approval->'targets') c WHERE NOT EXISTS
        (SELECT 1 FROM jsonb_array_elements(v_receipt.selection#>'{scope,media}') selected WHERE selected->>'mediaId'=c->>'mediaId'
          AND selected->>'monitored'='true' AND selected->>'profileId'=v_profile.id)),false)
    THEN RAISE EXCEPTION 'Series pack publication actual approving owner, household policy or association changed'; END IF;
    SELECT t.* INTO v_target FROM "MediaIntent" t WHERE t."mediaId"=v_value->>'seriesId' AND t.edition='default' FOR SHARE;
    IF FOUND AND (v_target.generation>0 AND (NOT v_target."desiredPresence" OR NOT v_target.monitoring
      OR v_target."intentionallyRemovedAt" IS NOT NULL OR v_target."automationEpoch"<>p_attempt."recoveryEpoch"))
    THEN RAISE EXCEPTION 'Series pack publication original root management policy changed'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_publication_scope_v1(p_scope jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_attempt "AcquisitionAttempt"; v_seal "Operation"; v_target "MediaIntent"; v_leaf text; v_ids text[];
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=p_scope->>'attemptId' FOR UPDATE;
  SELECT o.* INTO STRICT v_seal FROM "Operation" o WHERE o.id=p_scope#>>'{stagingSeal,operationId}' FOR SHARE;
  SELECT array_agg(q.id ORDER BY q.id) INTO v_ids FROM unnest(v_attempt."mediaIds") q(id);
  IF NOT COALESCE(p_scope->>'schemaVersion'='1' AND p_scope->>'transitionId'=v_attempt.id
    AND p_scope->>'operationId'=v_attempt."coordinatorOperationId" AND p_scope->>'attemptOperationId'=v_attempt."operationId"
    AND p_scope->'birthEpoch'=to_jsonb(v_attempt."recoveryEpoch") AND p_scope->'mediaIds'=to_jsonb(v_ids)
    AND v_attempt.edition='default' AND v_attempt.state NOT IN ('imported','completed','failed','cancelled','obsolete')
    AND v_attempt."identityEvidence"->'source' ? 'seriesPackV1'
    AND v_seal.kind='seal_series_pack_staging_v1' AND v_seal.status='completed' AND v_seal."userId" IS NULL
    AND v_seal."targetId"=v_attempt.id AND v_seal.payload->>'sealHash'=p_scope#>>'{stagingSeal,sealHash}'
    AND v_seal.payload#>>'{seal,operationId}'=p_scope->>'operationId'
    AND v_seal.payload#>>'{seal,filePlanHash}'=p_scope->>'filePlanHash'
    AND (v_seal.payload->>'filePlanRaw')::jsonb=v_attempt."filePlan"
    AND v_seal.payload#>>'{seal,scope,identityHash}'=p_scope->>'identityHash'
    AND v_seal.payload#>>'{seal,scope,observationHash}'=p_scope->>'observationHash'
    AND v_seal.payload#>>'{seal,scope,generationsHash}'=p_scope->>'generationsHash'
    AND (SELECT jsonb_agg(p.row_value->'operationId' ORDER BY p.row_ordinal) FROM jsonb_array_elements(v_attempt."filePlan") WITH ORDINALITY p(row_value,row_ordinal))=p_scope->'entryOperationIds'
    AND EXISTS (SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active' AND r."ownershipConfirmed" AND r."recoveryEpoch"=v_attempt."recoveryEpoch"),false)
  THEN RAISE EXCEPTION 'Series pack publication requires its actual complete immutable staging seal'; END IF;
  PERFORM media_series_pack_current_policy_v1(v_attempt);
  FOREACH v_leaf IN ARRAY v_ids LOOP
    SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_leaf AND t.edition='default' FOR SHARE;
    IF NOT COALESCE(v_target."desiredPresence" AND v_target.monitoring AND v_target."intentionallyRemovedAt" IS NULL
      AND v_target."automationEpoch"=v_attempt."recoveryEpoch" AND v_attempt.generations->v_leaf=to_jsonb(v_target.generation)
      AND EXISTS (SELECT 1 FROM "AcquisitionReservation" reservation WHERE reservation."attemptId"=v_attempt.id
        AND reservation."mediaId"=v_leaf AND reservation.edition='default' AND reservation.generation=v_target.generation),false)
    THEN RAISE EXCEPTION 'Series pack publication whole-attempt current consent changed'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_preparation_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prepared jsonb; v_scope jsonb; v_item jsonb; v_entry jsonb; v_ordinal integer:=0; v_batch integer; v_plan jsonb;
BEGIN
  v_prepared:=NEW.payload->'prepared'; v_scope:=v_prepared->'scope'; v_batch:=(v_prepared->>'batchIndex')::integer;
  PERFORM media_series_pack_publication_scope_v1(v_scope);
  SELECT a."filePlan" INTO STRICT v_plan FROM "AcquisitionAttempt" a WHERE a.id=v_scope->>'attemptId';
  IF NOT COALESCE(NEW.status='completed' AND NEW."userId" IS NULL AND NEW.result IS NULL AND NEW."targetId"=v_scope->>'attemptId'
    AND NEW."idempotencyKey"='series-pack-publication-prepare-v1:'||(v_scope->>'attemptId')||':'||v_batch::text
    AND NEW."createdAt">=transaction_timestamp()::timestamp(3) AND NEW."createdAt"<=clock_timestamp()::timestamp(3)
    AND NEW.payload->>'kind'=NEW.kind AND NEW.payload->>'schemaVersion'='1'
    AND (NEW.payload->>'raw')::jsonb=v_prepared AND octet_length(NEW.payload->>'raw') BETWEEN 1 AND 4194304
    AND encode(sha256(convert_to(NEW.payload->>'raw','UTF8')),'hex')=NEW.payload->>'preparedHash'
    AND (NEW.payload->>'scopeRaw')::jsonb=v_scope AND encode(sha256(convert_to(NEW.payload->>'scopeRaw','UTF8')),'hex')=v_prepared->>'scopeHash'
    AND (NEW.payload->>'filePlanRaw')::jsonb=v_plan AND encode(sha256(convert_to(NEW.payload->>'filePlanRaw','UTF8')),'hex')=v_scope->>'filePlanHash'
    AND v_batch BETWEEN 0 AND 24 AND v_batch*4<jsonb_array_length(v_plan)
    AND jsonb_array_length(v_prepared->'entries')=LEAST(4,jsonb_array_length(v_plan)-v_batch*4),false)
  THEN RAISE EXCEPTION 'Series pack publication preparation needs its actual bounded whole-plan parent'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_prepared->'entries') LOOP
    v_entry:=v_item->'entry';
    IF NOT COALESCE(v_entry=v_plan->(v_batch*4+v_ordinal) AND v_entry->>'libraryKind'='tv'
      AND ((v_entry->>'previousAssetId' IS NULL AND v_item->'predecessor'='null'::jsonb) OR
        (v_item->'predecessor'=media_series_pack_asset_snapshot_v1(v_entry->>'previousAssetId')))
      AND NOT EXISTS (SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_entry->>'assetId')
      AND NOT EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s.id IN (SELECT sub->>'id' FROM jsonb_array_elements(v_entry->'embeddedSubtitles') sub)),false)
    THEN RAISE EXCEPTION 'Series pack publication preparation current inventory or member changed'; END IF;
    v_ordinal:=v_ordinal+1;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_preparation_birth BEFORE INSERT ON "Operation" FOR EACH ROW
  WHEN (NEW.kind='prepare_series_pack_publication_v1') EXECUTE FUNCTION media_series_pack_preparation_birth_v1();

CREATE FUNCTION media_series_pack_intent_closure_v1(p_intent jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ref jsonb; v_parent "Operation"; v_scope jsonb; v_first_scope jsonb; v_entries jsonb:='[]'::jsonb; v_expected integer:=0; v_plan jsonb; v_item jsonb;
BEGIN
  FOR v_ref IN SELECT value FROM jsonb_array_elements(p_intent#>'{seriesPackPublication,preparations}') LOOP
    SELECT o.* INTO STRICT v_parent FROM "Operation" o WHERE o.id=v_ref->>'operationId' FOR SHARE;
    v_scope:=v_parent.payload#>'{prepared,scope}';
    IF v_expected=0 THEN v_first_scope:=v_scope;
    ELSIF v_scope IS DISTINCT FROM v_first_scope THEN RAISE EXCEPTION 'Series pack preparation scopes must be exactly equal'; END IF;
    IF NOT COALESCE(v_parent.kind='prepare_series_pack_publication_v1' AND v_parent.status='completed'
      AND v_parent.payload->>'preparedHash'=v_ref->>'preparedHash' AND v_ref->'batchIndex'=to_jsonb(v_expected)
      AND v_parent.payload#>'{prepared,batchIndex}'=v_ref->'batchIndex' AND v_parent."targetId"=p_intent->>'attemptId'
      AND v_scope->>'transitionId'=p_intent->>'transitionId' AND v_scope->>'filePlanHash'=p_intent->>'filePlanHash'
      AND v_scope->>'operationId'=p_intent#>>'{seriesPackPublication,coordinatorOperationId}'
      AND v_scope->'birthEpoch'=p_intent->'birthEpoch' AND v_scope->>'attemptOperationId'=p_intent->>'operationId'
      AND v_scope->'stagingSeal'=p_intent#>'{seriesPackPublication,stagingSeal}'
      AND v_scope->'mediaIds'=p_intent->'mediaIds',false)
    THEN RAISE EXCEPTION 'Series pack publication intent lost an exact preparation parent'; END IF;
    v_entries:=v_entries||(v_parent.payload#>'{prepared,entries}'); v_expected:=v_expected+1;
  END LOOP;
  SELECT a."filePlan" INTO STRICT v_plan FROM "AcquisitionAttempt" a WHERE a.id=p_intent->>'attemptId';
  IF NOT COALESCE(v_expected=ceil(jsonb_array_length(v_plan)/4.0)::integer AND v_entries=p_intent->'entries'
    AND jsonb_array_length(v_entries)=jsonb_array_length(v_plan),false)
  THEN RAISE EXCEPTION 'Series pack publication intent must seal every exact disjoint preparation'; END IF;
  -- All actual immutable parents were individually read and matched first.
  -- Their one identical current policy is revalidated once under the same locks.
  PERFORM media_series_pack_publication_scope_v1(v_first_scope);
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
    IF NOT COALESCE(((v_item#>>'{entry,previousAssetId}' IS NULL AND v_item->'predecessor'='null'::jsonb) OR
      v_item->'predecessor'=media_series_pack_asset_snapshot_v1(v_item#>>'{entry,previousAssetId}'))
      AND NOT EXISTS (SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_item#>>'{entry,assetId}')
      AND NOT EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s.id IN (SELECT sub->>'id' FROM jsonb_array_elements(v_item#>'{entry,embeddedSubtitles}') sub)),false)
    THEN RAISE EXCEPTION 'Series pack publication sealed predecessor inventory changed'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_begin_commit_v1(p_transition_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_transition "MediaPublicationTransition";
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT t.* INTO STRICT v_transition FROM "MediaPublicationTransition" t WHERE t.id=p_transition_id FOR UPDATE;
  IF v_transition.intent->>'schemaVersion'<>'3' OR v_transition.outcome IS NOT NULL
  THEN RAISE EXCEPTION 'Series pack publication commit requires its original unsettled v3 intent'; END IF;
  PERFORM media_series_pack_intent_closure_v1(v_transition.intent);
  PERFORM set_config('media.series_pack_publication_write',p_transition_id,true);
END;
$$;

CREATE FUNCTION media_series_pack_physical_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_command jsonb; v_completion jsonb; v_transition "MediaPublicationTransition"; v_prepared "Operation"; v_prior "Operation"; v_batch integer; v_entry_ids jsonb;
BEGIN
  PERFORM media_plex_assert_deadline(); v_command:=NEW.payload->'command'; v_completion:=NEW.result->'completion'; v_batch:=(v_command->>'batchIndex')::integer;
  SELECT t.* INTO STRICT v_transition FROM "MediaPublicationTransition" t WHERE t.id=v_command->>'transitionId' FOR UPDATE;
  SELECT o.* INTO STRICT v_prepared FROM "Operation" o WHERE o.id=v_transition.intent#>>ARRAY['seriesPackPublication','preparations',v_batch::text,'operationId'];
  PERFORM media_series_pack_publication_scope_v1(v_prepared.payload#>'{prepared,scope}');
  SELECT jsonb_agg(p.row_value#>'{entry,operationId}' ORDER BY p.row_ordinal) INTO v_entry_ids FROM jsonb_array_elements(v_prepared.payload#>'{prepared,entries}') WITH ORDINALITY p(row_value,row_ordinal);
  IF NOT COALESCE(v_transition.intent->>'schemaVersion'='3' AND v_transition.outcome IS NULL
    AND NEW.status='completed' AND NEW."userId" IS NULL AND NEW."targetId"=v_transition."attemptId"
    AND NEW."createdAt">=transaction_timestamp()::timestamp(3) AND NEW."createdAt"<=clock_timestamp()::timestamp(3)
    AND NEW."idempotencyKey"='series-pack-publication-physical-v1:'||v_transition."attemptId"||':'||v_batch::text
    AND v_command->>'kind'=NEW.kind AND v_command->>'attemptId'=v_transition."attemptId" AND v_command->>'intentHash'=v_transition."intentHash"
    AND v_command->>'operationId'=v_transition.intent#>>'{seriesPackPublication,coordinatorOperationId}'
    AND v_command->'entryOperationIds'=v_entry_ids AND v_batch BETWEEN 0 AND 24
    AND (NEW.payload->>'raw')::jsonb=v_command AND encode(sha256(convert_to(NEW.payload->>'raw','UTF8')),'hex')=NEW.payload->>'commandHash'
    AND (NEW.result->>'raw')::jsonb=v_completion AND encode(sha256(convert_to(NEW.result->>'raw','UTF8')),'hex')=NEW.result->>'completionHash'
    AND v_completion->>'commandHash'=NEW.payload->>'commandHash'
    AND (SELECT jsonb_agg(p.row_value->'entryOperationId' ORDER BY p.row_ordinal) FROM jsonb_array_elements(v_completion->'entries') WITH ORDINALITY p(row_value,row_ordinal))=v_entry_ids
    AND (v_completion->>'completedAt')::timestamp>=transaction_timestamp()::timestamp(3)
    AND (v_completion->>'completedAt')::timestamp<=clock_timestamp()::timestamp(3),false)
  THEN RAISE EXCEPTION 'Series pack physical publication requires its exact original prepared batch'; END IF;
  IF v_batch>0 THEN
    SELECT o.* INTO STRICT v_prior FROM "Operation" o WHERE o."idempotencyKey"='series-pack-publication-physical-v1:'||v_transition."attemptId"||':'||(v_batch-1)::text;
    IF NOT COALESCE(v_prior.kind=NEW.kind AND v_prior.status='completed' AND v_prior.payload#>>'{command,intentHash}'=v_transition."intentHash"
      AND jsonb_array_length(v_completion->'effects')>jsonb_array_length(v_prior.result#>'{completion,effects}')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_prior.result#>'{completion,effects}') WITH ORDINALITY p(row_value,row_ordinal)
        WHERE v_completion->'effects'->((p.row_ordinal-1)::integer) IS DISTINCT FROM p.row_value),false)
    THEN RAISE EXCEPTION 'Series pack physical publication must extend its actual contiguous prefix'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_completion->'effects') WITH ORDINALITY p(row_value,row_ordinal)
    WHERE p.row_value->'ordinal'<>to_jsonb(p.row_ordinal-1)) THEN RAISE EXCEPTION 'Series pack physical effect ordinals changed'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_physical_birth BEFORE INSERT ON "Operation" FOR EACH ROW
  WHEN (NEW.kind='publish_series_pack_members_v1') EXECUTE FUNCTION media_series_pack_physical_birth_v1();

CREATE FUNCTION media_series_pack_outcome_closure_v1(p_transition "MediaPublicationTransition",p_outcome jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ref jsonb; v_parent "Operation"; v_attempt "AcquisitionAttempt"; v_item jsonb; v_original jsonb; v_expected integer:=0; v_ids jsonb:='[]'::jsonb; v_last_effects jsonb; v_physical_entries jsonb:='[]'::jsonb;
BEGIN
  PERFORM media_plex_assert_deadline();
  IF p_outcome->>'kind'='compensated' THEN
    PERFORM media_series_pack_compensated_closure_v1(p_transition,p_outcome);
    RETURN;
  END IF;
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=p_transition."attemptId" FOR UPDATE;
  IF NOT COALESCE(p_outcome->>'schemaVersion'='3' AND p_outcome->>'transitionId'=p_transition.id
    AND p_outcome->>'intentHash'=p_transition."intentHash" AND p_outcome->>'filePlanHash'=p_transition."filePlanHash"
    AND p_outcome->'birthEpoch'=to_jsonb(p_transition."birthEpoch") AND p_outcome->>'kind'='published'
    AND v_attempt.state='imported' AND EXISTS (SELECT 1 FROM "AcquisitionAttempt" a WHERE a.id=v_attempt.id AND a.xmin::text=pg_current_xact_id()::text)
    AND current_setting('media.series_pack_publication_write',true)=p_transition.id,false)
  THEN RAISE EXCEPTION 'Series pack publication completion needs its actual same-transaction publication'; END IF;
  FOR v_ref IN SELECT value FROM jsonb_array_elements(p_outcome#>'{seriesPackPublication,publishReceipts}') LOOP
    SELECT o.* INTO STRICT v_parent FROM "Operation" o WHERE o.id=v_ref->>'operationId' FOR SHARE;
    IF NOT COALESCE(v_parent.kind='publish_series_pack_members_v1' AND v_parent.status='completed'
      AND v_parent."targetId"=p_transition."attemptId" AND v_parent.payload#>>'{command,intentHash}'=p_transition."intentHash"
      AND v_parent.payload#>'{command,batchIndex}'=to_jsonb(v_expected) AND v_ref->'batchIndex'=to_jsonb(v_expected)
      AND v_ref->>'completionHash'=v_parent.result->>'completionHash',false)
    THEN RAISE EXCEPTION 'Series pack publication completion lost an actual physical batch'; END IF;
    v_ids:=v_ids||(v_parent.payload#>'{command,entryOperationIds}'); v_last_effects:=v_parent.result#>'{completion,effects}';
    v_physical_entries:=v_physical_entries||(v_parent.result#>'{completion,entries}'); v_expected:=v_expected+1;
  END LOOP;
  IF NOT COALESCE(v_expected=jsonb_array_length(p_transition.intent#>'{seriesPackPublication,preparations}')
    AND v_last_effects=p_outcome->'effects' AND v_ids=(SELECT jsonb_agg(p.row_value#>'{entry,operationId}' ORDER BY p.row_ordinal)
      FROM jsonb_array_elements(p_transition.intent->'entries') WITH ORDINALITY p(row_value,row_ordinal))
    AND jsonb_array_length(p_outcome->'entries')=jsonb_array_length(p_transition.intent->'entries'),false)
  THEN RAISE EXCEPTION 'Series pack publication completion must close the complete original physical partition'; END IF;
  v_expected:=0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_outcome->'entries') LOOP
    v_original:=p_transition.intent->'entries'->v_expected;
    IF NOT COALESCE(v_item->>'entryOperationId'=v_original#>>'{entry,operationId}'
      AND v_item->'participants'=v_physical_entries->v_expected->'participants'
      AND v_item->'journals'=v_physical_entries->v_expected->'journals'
      AND v_item->'successor'=media_series_pack_asset_snapshot_v1(v_original#>>'{entry,assetId}')
      AND v_item#>>'{successor,state}'='published' AND v_item#>>'{successor,checksum}'=v_original#>>'{entry,checksum}'
      AND v_item#>'{successor,owned}'='true'::jsonb AND v_item#>'{successor,ownershipEpoch}'=to_jsonb(p_transition."birthEpoch")
      AND v_item#>>'{successor,edition}'='default' AND v_item#>'{successor,version}'='0'::jsonb
      AND v_item#>>'{successor,sizeBytes}'=v_original#>>'{entry,sizeBytes}' AND v_item#>'{successor,properties}'=v_original#>'{entry,properties}'
      AND EXISTS (SELECT 1 FROM "MediaIntent" t WHERE t."mediaId"=v_original#>>'{entry,mediaIds,0}' AND t.edition='default'
        AND t."editionRootId"=v_item#>>'{successor,editionRootId}')
      AND ((v_original#>>'{entry,previousAssetId}' IS NULL AND v_item->'predecessor'='null'::jsonb) OR
        (v_item->'predecessor'=media_series_pack_asset_snapshot_v1(v_original#>>'{entry,previousAssetId}')
          AND v_item#>>'{predecessor,state}'='superseded'
          AND v_item#>>'{predecessor,supersededByAssetId}'=v_original#>>'{entry,assetId}'
          AND (v_item#>>'{predecessor,version}')::integer=(v_original#>>'{predecessor,version}')::integer+1
          AND (v_item->'predecessor')-ARRAY['path','state','supersededByAssetId','version','coverage','subtitles']
            =(v_original->'predecessor')-ARRAY['path','state','supersededByAssetId','version','coverage','subtitles']
          AND EXISTS (SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_original#>>'{entry,previousAssetId}' AND a.xmin::text=pg_current_xact_id()::text)))
      AND EXISTS (SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_original#>>'{entry,assetId}' AND a.xmin::text=pg_current_xact_id()::text)
      AND NOT EXISTS (SELECT 1 FROM "AssetCoverage" c WHERE c."assetId"=v_original#>>'{entry,assetId}' AND c.xmin::text<>pg_current_xact_id()::text)
      AND NOT EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s."assetId"=v_original#>>'{entry,assetId}' AND s.xmin::text<>pg_current_xact_id()::text)
      AND (SELECT count(*) FROM "SubtitleAsset" s WHERE s."assetId"=v_original#>>'{entry,assetId}')=jsonb_array_length(v_original#>'{entry,embeddedSubtitles}')
      AND NOT EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s."assetId"=v_original#>>'{entry,assetId}' AND NOT EXISTS
        (SELECT 1 FROM jsonb_array_elements(v_original#>'{entry,embeddedSubtitles}') descriptor
          WHERE descriptor->>'id'=s.id AND descriptor->>'checksum'=s.checksum AND descriptor->>'language'=s.language
            AND encode(sha256(s.content),'hex')=s.checksum AND s.state='validated' AND s."qualityStatus"='accepted'
            AND s."storageKind"='sidecar' AND s."providerId"='embedded' AND s."ownershipEpoch"=p_transition."birthEpoch"
            AND s."videoChecksum"=v_original#>>'{entry,checksum}' AND s."videoVersion"=0
            AND s."matchingEvidence"->'generations'=v_original#>'{entry,generations}')),false)
    THEN RAISE EXCEPTION 'Series pack publication after-image must equal real same-transaction write acknowledgements'; END IF;
    v_expected:=v_expected+1;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_seal_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_transition "MediaPublicationTransition"; v_outcome jsonb;
BEGIN
  v_outcome:=NEW.payload->'outcome';
  SELECT t.* INTO STRICT v_transition FROM "MediaPublicationTransition" t WHERE t.id=v_outcome->>'transitionId' FOR UPDATE;
  IF NOT COALESCE(NEW.status='completed' AND NEW."userId" IS NULL AND NEW.result IS NULL
    AND NEW."targetId"=v_transition."attemptId" AND NEW.payload->>'attemptId'=v_transition."attemptId"
    AND NEW.payload->>'operationId'=v_transition.intent#>>'{seriesPackPublication,coordinatorOperationId}'
    AND NEW.payload->>'intentHash'=v_transition."intentHash" AND v_transition.outcome IS NULL
    AND NEW.id=v_outcome#>>'{seriesPackPublication,sealOperationId}'
    AND NEW."idempotencyKey"='series-pack-publication-seal-v1:'||v_transition."attemptId"
    AND NEW."createdAt">=transaction_timestamp()::timestamp(3) AND NEW."createdAt"<=clock_timestamp()::timestamp(3)
    AND (NEW.payload->>'raw')::jsonb=v_outcome AND octet_length(NEW.payload->>'raw') BETWEEN 1 AND 16777216
    AND encode(sha256(convert_to(NEW.payload->>'raw','UTF8')),'hex')=NEW.payload->>'outcomeHash'
    AND (v_outcome->>'completedAt')::timestamp>=transaction_timestamp()::timestamp(3)
    AND (v_outcome->>'completedAt')::timestamp<=clock_timestamp()::timestamp(3),false)
  THEN RAISE EXCEPTION 'Series pack publication final seal needs the actual immutable raw outcome'; END IF;
  PERFORM media_series_pack_outcome_closure_v1(v_transition,v_outcome);
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_publication_seal_birth BEFORE INSERT ON "Operation" FOR EACH ROW
  WHEN (NEW.kind='seal_series_pack_publication_v1') EXECUTE FUNCTION media_series_pack_seal_birth_v1();

CREATE FUNCTION media_series_pack_transition_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_seal "Operation";
BEGIN
  IF NEW.intent->>'schemaVersion'<>'3' THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.outcome IS NOT NULL THEN RAISE EXCEPTION 'Series pack publication intent must precede every effect'; END IF;
    PERFORM media_series_pack_intent_closure_v1(NEW.intent);
  ELSIF OLD.outcome IS NULL AND NEW.outcome IS NOT NULL THEN
    SELECT o.* INTO STRICT v_seal FROM "Operation" o WHERE o.id=NEW.outcome#>>'{seriesPackPublication,sealOperationId}';
    IF NOT COALESCE(v_seal.kind='seal_series_pack_publication_v1' AND v_seal.status='completed'
      AND EXISTS (SELECT 1 FROM "Operation" o WHERE o.id=v_seal.id AND o.xmin::text=pg_current_xact_id()::text) AND v_seal.payload->'outcome'=NEW.outcome
      AND v_seal.payload->>'outcomeHash'=NEW."outcomeHash",false)
    THEN RAISE EXCEPTION 'Series pack publication outcome requires its actual same-transaction final seal'; END IF;
    PERFORM media_series_pack_outcome_closure_v1(NEW,NEW.outcome);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_publication_transition BEFORE INSERT OR UPDATE ON "MediaPublicationTransition"
  FOR EACH ROW EXECUTE FUNCTION media_series_pack_transition_v1();

CREATE FUNCTION media_series_pack_publication_parent_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Series pack publication batch and completion parents are immutable'; END;
$$;
CREATE TRIGGER series_pack_publication_parent_immutable BEFORE UPDATE OR DELETE ON "Operation" FOR EACH ROW
  WHEN (OLD.kind IN ('prepare_series_pack_publication_v1','publish_series_pack_members_v1','compensate_series_pack_members_v1','seal_series_pack_publication_v1'))
  EXECUTE FUNCTION media_series_pack_publication_parent_immutable_v1();

CREATE FUNCTION media_series_pack_publication_no_outbox_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Operation" o WHERE o.id=NEW."operationId" AND o.kind IN
    ('prepare_series_pack_publication_v1','publish_series_pack_members_v1','compensate_series_pack_members_v1','seal_series_pack_publication_v1'))
  THEN RAISE EXCEPTION 'Series pack publication evidence cannot dispatch a fabricated command'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_publication_no_outbox BEFORE INSERT OR UPDATE ON "OutboxCommand"
  FOR EACH ROW EXECUTE FUNCTION media_series_pack_publication_no_outbox_v1();

CREATE FUNCTION media_series_pack_pending_inventory_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_asset_id text; v_transition "MediaPublicationTransition";
BEGIN
  IF TG_TABLE_NAME='LibraryAsset' THEN
    IF TG_OP='DELETE' THEN v_asset_id:=OLD.id; ELSE v_asset_id:=NEW.id; END IF;
  ELSE
    IF TG_OP='DELETE' THEN v_asset_id:=OLD."assetId"; ELSE v_asset_id:=NEW."assetId"; END IF;
  END IF;
  FOR v_transition IN SELECT t.* FROM "MediaPublicationTransition" t WHERE t.intent->>'schemaVersion'='3' AND t.outcome IS NULL
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.intent->'entries') item
      WHERE item#>>'{entry,assetId}'=v_asset_id OR item#>>'{entry,previousAssetId}'=v_asset_id) LOOP
    IF current_setting('media.series_pack_publication_write',true) IS DISTINCT FROM v_transition.id
    THEN RAISE EXCEPTION 'Pending whole-pack publication inventory is fenced'; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER series_pack_pending_asset BEFORE INSERT OR UPDATE OR DELETE ON "LibraryAsset" FOR EACH ROW EXECUTE FUNCTION media_series_pack_pending_inventory_v1();
CREATE TRIGGER series_pack_pending_coverage BEFORE INSERT OR UPDATE OR DELETE ON "AssetCoverage" FOR EACH ROW EXECUTE FUNCTION media_series_pack_pending_inventory_v1();
CREATE TRIGGER series_pack_pending_subtitle BEFORE INSERT OR UPDATE OR DELETE ON "SubtitleAsset" FOR EACH ROW EXECUTE FUNCTION media_series_pack_pending_inventory_v1();

CREATE FUNCTION media_series_pack_write_must_settle_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_publication_transition_id text;
BEGIN
  v_publication_transition_id:=current_setting('media.series_pack_publication_write',true);
  IF v_publication_transition_id IS NOT NULL AND v_publication_transition_id<>'' AND EXISTS (SELECT 1 FROM "MediaPublicationTransition" t WHERE t.id=v_publication_transition_id AND t.outcome IS NULL)
  THEN RAISE EXCEPTION 'Whole-pack DB publication cannot commit without its actual completion seal'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER series_pack_write_must_settle AFTER INSERT OR UPDATE ON "LibraryAsset"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_series_pack_write_must_settle_v1();

CREATE FUNCTION media_series_pack_begin_inverse_v1(p_transition_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_transition "MediaPublicationTransition"; v_attempt "AcquisitionAttempt"; v_item jsonb;
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT t.* INTO STRICT v_transition FROM "MediaPublicationTransition" t WHERE t.id=p_transition_id FOR UPDATE;
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=v_transition."attemptId" FOR UPDATE;
  IF NOT COALESCE(v_transition.intent->>'schemaVersion'='3' AND v_transition.outcome IS NULL
    AND v_attempt.state NOT IN ('imported','completed') AND v_attempt."recoveryEpoch"=v_transition."birthEpoch"
    AND v_attempt."coordinatorOperationId"=v_transition.intent#>>'{seriesPackPublication,coordinatorOperationId}'
    AND EXISTS (SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active'
      AND r."ownershipConfirmed" AND r."recoveryEpoch"=v_transition."birthEpoch"),false)
  THEN RAISE EXCEPTION 'Series pack inverse requires the actual owned uncommitted original attempt'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_transition.intent->'entries') LOOP
    IF NOT COALESCE(((v_item#>>'{entry,previousAssetId}' IS NULL AND v_item->'predecessor'='null'::jsonb) OR
      v_item->'predecessor'=media_series_pack_asset_snapshot_v1(v_item#>>'{entry,previousAssetId}'))
      AND NOT EXISTS (SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_item#>>'{entry,assetId}'),false)
    THEN RAISE EXCEPTION 'Series pack inverse cannot reinterpret committed or changed DB inventory'; END IF;
  END LOOP;
  PERFORM set_config('media.series_pack_publication_write',p_transition_id,true);
END;
$$;

CREATE FUNCTION media_series_pack_inverse_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_command jsonb; v_completion jsonb; v_transition "MediaPublicationTransition"; v_prior "Operation"; v_batch integer; v_expected_ids jsonb;
BEGIN
  PERFORM media_plex_assert_deadline(); v_command:=NEW.payload->'command'; v_completion:=NEW.result->'completion'; v_batch:=(v_command->>'batchIndex')::integer;
  SELECT t.* INTO STRICT v_transition FROM "MediaPublicationTransition" t WHERE t.id=v_command->>'transitionId' FOR UPDATE;
  PERFORM media_series_pack_begin_inverse_v1(v_transition.id);
  SELECT jsonb_agg(p.row_value#>'{entry,operationId}' ORDER BY p.row_ordinal) INTO v_expected_ids
    FROM jsonb_array_elements(v_transition.intent->'entries') WITH ORDINALITY p(row_value,row_ordinal) WHERE p.row_ordinal>v_batch*4 AND p.row_ordinal<=v_batch*4+4;
  IF NOT COALESCE(v_transition.outcome IS NULL AND NEW.status='completed' AND NEW."userId" IS NULL
    AND NEW."targetId"=v_transition."attemptId" AND v_command->>'attemptId'=v_transition."attemptId"
    AND v_command->>'operationId'=v_transition.intent#>>'{seriesPackPublication,coordinatorOperationId}'
    AND v_command->>'intentHash'=v_transition."intentHash" AND v_command->>'kind'=NEW.kind
    AND NEW."idempotencyKey"='series-pack-publication-inverse-v1:'||v_transition."attemptId"||':'||v_batch::text
    AND v_batch BETWEEN 0 AND 24 AND v_command->'entryOperationIds'=v_expected_ids
    AND (NEW.payload->>'raw')::jsonb=v_command AND encode(sha256(convert_to(NEW.payload->>'raw','UTF8')),'hex')=NEW.payload->>'commandHash'
    AND (NEW.result->>'raw')::jsonb=v_completion AND encode(sha256(convert_to(NEW.result->>'raw','UTF8')),'hex')=NEW.result->>'completionHash'
    AND v_completion->>'commandHash'=NEW.payload->>'commandHash'
    AND (SELECT jsonb_agg(p.row_value->'entryOperationId' ORDER BY p.row_ordinal) FROM jsonb_array_elements(v_completion->'entries') WITH ORDINALITY p(row_value,row_ordinal))=v_expected_ids
    AND NEW."createdAt">=transaction_timestamp()::timestamp(3) AND NEW."createdAt"<=clock_timestamp()::timestamp(3),false)
  THEN RAISE EXCEPTION 'Series pack inverse needs its exact original bounded causal receipt'; END IF;
  IF v_batch>0 THEN
    SELECT o.* INTO STRICT v_prior FROM "Operation" o WHERE o."idempotencyKey"='series-pack-publication-inverse-v1:'||v_transition."attemptId"||':'||(v_batch-1)::text;
    IF NOT COALESCE(v_prior.status='completed' AND v_prior.payload#>>'{command,intentHash}'=v_transition."intentHash"
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_prior.result#>'{completion,effects}') WITH ORDINALITY p(row_value,row_ordinal)
        WHERE v_completion->'effects'->((p.row_ordinal-1)::integer) IS DISTINCT FROM p.row_value),false)
    THEN RAISE EXCEPTION 'Series pack inverse lost its actual contiguous causal prefix'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_inverse_birth BEFORE INSERT ON "Operation" FOR EACH ROW
  WHEN (NEW.kind='compensate_series_pack_members_v1') EXECUTE FUNCTION media_series_pack_inverse_birth_v1();

CREATE FUNCTION media_series_pack_compensated_closure_v1(p_transition "MediaPublicationTransition",p_outcome jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ref jsonb; v_parent "Operation"; v_item jsonb; v_original jsonb; v_ordinal integer:=0; v_prefix jsonb; v_expected integer:=0;
  v_physical_entries jsonb:='[]'::jsonb;
BEGIN
  IF NOT COALESCE(p_outcome->>'schemaVersion'='3' AND p_outcome->>'transitionId'=p_transition.id
    AND p_outcome->>'intentHash'=p_transition."intentHash" AND p_outcome->>'filePlanHash'=p_transition."filePlanHash"
    AND p_outcome->'birthEpoch'=to_jsonb(p_transition."birthEpoch")
    AND current_setting('media.series_pack_publication_write',true)=p_transition.id
    AND EXISTS (SELECT 1 FROM "AcquisitionAttempt" a WHERE a.id=p_transition."attemptId" AND a.state='obsolete' AND a.xmin::text=pg_current_xact_id()::text)
    AND NOT EXISTS (SELECT 1 FROM "AcquisitionReservation" r WHERE r."attemptId"=p_transition."attemptId"),false)
  THEN RAISE EXCEPTION 'Series pack compensation must settle the actual uncommitted attempt in the same transaction'; END IF;
  FOR v_ref IN SELECT value FROM jsonb_array_elements(p_outcome#>'{seriesPackPublication,publishReceipts}') LOOP
    SELECT o.* INTO STRICT v_parent FROM "Operation" o WHERE o.id=v_ref->>'operationId' FOR SHARE;
    IF NOT COALESCE(v_parent.kind='publish_series_pack_members_v1' AND v_parent.status='completed'
      AND v_parent."targetId"=p_transition."attemptId" AND v_parent.payload#>>'{command,intentHash}'=p_transition."intentHash"
      AND v_parent.payload#>'{command,batchIndex}'=to_jsonb(v_expected) AND v_ref->'batchIndex'=to_jsonb(v_expected)
      AND v_parent.result->>'completionHash'=v_ref->>'completionHash',false)
    THEN RAISE EXCEPTION 'Series pack compensation changed an actual completed forward parent'; END IF;
    v_expected:=v_expected+1;
  END LOOP;
  IF v_expected<>(SELECT count(*) FROM "Operation" o WHERE o.kind='publish_series_pack_members_v1' AND o."targetId"=p_transition."attemptId")
  THEN RAISE EXCEPTION 'Series pack compensation omitted a completed forward parent'; END IF;
  v_expected:=0;
  FOR v_ref IN SELECT value FROM jsonb_array_elements(p_outcome#>'{seriesPackPublication,compensationReceipts}') LOOP
    SELECT o.* INTO STRICT v_parent FROM "Operation" o WHERE o.id=v_ref->>'operationId' FOR SHARE;
    IF NOT COALESCE(v_parent.kind='compensate_series_pack_members_v1' AND v_parent.status='completed'
      AND v_parent."targetId"=p_transition."attemptId" AND v_parent.payload#>>'{command,intentHash}'=p_transition."intentHash"
      AND v_parent.payload#>'{command,batchIndex}'=to_jsonb(v_expected) AND v_ref->'batchIndex'=to_jsonb(v_expected)
      AND v_parent.result->>'completionHash'=v_ref->>'completionHash',false)
    THEN RAISE EXCEPTION 'Series pack compensation needs every actual inverse batch'; END IF;
    v_prefix:=v_parent.result#>'{completion,effects}';
    v_physical_entries:=v_physical_entries||(v_parent.result#>'{completion,entries}'); v_expected:=v_expected+1;
  END LOOP;
  IF NOT COALESCE(v_expected=jsonb_array_length(p_transition.intent#>'{seriesPackPublication,preparations}')
    AND v_prefix=p_outcome->'effects' AND jsonb_array_length(p_outcome->'entries')=jsonb_array_length(p_transition.intent->'entries'),false)
  THEN RAISE EXCEPTION 'Series pack compensation omitted its whole actual inverse'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_outcome->'entries') LOOP
    v_original:=p_transition.intent->'entries'->v_ordinal;
    IF NOT COALESCE(v_item->>'entryOperationId'=v_original#>>'{entry,operationId}' AND v_item->'successor'='null'::jsonb
      AND v_item->'participants'=v_physical_entries->v_ordinal->'participants'
      AND v_item->'journals'=v_physical_entries->v_ordinal->'journals'
      AND v_item->'predecessor'=v_original->'predecessor'
      AND (v_item->'predecessor'='null'::jsonb OR v_item->'predecessor'=media_series_pack_asset_snapshot_v1(v_original#>>'{entry,previousAssetId}'))
      AND NOT EXISTS (SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_original#>>'{entry,assetId}'),false)
    THEN RAISE EXCEPTION 'Series pack compensation cannot acknowledge an unproven or committed DB inventory'; END IF;
    v_ordinal:=v_ordinal+1;
  END LOOP;
END;
$$;
