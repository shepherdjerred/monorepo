-- Draft protocol2/scope3. Historical intent/descriptor/batch objects stay literal.
-- This entire migration must ship with its actual reader/writer/worker closure.

CREATE FUNCTION media_series_pack_native_before_v1(p_intent jsonb,p_epoch integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_item jsonb; v_predecessor jsonb;
BEGIN
  IF NOT COALESCE(p_intent->>'schemaVersion'='3'
    AND jsonb_array_length(p_intent->'entries') BETWEEN 1 AND 25
    AND (p_intent->>'birthEpoch')::integer<p_epoch,false)
  THEN RAISE EXCEPTION 'Native pack recovery requires a complete prior-epoch v3 intent'; END IF;
  FOR v_item IN SELECT i.value FROM jsonb_array_elements(p_intent->'entries') i LOOP
    v_predecessor:=v_item->'predecessor';
    IF NOT COALESCE(v_item#>>'{entry,libraryKind}'='tv' AND v_predecessor<>'null'::jsonb
      AND v_predecessor->>'id'=v_item#>>'{entry,previousAssetId}'
      AND v_predecessor->>'state'='published' AND v_predecessor->'owned'='true'::jsonb
      AND (v_predecessor->>'ownershipEpoch')::integer<p_epoch
      AND v_predecessor=media_series_pack_asset_snapshot_v1(v_predecessor->>'id')
      AND NOT EXISTS(SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_item#>>'{entry,assetId}'),false)
    THEN RAISE EXCEPTION 'Native pack recovery actual whole before-inventory changed'; END IF;
  END LOOP;
END;
$$;

-- Current whole cohort equality, using the actual reviewed JSON only as CAS
-- input. jsonb_populate_record uses PostgreSQL timestamp parsing so ISO strings
-- and stored timestamp precision compare as values, never reserialized hashes.
CREATE FUNCTION media_series_pack_native_scope_current_v1(p_scope jsonb,p_selection jsonb,p_after boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_media jsonb; v_actual "MediaItem"; v_parent "MediaItem"; v_root "MediaItem";
  v_intent "MediaIntent"; v_expected_intent "MediaIntent"; v_profile "QualityProfile"; v_hold jsonb;
  v_ids text[]; v_ancestors text[]; v_epoch integer; v_expected_count integer;
BEGIN
  v_epoch:=(p_scope#>>'{request,recoveryEpoch}')::integer;
  SELECT array_agg(e.value->>'id') INTO v_ids FROM jsonb_array_elements(p_scope->'media') e;
  IF cardinality(v_ids) NOT BETWEEN 1 AND 100 OR cardinality(v_ids)<>(SELECT count(DISTINCT e.id) FROM unnest(v_ids) e(id))
    OR NOT EXISTS(SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r."recoveryEpoch"=v_epoch)
  THEN RAISE EXCEPTION 'Native pack current whole scope or recovery epoch changed'; END IF;
  FOR v_media IN SELECT e.value FROM jsonb_array_elements(p_scope->'media') e LOOP
    SELECT m.* INTO STRICT v_actual FROM "MediaItem" m WHERE m.id=v_media->>'id' FOR UPDATE;
    SELECT i.* INTO STRICT v_intent FROM "MediaIntent" i WHERE i."mediaId"=v_actual.id AND i.edition='default' FOR UPDATE;
    SELECT * INTO v_expected_intent FROM jsonb_populate_record(NULL::"MediaIntent",v_media->'intent');
    IF NOT COALESCE(v_actual.kind='episode' AND v_actual.kind::text=v_media->>'kind'
      AND v_actual.title=v_media->>'title' AND v_actual.version=(v_media->>'version')::integer+CASE WHEN p_after THEN 1 ELSE 0 END
      AND COALESCE(to_jsonb(v_actual."tmdbId"),'null'::jsonb) IS NOT DISTINCT FROM v_media->'tmdbId'
      AND v_actual."externalIds" IS NOT DISTINCT FROM v_media->'externalIds'
      AND to_jsonb(v_actual."seasonNumber") IS NOT DISTINCT FROM v_media->'seasonNumber'
      AND to_jsonb(v_actual."episodeNumber") IS NOT DISTINCT FROM v_media->'episodeNumber'
      AND (to_jsonb(v_intent)-ARRAY['edition','editionRootId','availability','libraryMonitoring']-CASE WHEN p_after THEN 'updatedAt' ELSE '_absent' END)=
        (to_jsonb(v_expected_intent)-ARRAY['edition','editionRootId','availability','libraryMonitoring']-CASE WHEN p_after THEN 'updatedAt' ELSE '_absent' END)
      AND (NOT p_after OR (v_actual.availability='importing' AND v_intent.availability='importing')) ,false)
    THEN RAISE EXCEPTION 'Native pack current catalog or target differs from the actual reviewed whole scope'; END IF;
    SELECT m.* INTO STRICT v_parent FROM "MediaItem" m WHERE m.id=v_actual."parentId" FOR SHARE;
    SELECT m.* INTO STRICT v_root FROM "MediaItem" m WHERE m.id=v_parent."parentId" FOR SHARE;
    IF NOT COALESCE(v_parent.id=v_media#>>'{parent,id}' AND v_parent.version=(v_media#>>'{parent,version}')::integer
      AND COALESCE(to_jsonb(v_parent."tmdbId"),'null'::jsonb) IS NOT DISTINCT FROM v_media#>'{parent,tmdbId}'
      AND v_parent."externalIds" IS NOT DISTINCT FROM v_media#>'{parent,externalIds}'
      AND v_root.id=v_media#>>'{parent,parent,id}' AND v_root.version=(v_media#>>'{parent,parent,version}')::integer
      AND COALESCE(to_jsonb(v_root."tmdbId"),'null'::jsonb) IS NOT DISTINCT FROM v_media#>'{parent,parent,tmdbId}'
      AND v_root."externalIds" IS NOT DISTINCT FROM v_media#>'{parent,parent,externalIds}',false)
    THEN RAISE EXCEPTION 'Native pack current canonical ancestry changed'; END IF;
    v_ancestors:=array_append(array_append(v_ancestors,v_parent.id),v_root.id);
    IF v_media->'profile'='null'::jsonb THEN
      IF v_intent."profileId" IS NOT NULL THEN RAISE EXCEPTION 'Native pack current profile changed'; END IF;
    ELSE
      SELECT p.* INTO STRICT v_profile FROM "QualityProfile" p WHERE p.id=v_intent."profileId" FOR SHARE;
      IF NOT COALESCE(v_profile.id=v_media#>>'{profile,id}' AND v_profile.version=(v_media#>>'{profile,version}')::integer
        AND v_profile.rules=v_media#>'{profile,rules}',false)
      THEN RAISE EXCEPTION 'Native pack current profile differs from the actual owner-reviewed profile'; END IF;
    END IF;
  END LOOP;
  -- Literal old household wire excludes only fields which never belonged to it.
  IF EXISTS(SELECT 1 FROM "MediaRequest" r WHERE r.edition='default' AND
      (r."mediaId"=ANY(v_ids||v_ancestors) OR r.id IN(SELECT c."rootRequestId" FROM "RequestCoverage" c WHERE c.edition='default' AND c."mediaId"=ANY(v_ids)))
      AND NOT EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::"MediaRequest",p_scope#>'{household,requests}') e
        WHERE (to_jsonb(r)-ARRAY['edition','movieEditionChoiceId','movieEditionChoiceRevision'])=
          (to_jsonb(e)-ARRAY['edition','movieEditionChoiceId','movieEditionChoiceRevision'])))
    OR (SELECT count(*) FROM "MediaRequest" r WHERE r.edition='default' AND
      (r."mediaId"=ANY(v_ids||v_ancestors) OR r.id IN(SELECT c."rootRequestId" FROM "RequestCoverage" c WHERE c.edition='default' AND c."mediaId"=ANY(v_ids))))
      <>jsonb_array_length(p_scope#>'{household,requests}')
    OR EXISTS(SELECT 1 FROM "RequestCoverage" c WHERE c.edition='default' AND c."mediaId"=ANY(v_ids)
      AND NOT EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::"RequestCoverage",p_scope#>'{household,coverage}') e
        WHERE to_jsonb(c)-'edition'=to_jsonb(e)-'edition'))
    OR (SELECT count(*) FROM "RequestCoverage" c WHERE c.edition='default' AND c."mediaId"=ANY(v_ids))<>jsonb_array_length(p_scope#>'{household,coverage}')
    OR EXISTS(SELECT 1 FROM "RetentionHold" h WHERE h.edition='default' AND h."mediaId"=ANY(v_ids)
      AND NOT EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::"RetentionHold",p_scope#>'{household,personalHolds}') e
        WHERE to_jsonb(h)-'edition'=to_jsonb(e)-'edition'))
    OR (SELECT count(*) FROM "RetentionHold" h WHERE h.edition='default' AND h."mediaId"=ANY(v_ids))<>jsonb_array_length(p_scope#>'{household,personalHolds}')
  THEN RAISE EXCEPTION 'Native pack current requests, coverage or personal holds changed after actual review'; END IF;
  IF p_selection IS NOT NULL THEN
    IF jsonb_array_length(p_selection#>'{compensationAuthorization,recoveryHoldBindings}')<>cardinality(v_ids)
      OR (SELECT count(*) FROM "RecoveryHold" h WHERE h.edition='default' AND h."mediaId"=ANY(v_ids) AND h."releasedAt" IS NULL)<>cardinality(v_ids)
    THEN RAISE EXCEPTION 'Native pack compensation cannot discard actual whole recovery holds'; END IF;
    FOR v_hold IN SELECT h.value FROM jsonb_array_elements(p_selection#>'{compensationAuthorization,recoveryHoldBindings}') h LOOP
      IF NOT EXISTS(SELECT 1 FROM "RecoveryHold" h WHERE h.edition='default' AND h."mediaId"=v_hold->>'mediaId'
        AND h."recoveryEpoch"=v_epoch AND h.version=(v_hold->>'version')::integer AND h."releasedAt" IS NULL)
      THEN RAISE EXCEPTION 'Native pack reviewed recovery hold identity changed'; END IF;
    END LOOP;
  END IF;
  IF EXISTS(SELECT 1 FROM "AcquisitionAttempt" a WHERE a."mediaIds" && v_ids
      AND a.id<>p_scope#>>'{publication,intent,attemptId}' AND a.state NOT IN ('completed','cancelled','obsolete','rolled_back'))
    OR EXISTS(SELECT 1 FROM "AcquisitionReservation" r WHERE r.edition='default' AND r."mediaId"=ANY(v_ids)
      AND (p_after OR r."attemptId"<>p_scope#>>'{publication,intent,attemptId}'))
    OR EXISTS(SELECT 1 FROM "RetentionDecision" d WHERE d.edition='default' AND d."mediaId"=ANY(v_ids)
      AND d.manifest IS NOT NULL AND d.state NOT IN ('cancelled','restored','purged'))
    OR EXISTS(SELECT 1 FROM "UpgradeCleanup" u WHERE (u."assetId" IN (SELECT f.value->>'assetId' FROM jsonb_array_elements(p_scope->'files') f)
      OR u."successorAssetId" IN (SELECT e.value#>>'{entry,assetId}' FROM jsonb_array_elements(p_scope#>'{publication,intent,entries}') e))
      AND u.state NOT IN ('completed','cancelled','protected'))
    OR EXISTS(SELECT 1 FROM "SubtitleReplacement" s WHERE s."reservationActive" AND
      (s."assetId" IN (SELECT f.value->>'assetId' FROM jsonb_array_elements(p_scope->'files') f)
        OR s."assetId" IN (SELECT e.value#>>'{entry,assetId}' FROM jsonb_array_elements(p_scope#>'{publication,intent,entries}') e)))
  THEN RAISE EXCEPTION 'Unrelated current lifecycle or caption replacement prevents whole native pack compensation'; END IF;
END;
$$;

/** Only current relational rows are read here: every historical parent is paid
 * and validated by the caller/authority function. No snapshots are returned. */
CREATE FUNCTION media_series_pack_native_after_v1(p_scope jsonb,p_completion jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_item jsonb; v_before jsonb; v_after jsonb; v_binding jsonb; v_expected jsonb; v_epoch integer;
BEGIN
  v_epoch:=(p_scope#>>'{request,recoveryEpoch}')::integer;
  IF jsonb_array_length(p_completion->'predecessorBindings')<>jsonb_array_length(p_scope#>'{publication,intent,entries}')
    OR (SELECT count(DISTINCT b.value#>>'{before,id}') FROM jsonb_array_elements(p_completion->'predecessorBindings') b)
      <>jsonb_array_length(p_completion->'predecessorBindings')
  THEN RAISE EXCEPTION 'Native pack completion needs every actual write acknowledgement exactly once'; END IF;
  FOR v_item IN SELECT i.value FROM jsonb_array_elements(p_scope#>'{publication,intent,entries}') i LOOP
    v_before:=v_item->'predecessor';
    SELECT b.value INTO STRICT v_binding FROM jsonb_array_elements(p_completion->'predecessorBindings') b WHERE b.value#>>'{before,id}'=v_before->>'id';
    v_after:=v_binding->'after';
    v_expected:=v_before||jsonb_build_object('version',(v_before->>'version')::integer+1,'ownershipEpoch',v_epoch,
      'subtitles',COALESCE((SELECT jsonb_agg(s.value||jsonb_build_object('version',(s.value->>'version')::integer+1,
        'ownershipEpoch',v_epoch,'videoVersion',(v_before->>'version')::integer+1) ORDER BY s.value->>'id')
        FROM jsonb_array_elements(v_before->'subtitles') s),'[]'::jsonb));
    IF v_binding->'before' IS DISTINCT FROM v_before OR v_after IS DISTINCT FROM v_expected
      OR v_after IS DISTINCT FROM media_series_pack_asset_snapshot_v1(v_before->>'id')
      OR NOT EXISTS(SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_before->>'id' AND a.xmin::text=pg_current_xact_id()::text)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_before->'subtitles') s WHERE NOT EXISTS(
        SELECT 1 FROM "SubtitleAsset" a WHERE a.id=s.value->>'id' AND a.xmin::text=pg_current_xact_id()::text))
      OR EXISTS(SELECT 1 FROM "LibraryAsset" a WHERE a.id=v_item#>>'{entry,assetId}')
    THEN RAISE EXCEPTION 'Native pack completion differs from its actual whole same-transaction asset and caption writes'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_native_current_bindings_v1(p_completion jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_binding jsonb;
BEGIN
  IF NOT COALESCE(p_completion->>'schemaVersion'='2' AND p_completion->>'protocol'='series_pack_publication_v3'
    AND jsonb_array_length(p_completion->'predecessorBindings') BETWEEN 1 AND 25
    AND (SELECT count(DISTINCT b.value#>>'{after,id}') FROM jsonb_array_elements(p_completion->'predecessorBindings') b)=jsonb_array_length(p_completion->'predecessorBindings'),false)
  THEN RAISE EXCEPTION 'Native pack current binding closure is incomplete or ambiguous'; END IF;
  FOR v_binding IN SELECT b.value FROM jsonb_array_elements(p_completion->'predecessorBindings') b LOOP
    IF v_binding->'after' IS DISTINCT FROM media_series_pack_asset_snapshot_v1(v_binding#>>'{after,id}')
    THEN RAISE EXCEPTION 'Native pack current whole inventory changed after actual compensation'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_native_live_v1(p_scope jsonb,p_network jsonb,p_active boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_runtime "MediaRuntimeState"; v_lease "LegacyWriterLease"; v_root jsonb; v_storage "MediaStorageAuthority"; v_mount jsonb;
BEGIN
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton' FOR UPDATE;
  IF v_runtime."recoveryEpoch"<>(p_scope#>>'{request,recoveryEpoch}')::integer
    OR (p_active AND (v_runtime.mode<>'active' OR NOT v_runtime."ownershipConfirmed"))
  THEN RAISE EXCEPTION 'Native pack actual current runtime changed'; END IF;
  IF p_active THEN
    SELECT l.* INTO STRICT v_lease FROM "LegacyWriterLease" l WHERE l.id='singleton' FOR UPDATE;
    IF NOT COALESCE(v_lease."recoveryEpoch"=v_runtime."recoveryEpoch" AND v_lease."revokedAt" IS NULL
      AND (v_lease."observedAt" AT TIME ZONE 'UTC')<=clock_timestamp() AND (v_lease."expiresAt" AT TIME ZONE 'UTC')>clock_timestamp()
      AND v_lease."expiresAt"-v_lease."observedAt"<=interval '120 seconds'
      AND v_lease."targetsDigest"=p_network#>>'{quiescence,targetsDigest}'
      AND v_lease."configurationDigest"=p_network#>>'{mounts,configurationDigest}',false)
    THEN RAISE EXCEPTION 'Native pack actual writer lease changed or expired'; END IF;
  END IF;
  FOR v_root IN SELECT r.value FROM jsonb_array_elements(p_scope->'storageRoots') r LOOP
    SELECT s.* INTO STRICT v_storage FROM "MediaStorageAuthority" s WHERE s."rootPath"=v_root->>'rootPath' FOR UPDATE;
    SELECT m.value INTO STRICT v_mount FROM jsonb_array_elements(p_network#>'{mounts,mounts}') m WHERE m.value->>'root'=v_root->>'rootPath';
    IF NOT COALESCE(v_storage."pvcUid"=v_root->>'pvcUid' AND v_storage."volumeName"=v_root->>'volumeName'
      AND v_storage."volumePath"=v_root->>'volumePath' AND v_mount->>'pvcUid'=v_root->>'pvcUid'
      AND v_mount->>'volumeName'=v_root->>'volumeName' AND v_mount->>'volumePath'=v_root->>'volumePath'
      AND (NOT p_active OR (v_storage."workerPodUid"=v_mount->>'podUid' AND v_storage."revokedAt" IS NULL
        AND v_storage."recoveryEpoch"=v_runtime."recoveryEpoch" AND (v_storage."observedAt" AT TIME ZONE 'UTC')<=clock_timestamp()
        AND (v_storage."expiresAt" AT TIME ZONE 'UTC')>clock_timestamp() AND v_storage."expiresAt"-v_storage."observedAt"<=interval '120 seconds')),false)
    THEN RAISE EXCEPTION 'Native pack actual storage identity or current attestation changed'; END IF;
  END LOOP;
  IF jsonb_array_length(p_scope->'storageRoots')<>2 THEN RAISE EXCEPTION 'Native pack requires both actual approved roots'; END IF;
END;
$$;

-- Actual prior storage receipt+plan parents, queried once per exact referenced
-- approval in this SQL invocation. Current storage attestations cannot invent a
-- prior owner approval. Historical receipt bodies/hashes remain literal.
CREATE FUNCTION media_series_pack_native_storage_original_v1(p_scope jsonb,p_configuration_digest text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ref jsonb; v_root jsonb; v_receipt jsonb; v_plan jsonb; v_network jsonb; v_mounts jsonb; v_kind text;
BEGIN
  FOR v_ref IN SELECT DISTINCT r.value->'receipt' FROM jsonb_array_elements(p_scope->'storageRoots') r LOOP
    v_kind:=v_ref->>'kind';
    IF v_kind='legacy' THEN
      SELECT to_jsonb(r) INTO STRICT v_receipt FROM "MediaHandoffReceipt" r WHERE r.id=v_ref->>'id';
      SELECT to_jsonb(p) INTO STRICT v_plan FROM "MediaHandoffPlan" p WHERE p.id=v_receipt->>'planId';
    ELSIF v_kind='native' THEN
      SELECT to_jsonb(r) INTO STRICT v_receipt FROM "NativeRecoveryReceipt" r WHERE r.id=v_ref->>'id';
      SELECT to_jsonb(p) INTO STRICT v_plan FROM "NativeRecoveryPlan" p WHERE p.id=v_receipt->>'planId';
    ELSE RAISE EXCEPTION 'Native pack storage requires an actual known owner approval kind'; END IF;
    IF NOT COALESCE(v_receipt->>'planHash'=v_ref->>'planHash' AND v_plan->>'planHash'=v_ref->>'planHash'
      AND v_receipt->>'planId'=v_plan->>'id' AND v_plan->>'state'='applied'
      AND v_receipt->'recoveryEpoch'=v_plan->'recoveryEpoch' AND v_plan->'plan'<>'null'::jsonb,false)
    THEN RAISE EXCEPTION 'Native pack storage prior approval changed or was never applied'; END IF;
    v_network:=v_receipt#>'{selection,networkEvidence}';
    IF v_kind='legacy' THEN
      IF v_network->>'configurationDigest' IS DISTINCT FROM p_configuration_digest
      THEN RAISE EXCEPTION 'Native pack prior storage configuration changed'; END IF;
      v_mounts:=v_network->'mounts';
    ELSE
      IF jsonb_typeof(v_network->'mounts')='object' THEN
        IF v_network#>>'{mounts,configurationDigest}' IS DISTINCT FROM p_configuration_digest
        THEN RAISE EXCEPTION 'Native pack prior native storage configuration changed'; END IF;
        v_mounts:=v_network#>'{mounts,mounts}';
      ELSE
        IF v_network->>'configurationDigest' IS DISTINCT FROM p_configuration_digest
        THEN RAISE EXCEPTION 'Native pack prior native storage configuration changed'; END IF;
        v_mounts:=v_network->'mounts';
      END IF;
    END IF;
    FOR v_root IN SELECT r.value FROM jsonb_array_elements(p_scope->'storageRoots') r WHERE r.value->'receipt'=v_ref LOOP
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_mounts) m WHERE
        (CASE WHEN v_kind='legacy' THEN m.value->'canonical' ELSE m.value END)->>'root'=v_root->>'rootPath'
        AND (CASE WHEN v_kind='legacy' THEN m.value->'canonical' ELSE m.value END)->>'pvcUid'=v_root->>'pvcUid'
        AND (CASE WHEN v_kind='legacy' THEN m.value->'canonical' ELSE m.value END)->>'volumeName'=v_root->>'volumeName'
        AND (CASE WHEN v_kind='legacy' THEN m.value->'canonical' ELSE m.value END)->>'volumePath'=v_root->>'volumePath')
      THEN RAISE EXCEPTION 'Native pack current storage identity lacks its actual original approved mount'; END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Full immutable original graph without invoking SQL052's *current acquisition*
-- policy. Recovery owns an exact physical inverse, never renewed old consent.
CREATE FUNCTION media_series_pack_native_projection_v1(p_scope jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_item jsonb; v_file jsonb; v_before jsonb; v_ids text[]; v_media_ids text[];
BEGIN
  SELECT array_agg(e.value#>>'{}' ORDER BY e.value#>>'{}') INTO v_ids FROM jsonb_array_elements(p_scope#>'{publication,intent,mediaIds}') e;
  SELECT array_agg(e.value->>'id' ORDER BY e.value->>'id') INTO v_media_ids FROM jsonb_array_elements(p_scope->'media') e;
  IF NOT COALESCE(v_ids=v_media_ids AND cardinality(v_ids) BETWEEN 1 AND 100
    AND cardinality(v_ids)=(SELECT count(DISTINCT e.id) FROM unnest(v_ids) e(id))
    AND jsonb_array_length(p_scope->'files')=jsonb_array_length(p_scope#>'{publication,intent,entries}')
    AND jsonb_array_length(p_scope->'files')=(SELECT count(DISTINCT f.value->>'assetId') FROM jsonb_array_elements(p_scope->'files') f),false)
  THEN RAISE EXCEPTION 'Native pack approval omitted complete distinct actual media and predecessor files'; END IF;
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_scope#>'{publication,intent,entries}') e LOOP
    v_before:=v_item->'predecessor';
    SELECT f.value INTO STRICT v_file FROM jsonb_array_elements(p_scope->'files') f WHERE f.value->>'assetId'=v_before->>'id';
    IF NOT COALESCE(v_file=jsonb_build_object('assetId',v_before->'id','assetVersion',v_before->'version','canonicalPath',v_before->'path',
      'libraryKind','tv','checksum',v_before->'checksum','sizeBytes',v_before->'sizeBytes','ownershipEpoch',v_before->'ownershipEpoch',
      'properties',v_before->'properties','mediaIds',(SELECT jsonb_agg(c.value->'mediaId' ORDER BY c.ordinal)
        FROM jsonb_array_elements(v_before->'coverage') WITH ORDINALITY c(value,ordinal) WHERE c.value->'current'='true'::jsonb),
      'subtitles',v_before->'subtitles'),false)
    THEN RAISE EXCEPTION 'Native pack scope changed the exact paid predecessor projection'; END IF;
  END LOOP;
  IF jsonb_array_length(p_scope->'requiredAbsences')<>(SELECT count(*) FROM jsonb_array_elements(p_scope#>'{publication,intent,entries}') e,
      LATERAL jsonb_array_elements(e.value->'participants') p WHERE p.value#>>'{physical,root}'='control')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_scope#>'{publication,intent,entries}') e,
      LATERAL jsonb_array_elements(e.value->'participants') p WHERE p.value#>>'{physical,root}'='control' AND NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_scope->'requiredAbsences') a WHERE a.value=jsonb_build_object(
          'assetId',p.value->'assetId','libraryKind','tv','canonicalPath','/data/tv/.media-control/'||(p.value#>>'{physical,path}'))))
  THEN RAISE EXCEPTION 'Native pack scope omitted its complete actual control-path exclusions'; END IF;
END;
$$;

CREATE FUNCTION media_series_pack_native_original_v1(p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_transition "MediaPublicationTransition"; v_attempt "AcquisitionAttempt"; v_staging "Operation";
  v_parent "Operation"; v_ref jsonb; v_first_scope jsonb; v_entries jsonb:='[]'::jsonb;
  v_index integer:=0; v_effects jsonb:='[]'::jsonb; v_forward jsonb; v_original jsonb;
BEGIN
  SELECT t.* INTO STRICT v_transition FROM "MediaPublicationTransition" t WHERE t.id=p_scope#>>'{transition,transitionId}' FOR UPDATE;
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=v_transition."attemptId" FOR UPDATE;
  v_original:=p_scope#>'{publication,intent}';
  PERFORM media_series_pack_native_projection_v1(p_scope);
  SELECT o.* INTO STRICT v_staging FROM "Operation" o WHERE o.id=v_original#>>'{seriesPackPublication,stagingSeal,operationId}';
  IF NOT COALESCE(v_transition.intent->>'schemaVersion'='3' AND v_transition.outcome IS NULL
    AND v_transition.intent=v_original AND v_transition."intentHash"=p_scope#>>'{publication,intentHash}'
    AND v_transition.id=p_scope#>>'{publication,transitionId}'
    AND v_transition."birthEpoch"=(v_original->>'birthEpoch')::integer
    AND v_attempt.id=v_original->>'attemptId' AND v_attempt."recoveryEpoch"=v_transition."birthEpoch"
    AND v_attempt."operationId"=v_original->>'operationId'
    AND v_attempt."coordinatorOperationId"=v_original#>>'{seriesPackPublication,coordinatorOperationId}'
    AND v_attempt.state NOT IN ('imported','completed')
    AND (p_scope->>'interruptedAttemptRaw')::jsonb=jsonb_build_object(
      'id',v_attempt.id,'releaseId',v_attempt."releaseId",'sponsorRequestId',v_attempt."sponsorRequestId",
      'mediaIds',to_jsonb(v_attempt."mediaIds"),'generations',v_attempt.generations,'state',v_attempt.state,
      'torrentId',v_attempt."torrentId",'operationId',v_attempt."operationId",'coordinatorOperationId',v_attempt."coordinatorOperationId",
      'failure',v_attempt.failure,'filePlan',v_attempt."filePlan",'recoveryEpoch',v_attempt."recoveryEpoch")
    AND encode(sha256(convert_to(p_scope->>'interruptedAttemptRaw','UTF8')),'hex')=p_scope#>>'{interruptedWork,attemptSnapshotHash}'
    AND v_staging.kind='seal_series_pack_staging_v1' AND v_staging.status='completed'
    AND v_staging."userId" IS NULL AND v_staging."targetId"=v_attempt.id
    AND v_staging.payload->>'sealHash'=v_original#>>'{seriesPackPublication,stagingSeal,sealHash}'
    AND v_staging.payload#>>'{seal,filePlanHash}'=v_transition."filePlanHash"
    AND (v_staging.payload->>'filePlanRaw')::jsonb=v_attempt."filePlan"
    AND v_staging.payload#>>'{seal,operationId}'=v_attempt."coordinatorOperationId",false)
  THEN RAISE EXCEPTION 'Native pack recovery needs its actual immutable original attempt, intent and staging seal'; END IF;
  FOR v_ref IN SELECT r.value FROM jsonb_array_elements(v_original#>'{seriesPackPublication,preparations}') r LOOP
    SELECT o.* INTO STRICT v_parent FROM "Operation" o WHERE o.id=v_ref->>'operationId';
    IF v_index=0 THEN v_first_scope:=v_parent.payload#>'{prepared,scope}'; END IF;
    IF NOT COALESCE(v_parent.kind='prepare_series_pack_publication_v1' AND v_parent.status='completed'
      AND v_parent."userId" IS NULL AND v_parent.result IS NULL AND v_parent."targetId"=v_attempt.id
      AND v_parent."idempotencyKey"='series-pack-publication-prepare-v1:'||v_attempt.id||':'||v_index::text
      AND v_parent.payload->>'preparedHash'=v_ref->>'preparedHash'
      AND (v_parent.payload->>'raw')::jsonb=v_parent.payload->'prepared'
      AND encode(sha256(convert_to(v_parent.payload->>'raw','UTF8')),'hex')=v_ref->>'preparedHash'
      AND v_parent.payload#>'{prepared,scope}'=v_first_scope
      AND v_parent.payload#>'{prepared,batchIndex}'=to_jsonb(v_index)
      AND (v_parent.payload->>'filePlanRaw')::jsonb=v_attempt."filePlan",false)
    THEN RAISE EXCEPTION 'Native pack recovery changed a real whole preparation parent'; END IF;
    v_entries:=v_entries||(v_parent.payload#>'{prepared,entries}'); v_index:=v_index+1;
  END LOOP;
  IF v_entries IS DISTINCT FROM v_original->'entries' OR v_index<>(jsonb_array_length(v_entries)+3)/4
    OR v_first_scope->>'attemptId'<>v_attempt.id OR v_first_scope->>'transitionId'<>v_transition.id
    OR v_first_scope->>'filePlanHash'<>v_transition."filePlanHash"
    OR v_first_scope->>'operationId'<>v_attempt."coordinatorOperationId"
  THEN RAISE EXCEPTION 'Native pack preparation omitted its complete literal partition'; END IF;
  v_index:=0;
  FOR v_ref IN SELECT r.value FROM jsonb_array_elements(p_scope->'forwardParents') r LOOP
    SELECT o.* INTO STRICT v_parent FROM "Operation" o WHERE o.id=v_ref->>'operationId';
    v_forward:=v_parent.result->'completion';
    IF NOT COALESCE(v_parent.kind='publish_series_pack_members_v1' AND v_parent.status='completed'
      AND v_parent."userId" IS NULL AND v_parent."targetId"=v_attempt.id
      AND v_parent."idempotencyKey"='series-pack-publication-physical-v1:'||v_attempt.id||':'||v_index::text
      AND v_parent.payload#>>'{command,transitionId}'=v_transition.id
      AND v_parent.payload#>>'{command,intentHash}'=v_transition."intentHash"
      AND v_parent.payload#>>'{command,operationId}'=v_attempt."coordinatorOperationId"
      AND v_ref->'batchIndex'=to_jsonb(v_index) AND v_parent.payload#>'{command,batchIndex}'=to_jsonb(v_index)
      AND v_parent.payload->>'commandHash'=v_ref->>'commandHash'
      AND v_parent.result->>'completionHash'=v_ref->>'completionHash'
      AND (v_parent.payload->>'raw')::jsonb=v_parent.payload->'command'
      AND encode(sha256(convert_to(v_parent.payload->>'raw','UTF8')),'hex')=v_ref->>'commandHash'
      AND (v_parent.result->>'raw')::jsonb=v_forward
      AND encode(sha256(convert_to(v_parent.result->>'raw','UTF8')),'hex')=v_ref->>'completionHash'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_effects) WITH ORDINALITY e(value,ordinal)
        WHERE v_forward->'effects'->((e.ordinal-1)::integer) IS DISTINCT FROM e.value),false)
    THEN RAISE EXCEPTION 'Native pack recovery needs the exact real completed forward prefix'; END IF;
    v_effects:=v_forward->'effects'; v_index:=v_index+1;
  END LOOP;
  IF v_index<>(SELECT count(*) FROM "Operation" o WHERE o.kind='publish_series_pack_members_v1' AND o."targetId"=v_attempt.id)
  THEN RAISE EXCEPTION 'Native pack recovery omitted an actual forward publication parent'; END IF;
  RETURN v_effects;
END;
$$;

CREATE FUNCTION media_series_pack_native_files_v1(p_scope jsonb,p_files jsonb,p_forward_effects jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_item jsonb; v_effect jsonb; v_raw text; v_ordinal integer:=0; v_previous text:=NULL; v_ref jsonb;
BEGIN
  IF NOT COALESCE(p_files->>'schemaVersion'='3' AND p_files->>'protocol'='series_pack_publication_v3'
    AND p_files->>'transitionId'=p_scope#>>'{publication,transitionId}'
    AND p_files->>'intentHash'=p_scope#>>'{publication,intentHash}'
    AND p_files->'recoveryEpoch'=p_scope#>'{request,recoveryEpoch}'
    AND jsonb_array_length(p_files->'acknowledgedEffects')=jsonb_array_length(p_files->'acknowledgedRaw')
    AND (p_files->>'effectPrefixRaw')::jsonb=p_files->'acknowledgedEffects'
    AND encode(sha256(convert_to(p_files->>'effectPrefixRaw','UTF8')),'hex')=p_files->>'effectPrefixHash',false)
  THEN RAISE EXCEPTION 'Native pack file proof needs its literal actual raw prefix'; END IF;
  FOR v_effect IN SELECT e.value FROM jsonb_array_elements(p_files->'acknowledgedEffects') e LOOP
    v_raw:=p_files->'acknowledgedRaw'->>v_ordinal;
    IF NOT COALESCE(v_raw::jsonb=v_effect AND v_effect->'ordinal'=to_jsonb(v_ordinal)
      AND v_effect->'continuationId'='null'::jsonb AND v_effect->>'transitionId'=p_scope#>>'{publication,transitionId}'
      AND v_effect->>'intentHash'=p_scope#>>'{publication,intentHash}'
      AND (v_effect->>'previousEffectHash') IS NOT DISTINCT FROM v_previous
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_scope#>'{publication,intent,entries}') e
        WHERE e.value#>>'{entry,operationId}'=v_effect->>'entryOperationId' AND e.value#>>'{entry,libraryKind}'=v_effect->>'libraryKind'
          AND (e.value#>>'{entry,assetId}'=v_effect->>'assetId' OR e.value#>>'{entry,previousAssetId}'=v_effect->>'assetId')),false)
    THEN RAISE EXCEPTION 'Native pack file proof invented or changed an original causal effect'; END IF;
    v_previous:=encode(sha256(convert_to(v_raw,'UTF8')),'hex'); v_ordinal:=v_ordinal+1;
  END LOOP;
  FOR v_ref IN SELECT e.value FROM jsonb_array_elements(p_forward_effects) e LOOP
    v_ordinal:=(v_ref->>'ordinal')::integer;
    v_effect:=p_files->'acknowledgedEffects'->v_ordinal; v_raw:=p_files->'acknowledgedRaw'->>v_ordinal;
    IF NOT COALESCE(encode(sha256(convert_to(v_raw,'UTF8')),'hex')=v_ref->>'effectHash'
      AND v_effect#>>'{effect,operationId}'=v_ref->>'operationId'
      AND v_effect#>>'{effect,step}'=v_ref->>'step' AND v_effect->>'libraryKind'=v_ref->>'libraryKind',false)
    THEN RAISE EXCEPTION 'Native pack file proof omitted a real completed forward receipt'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_native_network_identity_v1(p_network jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schemaVersion',3,'lifecycleKind',p_network->'lifecycleKind','protocol',p_network->'protocol',
    'planId',p_network->'planId','recoveryEpoch',p_network->'recoveryEpoch','access',p_network->'access',
    'configurationDigest',p_network#>'{mounts,configurationDigest}','targetsDigest',p_network#>'{quiescence,targetsDigest}',
    'controllers',p_network#>'{quiescence,controllers}','mounts',p_network#>'{mounts,mounts}',
    'originalWorkflowClosed',(p_network->'originalWorkflowClosed')-'observedAt',
    'originalAcquisitionClosed',(p_network->'originalAcquisitionClosed')-'observedAt',
    'previousWorkflowClosed',CASE WHEN p_network->'previousWorkflowClosed'='null'::jsonb THEN 'null'::jsonb ELSE (p_network->'previousWorkflowClosed')-'observedAt' END,
    'plex',jsonb_build_object('canonicalPaths',p_network#>'{plex,canonicalPaths}',
      'retainedAbsence',COALESCE((SELECT jsonb_agg(e.value-'inventoryDigest' ORDER BY e.ordinal) FROM jsonb_array_elements(p_network#>'{plex,retainedAbsence}') WITH ORDINALITY e(value,ordinal)),'[]'::jsonb),
      'inventory',COALESCE((SELECT jsonb_agg(jsonb_build_object('sectionId',e.value->'sectionId','kind',e.value->'kind') ORDER BY e.ordinal)
        FROM jsonb_array_elements(p_network#>'{plex,inventory}') WITH ORDINALITY e(value,ordinal)),'[]'::jsonb),
      'playback',jsonb_build_object('state',p_network#>'{plex,playback,state}','scopeHash',p_network#>'{plex,playback,scopeHash}')),
    'torrents',p_network->'torrents');
$$;

-- Four actual immutable parents. The exact queried SQL plan is passed only by
-- the enclosing SQL guard, which obtained it from NativeRecoveryPlan itself.
CREATE FUNCTION media_series_pack_native_batch_row_v1(p_ref jsonb,p_plan "NativeRecoveryPlan",p_batch "NativePlexProofBatch")
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_batch "NativePlexProofBatch"; v_network "NativeRecoveryObservation"; v_plex "NativeRecoveryObservation"; v_command "Operation";
  v_parent jsonb; v_body jsonb;
BEGIN
  v_batch:=p_batch;
  SELECT n.* INTO STRICT v_network FROM "NativeRecoveryObservation" n WHERE n.id=v_batch."networkObservationId";
  SELECT n.* INTO STRICT v_plex FROM "NativeRecoveryObservation" n WHERE n.id=v_batch."plexObservationId";
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=v_batch."operationId";
  v_parent:=v_batch.batch->'parent'; v_body:=v_network.evidence;
  IF NOT COALESCE(v_batch.batch->>'schemaVersion'='2' AND v_batch.batch->>'protocol'='series_pack_publication_v3'
    AND v_parent=p_ref->'parent' AND v_parent->>'schemaVersion'='2' AND v_parent->>'protocol'='series_pack_publication_v3'
    AND v_parent->>'lifecycleKind'='publication_compensation' AND v_parent->>'planId'=p_plan.id
    AND v_batch."planId"=p_plan.id AND v_batch."batchHash"=p_ref->>'batchHash'
    AND v_parent->'recoveryEpoch'=to_jsonb(p_plan."recoveryEpoch")
    AND v_parent->>'operationId'=v_command.id AND v_command."userId"=p_plan."actorId"
    AND (CASE WHEN v_parent->>'purpose'='native_review' THEN v_command.kind IN ('prepare_series_pack_native_compensation_v1','apply_series_pack_native_compensation_v1')
       AND v_command."targetId"=p_plan.id AND v_command.payload->>'planId'=p_plan.id
      ELSE v_parent->>'purpose'='native_execution' AND v_command.kind='compensate_series_pack_native_publication_v1'
       AND v_command."targetId"=v_parent->>'continuationId' AND v_command.payload->>'continuationId'=v_parent->>'continuationId' END)
    AND v_network."planId"=p_plan.id AND v_plex."planId"=p_plan.id
    AND v_network.kind=v_parent->>'networkKind' AND v_plex.kind='plex_association'
    AND v_body->>'schemaVersion'='3' AND v_body->>'protocol'='series_pack_publication_v3'
    AND v_body->>'planId'=p_plan.id AND v_body->'recoveryEpoch'=to_jsonb(p_plan."recoveryEpoch")
    AND v_body#>>'{access,sectionType}'='show'
    AND (v_batch.batch->>'scopeRaw')::jsonb=p_plan.scope
    AND encode(sha256(convert_to(v_batch.batch->>'scopeRaw','UTF8')),'hex')=v_parent->>'scopeHash'
    AND (v_batch.batch->>'networkRaw')::jsonb=v_network.evidence
    AND encode(sha256(convert_to(v_batch.batch->>'networkRaw','UTF8')),'hex')=v_network."evidenceHash"
    AND (v_batch.batch->>'plexRaw')::jsonb=v_plex.evidence
    AND encode(sha256(convert_to(v_batch.batch->>'plexRaw','UTF8')),'hex')=v_plex."evidenceHash"
    AND (v_batch.batch->>'identityRaw')::jsonb=media_series_pack_native_network_identity_v1(v_body)
    AND encode(sha256(convert_to(v_batch.batch->>'identityRaw','UTF8')),'hex')=v_batch.batch->>'identityHash'
    AND v_batch.batch->>'identityHash'=p_ref->>'identityHash'
    AND v_batch.batch->'network'=p_ref->'network' AND v_batch.batch->'plex'=p_ref->'plex'
    AND v_batch.batch#>>'{network,evidenceHash}'=v_network."evidenceHash"
    AND v_batch.batch#>>'{plex,evidenceHash}'=v_plex."evidenceHash"
    AND v_plex.evidence->'parent'=v_parent AND v_plex.evidence->>'batchId'=v_batch.id
    AND v_plex.evidence->'network'=v_batch.batch->'network'
    AND v_plex.evidence->'observation'=v_body->'plex'
    AND (v_batch.batch->>'startedAt')::timestamptz<=(v_batch.batch->>'sessionsCheckedAt')::timestamptz
    AND (v_batch.batch->>'sessionsCheckedAt')::timestamptz<=(v_batch.batch->>'completedAt')::timestamptz
    AND (v_batch.batch->>'completedAt')::timestamptz<(v_batch.batch->>'expiresAt')::timestamptz
    AND (v_batch.batch->>'expiresAt')::timestamptz-(v_batch.batch->>'startedAt')::timestamptz<=interval '60 seconds'
    AND v_body#>>'{plex,playback,state}'='clear'
    AND v_body#>>'{plex,playback,checkedAt}'=v_batch.batch->>'sessionsCheckedAt'
    AND (v_network."observedAt" AT TIME ZONE 'UTC')=(v_body->>'capturedAt')::timestamptz
    AND (v_network."expiresAt" AT TIME ZONE 'UTC')=(v_batch.batch->>'expiresAt')::timestamptz
    AND v_plex."expiresAt"=v_network."expiresAt",false)
  THEN RAISE EXCEPTION 'Native pack paired proof lost its actual immutable graph or original timing'; END IF;
  RETURN v_body;
END;
$$;

CREATE FUNCTION media_series_pack_native_batch_v1(p_ref jsonb,p_plan "NativeRecoveryPlan")
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_batch "NativePlexProofBatch";
BEGIN
  SELECT b.* INTO STRICT v_batch FROM "NativePlexProofBatch" b WHERE b.id=p_ref->>'batchId';
  RETURN media_series_pack_native_batch_row_v1(p_ref,p_plan,v_batch);
END;
$$;

-- SQL independent authority closure runs once at continuation birth and once
-- when recording its final actual completion. Every traversal is reserved in
-- the caller100, including both actual approval batches and the fresh execution
-- batch. Current row guards do not repeatedly rematerialize historical parents.
CREATE FUNCTION media_series_pack_native_authority_v1(p_row "NativePublicationCompensationContinuation",p_execution boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_receipt "NativeRecoveryReceipt"; v_plan "NativeRecoveryPlan"; v_restore "Operation";
  v_apply "Operation"; v_execute "Operation"; v_owner "MediaUser"; v_scope jsonb; v_selection jsonb;
  v_finished jsonb; v_approved jsonb; v_applied jsonb; v_network jsonb; v_ids text[]; v_assets text[]; v_forward_effects jsonb;
BEGIN
  v_scope:=p_row.descriptor->'scope';
  SELECT r.* INTO STRICT v_receipt FROM "NativeRecoveryReceipt" r WHERE r.id=p_row."receiptId";
  SELECT p.* INTO STRICT v_plan FROM "NativeRecoveryPlan" p WHERE p.id=v_receipt."planId" FOR UPDATE;
  SELECT o.* INTO STRICT v_restore FROM "Operation" o WHERE o.id=v_plan."restoreOperationId";
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=v_receipt."actorId" FOR SHARE;
  SELECT o.* INTO STRICT v_apply FROM "Operation" o WHERE o.id=p_row."executionEvidence"->>'admittedByOperationId';
  SELECT o.* INTO STRICT v_execute FROM "Operation" o WHERE o.id=p_row."coordinatorOperationId" FOR UPDATE;
  v_selection:=v_receipt.selection; v_finished:=v_plan.plan;
  SELECT array_agg(i.value#>>'{}' ORDER BY i.value#>>'{}') INTO v_ids FROM jsonb_array_elements(v_scope#>'{publication,intent,mediaIds}') i;
  SELECT array_agg(DISTINCT a.id ORDER BY a.id) INTO v_assets FROM (
    SELECT i.value#>>'{entry,assetId}' AS id FROM jsonb_array_elements(v_scope#>'{publication,intent,entries}') i
    UNION ALL SELECT i.value#>>'{predecessor,id}' FROM jsonb_array_elements(v_scope#>'{publication,intent,entries}') i) a;
  IF NOT COALESCE(p_row.descriptor->>'schemaVersion'='2' AND p_row.descriptor->>'protocol'='series_pack_publication_v3'
    AND p_row.descriptor->>'allowedAction'='compensate' AND v_scope->>'schemaVersion'='3'
    AND p_row.id=v_plan.id AND v_plan.id=v_receipt."planId" AND v_plan."actorId"=v_receipt."actorId"
    AND v_owner.role='owner' AND NOT v_owner.restricted
    AND v_plan."recoveryEpoch"=p_row."recoveryEpoch" AND v_receipt."recoveryEpoch"=p_row."recoveryEpoch"
    AND v_receipt."previousRuntimeVersion"=v_plan."runtimeVersion"
    AND v_receipt."runtimeVersion"=v_receipt."previousRuntimeVersion"+1
    AND EXISTS(SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.version=v_receipt."runtimeVersion")
    AND (CASE WHEN p_execution THEN v_plan.state='applied' ELSE v_plan.state='applying' END)
    AND v_plan."planHash"=v_receipt."planHash" AND v_scope=v_plan.scope AND v_scope=v_selection->'scope'
    AND v_selection->>'schemaVersion'='4' AND v_selection->>'protocol'='series_pack_publication_v3'
    AND (v_selection->>'finishedRaw')::jsonb=v_finished
    AND encode(sha256(convert_to(v_selection->>'finishedRaw','UTF8')),'hex')=v_receipt."planHash"
    AND (v_selection#>>'{compensationAuthorization,descriptorRaw}')::jsonb=p_row.descriptor
    AND encode(sha256(convert_to(v_selection#>>'{compensationAuthorization,descriptorRaw}','UTF8')),'hex')=p_row."descriptorHash"
    AND v_selection#>>'{compensationAuthorization,descriptorHash}'=p_row."descriptorHash"
    AND v_selection#>>'{compensationAuthorization,continuationId}'=p_row.id
    AND p_row."mediaIds"=v_ids AND p_row."assetIds"=v_assets
    AND v_scope#>>'{transition,transitionId}'=p_row."transitionId"
    AND v_restore.kind='restore_observe' AND v_restore.status='completed'
    AND v_restore.result->>'mode'='observe'
    AND v_restore.result->'recoveryEpoch'=to_jsonb(p_row."recoveryEpoch")
    AND (v_restore.result->>'previousEpoch')::integer+1=p_row."recoveryEpoch"
    AND v_scope#>>'{request,restoreOperationId}'=v_restore.id
    AND v_apply.kind='apply_series_pack_native_compensation_v1' AND v_apply."targetId"=v_plan.id
    AND v_apply."userId"=v_receipt."actorId" AND v_apply.payload->>'actorId'=v_receipt."actorId"
    AND v_apply.payload->>'planHash'=v_receipt."planHash" AND v_apply.payload->>'planId'=v_plan.id
    AND v_execute.kind='compensate_series_pack_native_publication_v1' AND v_execute."targetId"=p_row.id
    AND v_execute."userId"=v_receipt."actorId" AND v_execute.payload->>'continuationId'=p_row.id
    AND v_execute.payload->'recoveryEpoch'=to_jsonb(p_row."recoveryEpoch")
    AND p_row."executionEvidence"->>'schemaVersion'='2'
    AND p_row."executionEvidence"->>'descriptorHash'=p_row."descriptorHash"
    AND p_row."executionEvidence"->>'continuationId'=p_row.id
    AND p_row."executionEvidence"->'recoveryEpoch'=to_jsonb(p_row."recoveryEpoch")
    AND p_row."executionEvidence"->'inverseNamespace'=p_row.descriptor#>'{approvedFileEvidence,inverseNamespace}'
    AND p_row."executionEvidence"#>>'{inverseNamespace,state}'='absent'
    AND p_row."executionEvidence"#>>'{inverseNamespace,path}'='publication-transitions/'||p_row."transitionId"||'/compensation-'||p_row.id
    AND (p_row."executionEvidence"->>'admittedAt')::timestamptz=(p_row."createdAt" AT TIME ZONE 'UTC')
    AND p_row."executionEvidence"->'participants'=p_row.descriptor#>'{approvedFileEvidence,participants}'
    AND p_row."executionEvidence"->>'effectPrefixHash'=p_row.descriptor#>>'{approvedFileEvidence,effectPrefixHash}'
    AND p_row."executionEvidence"->'transition'=v_scope->'transition'
    AND v_selection->'fileEvidence'=p_row.descriptor->'approvedFileEvidence'
    AND p_row.descriptor->'steps'=p_row.descriptor#>'{approvedFileEvidence,steps}'
    AND (v_selection->'fileEvidence')-ARRAY['capturedAt','workerPodUid']=v_finished->'files',false)
  THEN RAISE EXCEPTION 'Native pack recovery requires the actual exact owner approval, admission and whole parent'; END IF;
  v_forward_effects:=media_series_pack_native_original_v1(v_scope);
  PERFORM media_series_pack_native_files_v1(v_scope,p_row.descriptor->'approvedFileEvidence',v_forward_effects);
  v_approved:=media_series_pack_native_batch_v1(v_selection#>'{plex,approved}',v_plan);
  v_applied:=media_series_pack_native_batch_v1(v_selection#>'{plex,applied}',v_plan);
  PERFORM media_series_pack_native_storage_original_v1(v_scope,v_applied#>>'{mounts,configurationDigest}');
  IF v_selection#>>'{plex,approved,batchId}'=v_selection#>>'{plex,applied,batchId}'
    OR v_selection#>>'{plex,approved,parent,operationId}'=v_selection#>>'{plex,applied,parent,operationId}'
    OR v_selection#>>'{plex,approved,parent,operationId}'<>v_finished#>>'{plex,parent,operationId}'
    OR v_selection#>>'{plex,applied,parent,operationId}'<>v_apply.id
    OR v_selection#>>'{plex,approved,identityHash}'<>v_finished->>'networkIdentityHash'
    OR v_selection#>>'{plex,applied,identityHash}'<>v_finished->>'networkIdentityHash'
    OR v_selection->'networkEvidence' IS DISTINCT FROM v_applied
    OR media_series_pack_native_network_identity_v1(v_approved) IS DISTINCT FROM media_series_pack_native_network_identity_v1(v_applied)
    OR v_applied#>>'{originalWorkflowClosed,operationId}'<>v_scope#>>'{publication,intent,seriesPackPublication,coordinatorOperationId}'
    OR v_applied#>>'{originalWorkflowClosed,workflowId}'<>'media-operation-'||(v_scope#>>'{publication,intent,seriesPackPublication,coordinatorOperationId}')
    OR v_applied#>>'{originalWorkflowClosed,status}' NOT IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    OR COALESCE(v_applied#>>'{originalWorkflowClosed,runId}','')=''
    OR (v_applied#>>'{originalWorkflowClosed,observedAt}')::timestamptz<(v_applied->>'capturedAt')::timestamptz
    OR v_applied#>>'{originalAcquisitionClosed,operationId}'<>v_scope#>>'{publication,intent,seriesPackPublication,coordinatorOperationId}'
    OR v_applied#>>'{originalAcquisitionClosed,attemptId}' IS DISTINCT FROM v_scope#>>'{publication,intent,attemptId}'
    OR v_applied#>>'{originalAcquisitionClosed,workflowId}'<>'media-acquire-'||(v_scope#>>'{publication,intent,attemptId}')
    OR v_applied#>>'{originalAcquisitionClosed,status}' NOT IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    OR COALESCE(v_applied#>>'{originalAcquisitionClosed,runId}','')=''
    OR (v_applied#>>'{originalAcquisitionClosed,observedAt}')::timestamptz<(v_applied->>'capturedAt')::timestamptz
  THEN RAISE EXCEPTION 'Native pack recovery approval lost its actual paired review or closed original coordinator'; END IF;
  IF p_execution THEN
    v_network:=media_series_pack_native_batch_v1(v_execute.result->'seriesPackNativePlexProofV2',v_plan);
    IF v_execute.result#>>'{seriesPackNativePlexProofV2,parent,continuationId}'<>p_row.id
      OR v_execute.result#>>'{seriesPackNativePlexProofV2,parent,descriptorHash}'<>p_row."descriptorHash"
      OR v_execute.result#>>'{seriesPackNativePlexProofV2,parent,operationId}'<>v_execute.id
      OR v_execute.result#>>'{seriesPackNativePlexProofV2,parent,purpose}'<>'native_execution'
      OR p_row.completion->'executionPlex' IS DISTINCT FROM v_execute.result->'seriesPackNativePlexProofV2'
      OR (v_network->>'expiresAt')::timestamptz<=clock_timestamp()
      OR media_series_pack_native_network_identity_v1(v_network) IS DISTINCT FROM media_series_pack_native_network_identity_v1(v_applied)
    THEN RAISE EXCEPTION 'Native pack compensation needs its actual fresh same-admission execution proof'; END IF;
    PERFORM media_series_pack_native_live_v1(v_scope,v_network,true);
    PERFORM media_series_pack_native_scope_current_v1(v_scope,v_selection,true);
  ELSE
    PERFORM media_series_pack_native_live_v1(v_scope,v_applied,true);
    PERFORM media_series_pack_native_scope_current_v1(v_scope,v_selection,false);
  END IF;
END;
$$;

ALTER TABLE "NativePlexProofBatch" DROP CONSTRAINT "native_plex_batch_shape";
ALTER TABLE "NativePlexProofBatch" ADD CONSTRAINT "native_plex_batch_shape" CHECK (COALESCE(
  "batchHash" ~ '^[a-f0-9]{64}$' AND
  (batch->'schemaVersion'='1'::jsonb OR (batch->'schemaVersion'='2'::jsonb AND batch->>'protocol'='series_pack_publication_v3'))
  AND batch->>'batchId'=id AND batch#>>'{parent,planId}'="planId" AND batch#>>'{parent,operationId}'="operationId"
  AND batch#>>'{network,observationId}'="networkObservationId" AND batch#>>'{plex,observationId}'="plexObservationId",false));

CREATE FUNCTION media_series_pack_native_batch_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_plan "NativeRecoveryPlan"; v_owner "MediaUser"; v_restore "Operation"; v_ref jsonb; v_network jsonb;
BEGIN
  SELECT p.* INTO STRICT v_plan FROM "NativeRecoveryPlan" p WHERE p.id=NEW."planId" FOR UPDATE;
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=v_plan."actorId" FOR SHARE;
  SELECT o.* INTO STRICT v_restore FROM "Operation" o WHERE o.id=v_plan."restoreOperationId";
  v_ref:=jsonb_build_object('batchId',NEW.id,'batchHash',NEW."batchHash",'parent',NEW.batch->'parent',
    'network',NEW.batch->'network','plex',NEW.batch->'plex','identityHash',NEW.batch->'identityHash');
  v_network:=media_series_pack_native_batch_row_v1(v_ref,v_plan,NEW);
  IF NOT COALESCE(v_plan.scope->>'schemaVersion'='3' AND v_plan.scope->>'protocol'='series_pack_publication_v3'
    AND v_owner.role='owner' AND NOT v_owner.restricted
    AND v_restore.kind='restore_observe' AND v_restore.status='completed'
    AND v_restore.result->'recoveryEpoch'=to_jsonb(v_plan."recoveryEpoch")
    AND v_network#>>'{originalWorkflowClosed,operationId}'=v_plan.scope#>>'{publication,intent,seriesPackPublication,coordinatorOperationId}'
    AND v_network#>>'{originalWorkflowClosed,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND COALESCE(v_network#>>'{originalWorkflowClosed,runId}','')<>''
    AND v_network#>>'{originalAcquisitionClosed,operationId}'=v_plan.scope#>>'{publication,intent,seriesPackPublication,coordinatorOperationId}'
    AND v_network#>>'{originalAcquisitionClosed,attemptId}'=v_plan.scope#>>'{publication,intent,attemptId}'
    AND v_network#>>'{originalAcquisitionClosed,workflowId}'='media-acquire-'||(v_plan.scope#>>'{publication,intent,attemptId}')
    AND v_network#>>'{originalAcquisitionClosed,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND COALESCE(v_network#>>'{originalAcquisitionClosed,runId}','')<>''
    AND (v_network->>'expiresAt')::timestamptz>clock_timestamp()
    AND (v_network->>'capturedAt')::timestamptz<=clock_timestamp()
    AND (NEW.batch->>'startedAt')::timestamptz<=clock_timestamp()
    AND (NEW.batch->>'completedAt')::timestamptz<=clock_timestamp()
    AND v_network#>>'{quiescence,quiescent}'='true'
    AND jsonb_array_length(v_network#>'{quiescence,blockers}')=0,false)
  THEN RAISE EXCEPTION 'Native pack paired proof needs its actual current approved scope and closed original coordinator'; END IF;
  PERFORM media_series_pack_native_original_v1(v_plan.scope);
  PERFORM media_series_pack_native_live_v1(v_plan.scope,v_network,NEW.batch#>>'{parent,purpose}'='native_execution');
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_native_batch_birth BEFORE INSERT ON "NativePlexProofBatch" FOR EACH ROW
  WHEN(NEW.batch->>'schemaVersion'='2') EXECUTE FUNCTION media_series_pack_native_batch_birth_v1();

CREATE FUNCTION media_series_pack_native_operation_proof_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ref jsonb; v_batch "NativePlexProofBatch";
BEGIN
  IF OLD.result->'seriesPackNativePlexProofV2' IS NOT DISTINCT FROM NEW.result->'seriesPackNativePlexProofV2' THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM "NativePublicationCompensationContinuation" c WHERE c."coordinatorOperationId"=OLD.id
    AND c.descriptor->>'schemaVersion'='2' AND c.completion IS NOT NULL)
  THEN RAISE EXCEPTION 'Completed native pack execution proof is immutable'; END IF;
  v_ref:=NEW.result->'seriesPackNativePlexProofV2';
  SELECT b.* INTO STRICT v_batch FROM "NativePlexProofBatch" b WHERE b.id=v_ref->>'batchId';
  IF NOT COALESCE(NEW.kind IN ('prepare_series_pack_native_compensation_v1','apply_series_pack_native_compensation_v1','compensate_series_pack_native_publication_v1')
    AND ROW(NEW.id,NEW.kind,NEW.payload,NEW."targetId",NEW."userId") IS NOT DISTINCT FROM ROW(OLD.id,OLD.kind,OLD.payload,OLD."targetId",OLD."userId")
    AND v_batch."operationId"=NEW.id AND v_batch.batch->>'schemaVersion'='2'
    AND v_batch.batch->>'protocol'='series_pack_publication_v3'
    AND v_batch."batchHash"=v_ref->>'batchHash' AND v_batch.batch->'parent'=v_ref->'parent'
    AND v_batch.batch->'network'=v_ref->'network' AND v_batch.batch->'plex'=v_ref->'plex'
    AND v_batch.batch->'identityHash'=v_ref->'identityHash',false)
  THEN RAISE EXCEPTION 'Native pack command proof pointer requires its actual exact immutable paired output'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_native_operation_proof BEFORE UPDATE ON "Operation" FOR EACH ROW
  WHEN(OLD.result ? 'seriesPackNativePlexProofV2' OR NEW.result ? 'seriesPackNativePlexProofV2')
  EXECUTE FUNCTION media_series_pack_native_operation_proof_v1();

CREATE FUNCTION media_series_pack_native_finish_review_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner "MediaUser"; v_command "Operation"; v_restore "Operation"; v_network jsonb; v_forward_effects jsonb;
BEGIN
  IF NOT COALESCE(NEW.scope->>'schemaVersion'='3' AND NEW.scope->>'protocol'='series_pack_publication_v3',false) THEN RETURN NEW; END IF;
  IF OLD.plan IS NOT NULL OR NEW.plan IS NULL THEN RETURN NEW; END IF;
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=NEW."actorId" FOR SHARE;
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=NEW.plan#>>'{plex,parent,operationId}';
  SELECT o.* INTO STRICT v_restore FROM "Operation" o WHERE o.id=NEW."restoreOperationId";
  v_network:=media_series_pack_native_batch_v1(NEW.plan->'plex',NEW);
  IF NOT COALESCE(NEW.plan->>'schemaVersion'='4' AND NEW.plan->>'protocol'='series_pack_publication_v3'
    AND OLD.state='preparing' AND NEW.state='awaiting_review' AND v_owner.role='owner' AND NOT v_owner.restricted
    AND v_command.kind='prepare_series_pack_native_compensation_v1' AND v_command."targetId"=NEW.id AND v_command."userId"=NEW."actorId"
    AND v_restore.kind='restore_observe' AND v_restore.status='completed'
    AND v_restore.result->'recoveryEpoch'=to_jsonb(NEW."recoveryEpoch")
    AND NEW.plan->>'scopeHash'=NEW.plan#>>'{plex,parent,scopeHash}'
    AND NEW.plan->>'networkIdentityHash'=NEW.plan#>>'{plex,identityHash}'
    AND NEW.plan#>>'{files,planId}'=NEW.id AND NEW.plan#>>'{files,protocol}'='series_pack_publication_v3'
    AND NEW.plan#>>'{files,inverseNamespace,state}'='absent'
    AND NEW.plan#>>'{files,inverseNamespace,path}'='publication-transitions/'||(NEW.scope#>>'{transition,transitionId}')||'/compensation-'||NEW.id
    AND NEW.plan#>>'{files,intentHash}'=NEW.scope#>>'{publication,intentHash}'
    AND NEW.plan#>>'{files,transitionId}'=NEW.scope#>>'{publication,transitionId}'
    AND (v_network->>'expiresAt')::timestamptz>clock_timestamp(),false)
  THEN RAISE EXCEPTION 'Native pack review must finish from its actual paired proof and absent future namespace'; END IF;
  v_forward_effects:=media_series_pack_native_original_v1(NEW.scope);
  PERFORM media_series_pack_native_files_v1(NEW.scope,NEW.plan->'files',v_forward_effects);
  PERFORM media_series_pack_native_before_v1(NEW.scope#>'{publication,intent}',NEW."recoveryEpoch");
  PERFORM media_series_pack_native_scope_current_v1(NEW.scope,NULL,false);
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_native_finish_review BEFORE UPDATE ON "NativeRecoveryPlan" FOR EACH ROW
  EXECUTE FUNCTION media_series_pack_native_finish_review_v1();

CREATE FUNCTION media_series_pack_native_header_v1(p_row "NativePublicationCompensationContinuation")
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_row."recoveryEpoch">=0 AND p_row.version>=0 AND p_row."descriptorHash" ~ '^[a-f0-9]{64}$'
    AND cardinality(p_row."mediaIds") BETWEEN 1 AND 100 AND cardinality(p_row."assetIds") BETWEEN 1 AND 50
    AND p_row.state IN ('pending','compensating','protected','compensated')
    AND ((p_row.state='compensated')=(p_row.completion IS NOT NULL))
    AND p_row.descriptor->'schemaVersion'='2'::jsonb AND p_row.descriptor->>'protocol'='series_pack_publication_v3'
    AND p_row.descriptor->>'allowedAction'='compensate'
    AND p_row.descriptor-ARRAY['schemaVersion','protocol','allowedAction','scope','approvedFileEvidence','steps']='{}'::jsonb
    AND p_row.descriptor#>'{scope,schemaVersion}'='3'::jsonb
    AND p_row.descriptor#>>'{scope,protocol}'='series_pack_publication_v3'
    AND (p_row.descriptor->'scope')-ARRAY['schemaVersion','lifecycleKind','protocol','request','transition','publication','interruptedWork',
      'forwardParents','previousCompensation','requiredAbsences','files','media','storageRoots','household','lifecycle','torrents','interruptedAttemptRaw']='{}'::jsonb
    AND (p_row.descriptor->'scope') ?& ARRAY['schemaVersion','lifecycleKind','protocol','request','transition','publication','interruptedWork',
      'forwardParents','previousCompensation','requiredAbsences','files','media','storageRoots','household','lifecycle','torrents','interruptedAttemptRaw']
    AND jsonb_typeof(p_row.descriptor#>'{scope,media}')='array' AND jsonb_typeof(p_row.descriptor#>'{scope,files}')='array'
    AND jsonb_typeof(p_row.descriptor#>'{scope,storageRoots}')='array' AND jsonb_typeof(p_row.descriptor#>'{scope,household}')='object'
    AND (p_row.descriptor#>'{scope,household}') ?& ARRAY['requests','coverage','personalHolds','recoveryHolds']
    AND (p_row.descriptor#>'{scope,household}')-ARRAY['requests','coverage','personalHolds','recoveryHolds']='{}'::jsonb
    AND jsonb_typeof(p_row.descriptor#>'{scope,household,requests}')='array'
    AND jsonb_typeof(p_row.descriptor#>'{scope,household,coverage}')='array'
    AND jsonb_typeof(p_row.descriptor#>'{scope,household,personalHolds}')='array'
    AND jsonb_typeof(p_row.descriptor#>'{scope,household,recoveryHolds}')='array'
    AND (p_row.descriptor#>'{scope,lifecycle}') ?& ARRAY['attempts','reservations','retention','cleanup']
    AND (p_row.descriptor#>'{scope,lifecycle}')-ARRAY['attempts','reservations','retention','cleanup']='{}'::jsonb
    AND jsonb_typeof(p_row.descriptor#>'{scope,lifecycle,attempts}')='array'
    AND jsonb_typeof(p_row.descriptor#>'{scope,lifecycle,reservations}')='array'
    AND jsonb_typeof(p_row.descriptor#>'{scope,lifecycle,retention}')='array'
    AND jsonb_typeof(p_row.descriptor#>'{scope,lifecycle,cleanup}')='array'
    AND (p_row.descriptor->'approvedFileEvidence') ?& ARRAY['schemaVersion','lifecycleKind','planId','recoveryEpoch','workerPodUid','capturedAt',
      'transitionId','intentHash','acknowledgedEffects','effectPrefixHash','participants','steps','journalDigests','protocol','inverseNamespace','acknowledgedRaw','effectPrefixRaw']
    AND jsonb_array_length(p_row.descriptor#>'{scope,publication,intent,entries}') BETWEEN 1 AND 25
    AND p_row.descriptor#>'{scope,previousCompensation}'='null'::jsonb
    AND p_row."executionEvidence" IS NOT NULL AND p_row."executionEvidence"->'schemaVersion'='2'::jsonb
    AND p_row."executionEvidence"->>'protocol'='series_pack_publication_v3'
    AND p_row."executionEvidence"->>'continuationId'=p_row.id
    AND p_row."executionEvidence"->>'descriptorHash'=p_row."descriptorHash"
    AND p_row."executionEvidence"->'recoveryEpoch'=to_jsonb(p_row."recoveryEpoch")
    AND p_row."executionEvidence"-ARRAY['schemaVersion','protocol','continuationId','descriptorHash','recoveryEpoch','transition','effectPrefixHash',
      'participants','admittedByOperationId','admittedAt','inverseNamespace']='{}'::jsonb
    AND (p_row.completion IS NULL OR (p_row.completion->'schemaVersion'='2'::jsonb
      AND p_row.completion->>'protocol'='series_pack_publication_v3' AND p_row.completion->>'continuationId'=p_row.id
      AND p_row.completion->>'receiptId'=p_row."receiptId" AND p_row.completion->>'descriptorHash'=p_row."descriptorHash"
      AND p_row.completion->'recoveryEpoch'=to_jsonb(p_row."recoveryEpoch")
      AND p_row.completion ?& ARRAY['schemaVersion','protocol','continuationId','receiptId','descriptorHash','recoveryEpoch','transition','compensationEffects',
        'predecessorBindings','retainedArtifacts','journals','settlement','completedAt','executionPlex']
      AND p_row.completion-ARRAY['schemaVersion','protocol','continuationId','receiptId','descriptorHash','recoveryEpoch','transition','compensationEffects',
        'predecessorBindings','retainedArtifacts','journals','settlement','completedAt','executionPlex']='{}'::jsonb))
    AND ((p_row."verifiedPublication" IS NULL)=(p_row."fenceRelease" IS NULL))
    AND (p_row."publicationCoordinatorOperationId" IS NULL OR p_row.completion IS NOT NULL)
    AND (p_row."verifiedPublication" IS NULL OR (p_row.completion IS NOT NULL
      AND p_row."publicationCoordinatorOperationId" IS NOT NULL
      AND p_row."verifiedPublication"->>'schemaVersion'='2' AND p_row."verifiedPublication"->>'protocol'='series_pack_publication_v3'
      AND p_row."verifiedPublication"->>'continuationId'=p_row.id
      AND p_row."verifiedPublication"->>'operationId'=p_row."publicationCoordinatorOperationId"
      AND p_row."verifiedPublication"->'recoveryEpoch'=to_jsonb(p_row."recoveryEpoch")
      AND p_row."verifiedPublication"-ARRAY['schemaVersion','protocol','continuationId','operationId','recoveryEpoch','completionHash','commandHash','bindingsHash',
        'generations','serverMachineId','items','verifiedAt','commandRaw']='{}'::jsonb
      AND p_row."fenceRelease"->>'schemaVersion'='2' AND p_row."fenceRelease"->>'protocol'='series_pack_publication_v3'
      AND p_row."fenceRelease"->>'continuationId'=p_row.id AND p_row."fenceRelease"->>'transitionId'=p_row."transitionId"
      AND p_row."fenceRelease"->>'settlingContinuationId'=p_row.id
      AND p_row."fenceRelease"->'settlingCompletionHash'=p_row."verifiedPublication"->'completionHash'
      AND p_row."fenceRelease"->'releasedAt'=p_row."verifiedPublication"->'verifiedAt'
      AND p_row."fenceRelease"-ARRAY['schemaVersion','protocol','continuationId','transitionId','settlingContinuationId','settlingCompletionHash','publicationHash','releasedAt','publicationRaw']='{}'::jsonb
      AND (p_row."fenceRelease"->>'publicationRaw')::jsonb=p_row."verifiedPublication"
      AND encode(sha256(convert_to(p_row."fenceRelease"->>'publicationRaw','UTF8')),'hex')=p_row."fenceRelease"->>'publicationHash')),false);
$$;

ALTER TABLE "NativePublicationCompensationContinuation" DROP CONSTRAINT "native_pub_comp_valid";
ALTER TABLE "NativePublicationCompensationContinuation" ADD CONSTRAINT "native_pub_comp_valid" CHECK (
  -- Original descriptor-v1 expression remains literal in this branch.
  ("recoveryEpoch" >= 0 AND "version" >= 0 AND "descriptorHash" ~ '^[a-f0-9]{64}$'
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
      AND "fenceRelease"->>'publicationHash' ~ '^[a-f0-9]{64}$', FALSE)))
  OR COALESCE(descriptor->>'schemaVersion'='2' AND descriptor->>'protocol'='series_pack_publication_v3'
    AND "recoveryEpoch">=0 AND version>=0 AND cardinality("mediaIds") BETWEEN 1 AND 100
    AND cardinality("assetIds") BETWEEN 1 AND 50 AND "descriptorHash" ~ '^[a-f0-9]{64}$',false));

CREATE FUNCTION media_series_pack_native_begin_v1(p_continuation_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_continuation "NativePublicationCompensationContinuation"; v_receipt "NativeRecoveryReceipt"; v_plan "NativeRecoveryPlan";
  v_command "Operation"; v_owner "MediaUser"; v_transition "MediaPublicationTransition"; v_attempt "AcquisitionAttempt";
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT c.* INTO STRICT v_continuation FROM "NativePublicationCompensationContinuation" c WHERE c.id=p_continuation_id FOR UPDATE;
  SELECT r.* INTO STRICT v_receipt FROM "NativeRecoveryReceipt" r WHERE r.id=v_continuation."receiptId";
  SELECT p.* INTO STRICT v_plan FROM "NativeRecoveryPlan" p WHERE p.id=v_receipt."planId" FOR UPDATE;
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=v_continuation."coordinatorOperationId" FOR UPDATE;
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=v_receipt."actorId" FOR SHARE;
  SELECT t.* INTO STRICT v_transition FROM "MediaPublicationTransition" t WHERE t.id=v_continuation."transitionId" FOR UPDATE;
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=v_transition."attemptId" FOR UPDATE;
  IF NOT COALESCE(media_series_pack_native_header_v1(v_continuation) AND v_continuation.completion IS NULL
    AND v_continuation."fenceRelease" IS NULL AND v_plan.state='applied' AND v_owner.role='owner' AND NOT v_owner.restricted
    AND v_command.kind='compensate_series_pack_native_publication_v1' AND v_command."targetId"=v_continuation.id
    AND v_command."userId"=v_receipt."actorId" AND v_transition.outcome IS NULL
    AND v_transition.intent=v_continuation.descriptor#>'{scope,publication,intent}'
    AND v_attempt.id=v_continuation.descriptor#>>'{scope,publication,intent,attemptId}'
    AND v_attempt.state NOT IN ('imported','completed')
    AND EXISTS(SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active' AND r."ownershipConfirmed"
      AND r."recoveryEpoch"=v_continuation."recoveryEpoch" AND r.version=v_receipt."runtimeVersion"),false)
  THEN RAISE EXCEPTION 'Native pack inverse needs its actual current admitted owner and exact uncommitted original'; END IF;
  PERFORM media_series_pack_native_before_v1(v_transition.intent,v_continuation."recoveryEpoch");
  PERFORM media_series_pack_native_scope_current_v1(v_continuation.descriptor->'scope',v_receipt.selection,false);
  PERFORM set_config('media.series_pack_native_compensation_write',v_continuation.id,true);
  PERFORM set_config('media.series_pack_publication_write',v_transition.id,true);
END;
$$;

CREATE FUNCTION media_series_pack_native_row_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_scope jsonb; v_old "NativePublicationCompensationContinuation";
BEGIN
  IF NOT media_series_pack_native_header_v1(NEW) THEN RAISE EXCEPTION 'Native pack continuation shape is not the strict new protocol'; END IF;
  v_scope:=NEW.descriptor->'scope';
  IF TG_OP='UPDATE' AND NEW."coordinatorOperationId" IS DISTINCT FROM OLD."coordinatorOperationId" THEN
    PERFORM media_series_pack_native_retry_v1(OLD,NEW,'physical');
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM media_series_pack_native_authority_v1(NEW,false);
    PERFORM media_series_pack_native_before_v1(v_scope#>'{publication,intent}',NEW."recoveryEpoch");
    IF NEW.completion IS NOT NULL OR NEW.state<>'pending' OR (NEW."createdAt" AT TIME ZONE 'UTC')<date_trunc('milliseconds',transaction_timestamp())
      OR (NEW."createdAt" AT TIME ZONE 'UTC')>clock_timestamp()
    THEN RAISE EXCEPTION 'Native pack admission cannot fabricate completed or historical effects'; END IF;
  ELSIF OLD.completion IS NULL AND NEW.completion IS NOT NULL THEN
    SELECT c.* INTO STRICT v_old FROM "NativePublicationCompensationContinuation" c WHERE c.id=OLD.id FOR UPDATE;
    IF v_old."descriptorHash"<>NEW."descriptorHash" OR current_setting('media.series_pack_native_compensation_write',true) IS DISTINCT FROM NEW.id
      OR NEW.completion->'transition' IS DISTINCT FROM v_scope->'transition'
      OR NEW.completion#>'{settlement,releasedReservations}' IS DISTINCT FROM v_scope#>'{interruptedWork,reservations}'
      OR NEW.completion#>>'{settlement,reservationSetHash}' IS DISTINCT FROM v_scope#>>'{interruptedWork,reservationSetHash}'
      OR (NEW.completion->>'completedAt')::timestamptz<date_trunc('milliseconds',transaction_timestamp())
      OR (NEW.completion->>'completedAt')::timestamptz>clock_timestamp()
      OR EXISTS(SELECT 1 FROM "AcquisitionReservation" r WHERE r."attemptId"=v_scope#>>'{publication,intent,attemptId}')
    THEN RAISE EXCEPTION 'Native pack completion requires its exact real same-transaction inverse settlement'; END IF;
    PERFORM media_series_pack_native_authority_v1(NEW,true);
    PERFORM media_series_pack_native_after_v1(v_scope,NEW.completion);
    PERFORM media_plex_assert_deadline();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_native_row BEFORE INSERT OR UPDATE ON "NativePublicationCompensationContinuation" FOR EACH ROW
  WHEN(NEW.descriptor->>'schemaVersion'='2') EXECUTE FUNCTION media_series_pack_native_row_v1();

CREATE FUNCTION media_series_pack_native_completed_commit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_continuation "NativePublicationCompensationContinuation"; v_receipt "NativeRecoveryReceipt";
  v_plan "NativeRecoveryPlan"; v_owner "MediaUser"; v_network jsonb;
BEGIN
  IF OLD.completion IS NOT NULL OR NEW.completion IS NULL OR NEW.descriptor->>'schemaVersion'<>'2' THEN RETURN NULL; END IF;
  SELECT c.* INTO STRICT v_continuation FROM "NativePublicationCompensationContinuation" c WHERE c.id=NEW.id FOR UPDATE;
  SELECT r.* INTO STRICT v_receipt FROM "NativeRecoveryReceipt" r WHERE r.id=v_continuation."receiptId";
  SELECT p.* INTO STRICT v_plan FROM "NativeRecoveryPlan" p WHERE p.id=v_receipt."planId" FOR UPDATE;
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=v_receipt."actorId" FOR SHARE;
  v_network:=media_series_pack_native_batch_v1(v_continuation.completion->'executionPlex',v_plan);
  IF v_continuation.completion IS DISTINCT FROM NEW.completion OR v_continuation.state<>'compensated'
    OR v_continuation."verifiedPublication" IS NOT NULL OR v_continuation."fenceRelease" IS NOT NULL
    OR v_owner.role<>'owner' OR v_owner.restricted OR v_plan.state<>'applied'
    OR NOT EXISTS(SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.version=v_receipt."runtimeVersion")
    OR (v_network->>'expiresAt')::timestamptz<=clock_timestamp()
    OR current_setting('media.series_pack_native_compensation_write',true) IS DISTINCT FROM v_continuation.id
    OR EXISTS(SELECT 1 FROM "AcquisitionReservation" r WHERE r."attemptId"=v_continuation.descriptor#>>'{scope,publication,intent,attemptId}')
  THEN RAISE EXCEPTION 'Native pack whole compensation changed or expired before actual commit'; END IF;
  PERFORM media_series_pack_native_live_v1(v_continuation.descriptor->'scope',v_network,true);
  PERFORM media_series_pack_native_scope_current_v1(v_continuation.descriptor->'scope',v_receipt.selection,true);
  PERFORM media_series_pack_native_after_v1(v_continuation.descriptor->'scope',v_continuation.completion);
  PERFORM media_plex_assert_deadline();
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER series_pack_native_completed_commit AFTER UPDATE ON "NativePublicationCompensationContinuation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_series_pack_native_completed_commit_v1();

CREATE OR REPLACE FUNCTION media_series_pack_write_must_settle_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_publication_transition_id text; v_native_continuation_id text;
BEGIN
  v_publication_transition_id:=current_setting('media.series_pack_publication_write',true);
  v_native_continuation_id:=current_setting('media.series_pack_native_compensation_write',true);
  IF v_native_continuation_id IS NOT NULL AND v_native_continuation_id<>'' AND EXISTS(
    SELECT 1 FROM "NativePublicationCompensationContinuation" c WHERE c.id=v_native_continuation_id
      AND c."transitionId"=v_publication_transition_id AND c.descriptor->'schemaVersion'='2'::jsonb
      AND c.descriptor->>'protocol'='series_pack_publication_v3' AND c.state='compensated' AND c.completion IS NOT NULL
      AND c.xmin::text=pg_current_xact_id()::text)
  THEN RETURN NULL; END IF;
  -- Original default path and original publication-v3 gate remain literal.
  IF v_publication_transition_id IS NOT NULL AND v_publication_transition_id<>'' AND EXISTS (SELECT 1 FROM "MediaPublicationTransition" t WHERE t.id=v_publication_transition_id AND t.outcome IS NULL)
  THEN RAISE EXCEPTION 'Whole-pack DB publication cannot commit without its actual completion seal'; END IF;
  RETURN NULL;
END;
$$;

-- Four independently queried immutable parents. No native approval/WAL graph
-- is reconstructed here: its real immutable completion was closed at birth.
CREATE FUNCTION media_series_pack_native_publication_command_v1(p_row "NativePublicationCompensationContinuation")
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_receipt "NativeRecoveryReceipt"; v_plan "NativeRecoveryPlan"; v_command "Operation"; v_owner "MediaUser";
  v_body jsonb; v_media_id text;
BEGIN
  SELECT r.* INTO STRICT v_receipt FROM "NativeRecoveryReceipt" r WHERE r.id=p_row."receiptId";
  SELECT p.* INTO STRICT v_plan FROM "NativeRecoveryPlan" p WHERE p.id=v_receipt."planId" FOR UPDATE;
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=p_row."publicationCoordinatorOperationId" FOR UPDATE;
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=v_receipt."actorId" FOR SHARE;
  v_body:=v_command.payload-ARRAY['kind','operationId'];
  IF NOT COALESCE(media_series_pack_native_header_v1(p_row) AND p_row.state='compensated'
    AND v_owner.role='owner' AND NOT v_owner.restricted AND v_plan.state='applied'
    AND v_receipt."planId"=v_plan.id AND v_receipt."planHash"=v_plan."planHash" AND v_receipt."actorId"=v_plan."actorId"
    AND v_command.kind='publish_series_pack_native_compensation_v1' AND v_command."targetId"=p_row.id
    AND v_command."userId"=v_receipt."actorId" AND v_command.payload->>'kind'=v_command.kind AND v_command.payload->>'operationId'=v_command.id
    AND v_body->>'schemaVersion'='2' AND v_body->>'protocol'='series_pack_publication_v3'
    AND v_body->>'continuationId'=p_row.id AND v_body->'recoveryEpoch'=to_jsonb(p_row."recoveryEpoch")
    AND v_body-ARRAY['schemaVersion','protocol','continuationId','recoveryEpoch','completionHash','bindingsHash','generations','completionRaw','bindingsRaw']='{}'::jsonb
    AND (v_body->>'completionRaw')::jsonb=p_row.completion
    AND encode(sha256(convert_to(v_body->>'completionRaw','UTF8')),'hex')=v_body->>'completionHash'
    AND (v_body->>'bindingsRaw')::jsonb=p_row.completion->'predecessorBindings'
    AND encode(sha256(convert_to(v_body->>'bindingsRaw','UTF8')),'hex')=v_body->>'bindingsHash'
    AND (SELECT count(*) FROM jsonb_object_keys(v_body->'generations'))=cardinality(p_row."mediaIds")
    AND EXISTS(SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active' AND r."ownershipConfirmed" AND r."recoveryEpoch"=p_row."recoveryEpoch")
    AND NOT EXISTS(SELECT 1 FROM "RecoveryHold" h WHERE h.edition='default' AND h."mediaId"=ANY(p_row."mediaIds") AND h."releasedAt" IS NULL),false)
  THEN RAISE EXCEPTION 'Native pack serving needs its actual literal completed inverse, exact command and reconciled current owner'; END IF;
  FOR v_media_id IN SELECT m.id FROM unnest(p_row."mediaIds") m(id) LOOP
    IF NOT EXISTS(SELECT 1 FROM "MediaIntent" i WHERE i."mediaId"=v_media_id AND i.edition='default'
      AND i."automationEpoch"=p_row."recoveryEpoch" AND i.generation=(v_body->'generations'->>v_media_id)::integer
      AND i."desiredPresence" AND i.monitoring AND i."intentionallyRemovedAt" IS NULL)
      OR NOT EXISTS(SELECT 1 FROM "MediaRequest" r WHERE r."mediaId"=v_media_id AND r.edition='default' AND r.active AND NOT r.excluded
        AND (r.direct OR EXISTS(SELECT 1 FROM "RequestCoverage" c JOIN "MediaRequest" root ON root.id=c."rootRequestId" AND root.edition=c.edition
          WHERE c."requestId"=r.id AND c."mediaId"=r."mediaId" AND c.edition='default' AND c.active AND root.active AND NOT root.excluded AND root.direct)))
    THEN RAISE EXCEPTION 'Every recovered TV leaf needs actual current positive consent and exact command generation before serving'; END IF;
  END LOOP;
  PERFORM media_series_pack_native_current_bindings_v1(p_row.completion);
  PERFORM media_plex_assert_deadline();
  RETURN v_body;
END;
$$;

CREATE FUNCTION media_series_pack_native_serving_rows_v1(p_row "NativePublicationCompensationContinuation",p_command jsonb,p_same_tx boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_proof jsonb; v_item jsonb; v_pointer "PlexBindingCurrent"; v_evidence "PlexAssociationEvidence";
  v_member "PlexClaimGroupMember"; v_group "PlexClaimGroup"; v_binding jsonb;
BEGIN
  v_proof:=p_row."verifiedPublication";
  IF NOT COALESCE(v_proof->>'continuationId'=p_row.id AND v_proof->>'operationId'=p_row."publicationCoordinatorOperationId"
    AND v_proof->'recoveryEpoch'=to_jsonb(p_row."recoveryEpoch") AND v_proof->'completionHash'=p_command->'completionHash'
    AND v_proof->'bindingsHash'=p_command->'bindingsHash' AND v_proof->'generations'=p_command->'generations'
    AND (v_proof->>'commandRaw')::jsonb=p_command
    AND encode(sha256(convert_to(v_proof->>'commandRaw','UTF8')),'hex')=v_proof->>'commandHash'
    AND jsonb_array_length(v_proof->'items')=cardinality(p_row."mediaIds")
    AND (SELECT count(DISTINCT i.value->>'mediaId') FROM jsonb_array_elements(v_proof->'items') i)=cardinality(p_row."mediaIds")
    AND (v_proof->>'verifiedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp())
    AND (v_proof->>'verifiedAt')::timestamptz<=clock_timestamp(),false)
  THEN RAISE EXCEPTION 'Native pack serving receipt omitted or forged its complete current command closure'; END IF;
  FOR v_item IN SELECT i.value FROM jsonb_array_elements(v_proof->'items') i LOOP
    SELECT b.value INTO STRICT v_binding FROM jsonb_array_elements(p_row.completion->'predecessorBindings') b
      WHERE b.value#>>'{after,id}'=v_item->>'assetId';
    SELECT c.* INTO STRICT v_pointer FROM "PlexBindingCurrent" c WHERE c."mediaId"=v_item->>'mediaId' AND c.edition='default' FOR UPDATE;
    SELECT e.* INTO STRICT v_evidence FROM "PlexAssociationEvidence" e WHERE e.id=v_pointer."evidenceId";
    SELECT m.* INTO STRICT v_member FROM "PlexClaimGroupMember" m WHERE m."mediaId"=v_pointer."mediaId" AND m.edition='default';
    SELECT g.* INTO STRICT v_group FROM "PlexClaimGroup" g WHERE g.id=v_member."groupId";
    IF NOT COALESCE(v_item->>'mediaId'=ANY(p_row."mediaIds")
      AND v_item->'assetVersion'=v_binding#>'{after,version}' AND v_item->'checksum'=v_binding#>'{after,checksum}'
      AND v_item->'canonicalPath'=v_binding#>'{after,path}' AND v_item->>'identityHash' ~ '^[a-f0-9]{64}$'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_binding#>'{after,coverage}') c
        WHERE c.value->>'mediaId'=v_item->>'mediaId' AND c.value->>'edition'='default' AND c.value->'current'='true'::jsonb)
      AND v_pointer."associationHash"=v_evidence."associationHash"
      AND v_evidence."mediaId"=v_pointer."mediaId" AND v_evidence.edition='default' AND v_evidence."assetId"=v_item->>'assetId'
      AND v_evidence."serverMachineId"=v_proof->>'serverMachineId' AND v_evidence.evidence->>'kind'='episode'
      AND v_evidence.evidence#>>'{scope,mediaId}'=v_item->>'mediaId' AND v_evidence.evidence#>>'{scope,edition}'='default'
      AND v_evidence.evidence#>>'{group,assetId}'=v_item->>'assetId'
      AND v_evidence.evidence#>'{group,assetVersion}'=v_binding#>'{after,version}'
      AND v_evidence.evidence#>'{group,ownershipEpoch}'=to_jsonb(p_row."recoveryEpoch")
      AND v_evidence.evidence#>'{group,checksum}'=v_binding#>'{after,checksum}'
      AND v_evidence.evidence#>'{group,canonicalPath}'=v_item->'canonicalPath'
      AND v_evidence.evidence#>>'{access,serverMachineId}'=v_proof->>'serverMachineId'
      AND v_evidence.evidence#>'{access,sectionId}'=v_item->'sectionId'
      AND v_evidence.evidence#>'{item,ratingKey}'=v_item->'ratingKey'
      AND v_member."evidenceId"=v_evidence.id AND v_member."associationHash"=v_evidence."associationHash"
      AND v_group."group"=v_evidence.evidence->'group' AND v_group."serverMachineId"=v_proof->>'serverMachineId'
      AND EXISTS(SELECT 1 FROM "PlexItemClaim" i WHERE i."groupId"=v_group.id AND i."mediaId"=v_pointer."mediaId" AND i.edition='default'
        AND i."evidenceId"=v_evidence.id AND i."associationHash"=v_evidence."associationHash" AND i."serverMachineId"=v_proof->>'serverMachineId'
        AND i."sectionId"=v_item->>'sectionId' AND i."ratingKey"=v_item->>'ratingKey')
      AND EXISTS(SELECT 1 FROM "PlexPathClaim" p WHERE p."groupId"=v_group.id AND p."serverMachineId"=v_proof->>'serverMachineId' AND p."canonicalPath"=v_item->>'canonicalPath')
      AND EXISTS(SELECT 1 FROM "PlexPartClaim" p WHERE p."groupId"=v_group.id AND p."serverMachineId"=v_proof->>'serverMachineId'
        AND p."canonicalPath"=v_item->>'canonicalPath' AND p."partId"=v_evidence.evidence#>>'{item,media,0,parts,0,id}')
      AND (NOT p_same_tx OR (EXISTS(SELECT 1 FROM "PlexAssociationEvidence" e WHERE e.id=v_evidence.id AND e.xmin::text=pg_current_xact_id()::text)
        AND EXISTS(SELECT 1 FROM "PlexBindingCurrent" c WHERE c."mediaId"=v_pointer."mediaId" AND c.edition='default' AND c.xmin::text=pg_current_xact_id()::text))),false)
    THEN RAISE EXCEPTION 'Native pack serving receipt requires every actual new same-transaction association and complete binding/group/item/path closure'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_native_publication_row_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_command jsonb;
BEGIN
  IF NEW.descriptor->>'schemaVersion'<>'2' THEN RETURN NEW; END IF;
  IF NEW."publicationCoordinatorOperationId" IS DISTINCT FROM OLD."publicationCoordinatorOperationId" THEN
    IF OLD."fenceRelease" IS NOT NULL OR NEW.completion IS NULL
    THEN RAISE EXCEPTION 'Native pack first serving protocol cannot replace another live or historical coordinator'; END IF;
    IF OLD."publicationCoordinatorOperationId" IS NOT NULL THEN
      PERFORM media_series_pack_native_retry_v1(OLD,NEW,'publication');
    END IF;
    v_command:=media_series_pack_native_publication_command_v1(NEW);
  END IF;
  IF OLD."verifiedPublication" IS NULL AND NEW."verifiedPublication" IS NOT NULL THEN
    IF OLD.completion IS NULL OR OLD."fenceRelease" IS NOT NULL OR NEW."fenceRelease" IS NULL
    THEN RAISE EXCEPTION 'Native pack serving cannot precede its real inverse or detach the whole release'; END IF;
    v_command:=media_series_pack_native_publication_command_v1(NEW);
    PERFORM media_series_pack_native_serving_rows_v1(NEW,v_command,true);
  ELSIF (OLD."fenceRelease" IS NULL)<>(NEW."fenceRelease" IS NULL) THEN
    RAISE EXCEPTION 'Native pack whole fence release requires its actual verified serving publication';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_native_publication_row BEFORE UPDATE ON "NativePublicationCompensationContinuation" FOR EACH ROW
  EXECUTE FUNCTION media_series_pack_native_publication_row_v1();

CREATE FUNCTION media_series_pack_native_serving_commit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_command jsonb;
BEGIN
  IF NEW.descriptor->>'schemaVersion'='2' AND OLD."verifiedPublication" IS NULL AND NEW."verifiedPublication" IS NOT NULL THEN
    v_command:=media_series_pack_native_publication_command_v1(NEW);
    PERFORM media_series_pack_native_serving_rows_v1(NEW,v_command,true);
    PERFORM media_plex_assert_deadline();
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER series_pack_native_serving_commit AFTER UPDATE ON "NativePublicationCompensationContinuation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_series_pack_native_serving_commit_v1();

-- Six paid actual immutable parents. The additional xmin predicate is solely
-- current same-TX write acknowledgement closure, not another historical grant.
CREATE FUNCTION media_series_pack_native_source_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_source jsonb; v_continuation "NativePublicationCompensationContinuation"; v_receipt "NativeRecoveryReceipt";
  v_transition "MediaPublicationTransition"; v_attempt "AcquisitionAttempt"; v_torrent "Torrent"; v_owner "MediaUser";
BEGIN
  v_source:=NEW.payload->'seriesPackNativeSourceV1';
  SELECT c.* INTO STRICT v_continuation FROM "NativePublicationCompensationContinuation" c WHERE c.id=v_source->>'continuationId';
  SELECT r.* INTO STRICT v_receipt FROM "NativeRecoveryReceipt" r WHERE r.id=v_continuation."receiptId";
  SELECT t.* INTO STRICT v_transition FROM "MediaPublicationTransition" t WHERE t.id=v_continuation."transitionId";
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=v_transition."attemptId";
  SELECT t.* INTO STRICT v_torrent FROM "Torrent" t WHERE t.id=v_attempt."torrentId";
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=v_receipt."actorId";
  IF NOT COALESCE(NEW.kind='maintain_torrent' AND NEW."targetId"=v_torrent.id AND NEW."userId"=v_owner.id
    AND NEW."idempotencyKey"='native-series-pack-source-v1:'||v_continuation.id||':'||v_torrent.id
    AND NEW.payload->>'kind'=NEW.kind AND NEW.payload->>'operationId'=NEW.id AND NEW.payload->>'torrentId'=v_torrent.id
    AND NEW.payload->'recoveryEpoch'=to_jsonb(v_continuation."recoveryEpoch")
    AND NEW.payload-ARRAY['kind','operationId','torrentId','recoveryEpoch','seriesPackNativeSourceV1']='{}'::jsonb
    AND v_source->>'schemaVersion'='1' AND v_source->>'protocol'='series_pack_publication_v3'
    AND v_source-ARRAY['schemaVersion','protocol','continuationId','descriptorHash','completionHash','publicationHash','originalAttemptId','recoveryEpoch']='{}'::jsonb
    AND v_source->>'descriptorHash'=v_continuation."descriptorHash"
    AND v_source->'recoveryEpoch'=to_jsonb(v_continuation."recoveryEpoch")
    AND v_source->>'originalAttemptId'=v_attempt.id
    AND media_series_pack_native_header_v1(v_continuation) AND v_continuation.descriptor->>'schemaVersion'='2'
    AND v_continuation.state='compensated' AND v_continuation.completion IS NOT NULL
    AND v_continuation."verifiedPublication" IS NOT NULL AND v_continuation."fenceRelease" IS NOT NULL
    AND v_source->'completionHash'=v_continuation."fenceRelease"->'settlingCompletionHash'
    AND v_source->'publicationHash'=v_continuation."fenceRelease"->'publicationHash'
    AND v_transition.outcome IS NULL AND v_transition.intent=v_continuation.descriptor#>'{scope,publication,intent}'
    AND v_transition."intentHash"=v_continuation.descriptor#>>'{scope,publication,intentHash}'
    AND v_torrent.owned AND v_torrent."ownershipEpoch"=v_attempt."recoveryEpoch"
    AND v_attempt."recoveryEpoch"=v_transition."birthEpoch" AND v_transition."birthEpoch"<v_continuation."recoveryEpoch"
    AND v_owner.role='owner' AND NOT v_owner.restricted
    AND EXISTS(SELECT 1 FROM "NativePublicationCompensationContinuation" c WHERE c.id=v_continuation.id AND c.xmin::text=pg_current_xact_id()::text)
    AND EXISTS(SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active' AND r."ownershipConfirmed" AND r."recoveryEpoch"=v_continuation."recoveryEpoch"),false)
  THEN RAISE EXCEPTION 'Native pack source work requires its actual same-transaction whole verified serving acknowledgement and original owned torrent'; END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_native_source_birth BEFORE INSERT ON "Operation" FOR EACH ROW
  WHEN(NEW.payload ? 'seriesPackNativeSourceV1') EXECUTE FUNCTION media_series_pack_native_source_birth_v1();

-- A physical compensation alone never opens ordinary serving or mutations.
-- The original intent and NULL outcome remain literal after this exact release.
CREATE FUNCTION media_series_pack_native_released_v1(p_transition_id text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM "NativePublicationCompensationContinuation" c WHERE c."transitionId"=p_transition_id
    AND c.descriptor->>'schemaVersion'='2' AND c.descriptor->>'protocol'='series_pack_publication_v3'
    AND c.state='compensated' AND c.completion IS NOT NULL AND c."verifiedPublication" IS NOT NULL AND c."fenceRelease" IS NOT NULL
    AND media_series_pack_native_header_v1(c));
$$;

CREATE OR REPLACE FUNCTION media_series_pack_pending_inventory_v1() RETURNS trigger LANGUAGE plpgsql AS $$
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
      AND NOT media_series_pack_native_released_v1(v_transition.id)
    THEN RAISE EXCEPTION 'Pending whole-pack publication inventory is fenced'; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
-- New descriptor-v2 execution ownership only. Neither coordinator replacement
-- rewrites admission, physical effects, completed inverse or historical times.
CREATE FUNCTION media_series_pack_native_retry_v1(p_old "NativePublicationCompensationContinuation",p_new "NativePublicationCompensationContinuation",p_phase text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE h_id text; h_before text; h_capture record; h_command "Operation"; h_previous "Operation"; h_proof jsonb;
  h_receipt "NativeRecoveryReceipt"; h_plan "NativeRecoveryPlan"; h_owner "MediaUser";
  h_runtime "MediaRuntimeState"; h_writer "LegacyWriterLease"; h_kind text;
BEGIN
  PERFORM media_plex_assert_deadline();
  IF p_phase='physical' THEN
    h_id:=p_new."coordinatorOperationId"; h_before:=p_old."coordinatorOperationId"; h_kind:='compensate_series_pack_native_publication_v1';
  ELSIF p_phase='publication' THEN
    h_id:=p_new."publicationCoordinatorOperationId"; h_before:=p_old."publicationCoordinatorOperationId"; h_kind:='publish_series_pack_native_compensation_v1';
  ELSE RAISE EXCEPTION 'Unknown native pack retry phase'; END IF;
  SELECT o AS operation,o.xmin::text AS birth INTO STRICT h_capture FROM "Operation" o WHERE o.id=h_id FOR UPDATE;
  h_command:=h_capture.operation;
  SELECT o.* INTO STRICT h_previous FROM "Operation" o WHERE o.id=h_before FOR SHARE;
  SELECT r.* INTO STRICT h_receipt FROM "NativeRecoveryReceipt" r WHERE r.id=p_old."receiptId";
  SELECT p.* INTO STRICT h_plan FROM "NativeRecoveryPlan" p WHERE p.id=h_receipt."planId";
  SELECT u.* INTO STRICT h_owner FROM "MediaUser" u WHERE u.id=h_receipt."actorId" FOR SHARE;
  SELECT r.* INTO STRICT h_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT w.* INTO STRICT h_writer FROM "LegacyWriterLease" w WHERE w.id='singleton';
  h_proof:=h_command.result->'seriesPackNativeRetryV1';
  IF NOT COALESCE(media_series_pack_native_header_v1(p_old) AND media_series_pack_native_header_v1(p_new)
    AND p_new.id=p_old.id AND p_new."descriptorHash"=p_old."descriptorHash" AND p_new."version"=p_old."version"+1
    AND p_old."fenceRelease" IS NULL AND p_new."fenceRelease" IS NULL
    AND h_id<>h_before AND h_capture.birth=(txid_current()%4294967296)::text
    AND h_command.kind=h_kind AND h_previous.kind=h_kind AND h_command."targetId"=p_old.id AND h_previous."targetId"=p_old.id
    AND h_command."userId"=h_owner.id AND h_previous."userId"=h_owner.id
    AND h_command.payload->>'operationId'=h_command.id AND h_command.payload->>'kind'=h_kind
    AND h_command.payload->>'continuationId'=p_old.id AND h_command.payload->'recoveryEpoch'=to_jsonb(p_old."recoveryEpoch")
    AND h_previous.payload->>'operationId'=h_previous.id AND h_previous.payload->>'kind'=h_kind
    AND h_previous.payload->>'continuationId'=p_old.id AND h_previous.payload->'recoveryEpoch'=to_jsonb(p_old."recoveryEpoch")
    AND h_proof ?& ARRAY['schemaVersion','continuationId','descriptorHash','recoveryEpoch','previousVersion','phase','previousWorkflowClosed','operationId','actorId','transactionId','observedAt','expiresAt']
    AND (h_proof-ARRAY['schemaVersion','continuationId','descriptorHash','recoveryEpoch','previousVersion','phase','previousWorkflowClosed','operationId','actorId','transactionId','observedAt','expiresAt'])='{}'::jsonb
    AND h_proof->'schemaVersion'='1'::jsonb AND h_proof->>'continuationId'=p_old.id AND h_proof->>'descriptorHash'=p_old."descriptorHash"
    AND h_proof->'recoveryEpoch'=to_jsonb(p_old."recoveryEpoch") AND h_proof->'previousVersion'=to_jsonb(p_old."version")
    AND h_proof->>'phase'=p_phase AND h_proof->>'operationId'=h_command.id AND h_proof->>'actorId'=h_owner.id
    AND h_proof->>'transactionId'=txid_current()::text
    AND h_proof->'previousWorkflowClosed' ?& ARRAY['operationId','workflowId','runId','status','observedAt']
    AND ((h_proof->'previousWorkflowClosed')-ARRAY['operationId','workflowId','runId','status','observedAt'])='{}'::jsonb
    AND h_proof#>>'{previousWorkflowClosed,operationId}'=h_before
    AND h_proof#>>'{previousWorkflowClosed,workflowId}'='media-operation-'||h_before
    AND length(h_proof#>>'{previousWorkflowClosed,runId}')>0
    AND h_proof#>>'{previousWorkflowClosed,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND (h_proof->>'observedAt')::timestamptz<=(h_proof#>>'{previousWorkflowClosed,observedAt}')::timestamptz
    AND (h_proof#>>'{previousWorkflowClosed,observedAt}')::timestamptz<=clock_timestamp()
    AND (h_proof->>'expiresAt')::timestamptz<=(h_proof->>'observedAt')::timestamptz+interval '15 seconds'
    AND clock_timestamp()<(h_proof->>'expiresAt')::timestamptz
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (h_proof->>'expiresAt')::timestamptz)*1000
    AND (h_command."createdAt" AT TIME ZONE 'UTC')>=date_trunc('milliseconds',transaction_timestamp())
    AND (h_command."createdAt" AT TIME ZONE 'UTC')<=clock_timestamp()
    AND h_receipt."planId"=p_old.id AND h_receipt."recoveryEpoch"=p_old."recoveryEpoch" AND h_plan.state='applied'
    AND h_plan."planHash"=h_receipt."planHash" AND h_owner.role='owner' AND NOT h_owner.restricted
    AND h_runtime.mode='active' AND h_runtime."ownershipConfirmed" AND h_runtime."recoveryEpoch"=p_old."recoveryEpoch"
    AND h_runtime.version=h_receipt."runtimeVersion" AND h_writer."recoveryEpoch"=p_old."recoveryEpoch"
    AND (h_writer."expiresAt" AT TIME ZONE 'UTC')>clock_timestamp(),false)
  THEN RAISE EXCEPTION 'Native pack retry needs its actual fresh terminal run, current owner and exact same-transaction pointer CAS'; END IF;
  IF p_phase='physical' THEN
    IF p_old.completion IS NOT NULL OR p_new.completion IS NOT NULL OR p_new.state<>'compensating'
      OR p_new."executionEvidence" IS DISTINCT FROM p_old."executionEvidence"
      OR p_new."publicationCoordinatorOperationId" IS DISTINCT FROM p_old."publicationCoordinatorOperationId"
      OR (h_command.payload-'operationId') IS DISTINCT FROM (h_previous.payload-'operationId')
    THEN RAISE EXCEPTION 'Native pack physical retry must retain its exact original admission and command scope'; END IF;
  ELSIF p_old.completion IS NULL OR p_new.completion IS DISTINCT FROM p_old.completion OR p_new.state IS DISTINCT FROM p_old.state
    OR p_new."coordinatorOperationId" IS DISTINCT FROM p_old."coordinatorOperationId"
    OR p_new."executionEvidence" IS DISTINCT FROM p_old."executionEvidence"
  THEN RAISE EXCEPTION 'Native pack publication retry must retain its actual completed inverse'; END IF;
  PERFORM media_plex_assert_deadline();
END;
$$;

CREATE FUNCTION media_series_pack_native_retry_literal_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb)?'seriesPackNativeRetryV1'
    THEN RAISE EXCEPTION 'Native pack retry retains its actual execution command'; END IF;
    RETURN OLD;
  END IF;
  IF COALESCE(OLD.result,'{}'::jsonb)?'seriesPackNativeRetryV1' AND
    ((NEW.result->'seriesPackNativeRetryV1') IS DISTINCT FROM (OLD.result->'seriesPackNativeRetryV1') OR
      (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload,NEW."createdAt") IS DISTINCT FROM
      (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload,OLD."createdAt"))
  THEN RAISE EXCEPTION 'Native pack retry observations and command identities are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_native_retry_literal BEFORE UPDATE OR DELETE ON "Operation" FOR EACH ROW
  EXECUTE FUNCTION media_series_pack_native_retry_literal_v1();
