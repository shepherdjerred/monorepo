-- Additive exact-cut household review. Historical unversioned/v2 rows retain their original guards.
-- Canonical bytes come from the existing application serializer; SQL checks their real row and SHA256.
-- Prisma DateTime columns are UTC TIMESTAMP(3); compare ISO instants and the real clock in that same representation.
CREATE FUNCTION media_movie_history_capture_hash_v3(p_review "RecoveryReview") RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "ApplicationEvent" e
    WHERE e.kind='movie_history_review_captured_v3' AND e."dedupeKey"='movie-history-review-v3:'||p_review.id
      AND e."actorId"=p_review."actorId" AND e."mediaId"=p_review.scope#>>'{scope,mediaId}'
      AND e.payload->'schemaVersion'='3'::jsonb AND e.payload->>'reviewId'=p_review.id
      AND e.payload->'scope'=p_review.scope->'scope' AND e.payload->>'scopeHash'=p_review."scopeHash"
      AND (e.payload->>'scopeRaw')::jsonb=p_review.scope
      AND encode(sha256(convert_to(e.payload->>'scopeRaw','UTF8')),'hex')=p_review."scopeHash");
$$;

CREATE FUNCTION media_movie_history_subject_v3(p_subject jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_subject-ARRAY['applicableMediaIds','claimAcknowledgements']=jsonb_build_object(
    'id',u.id,'displayName',u."displayName",'plexAccountId',u."plexAccountId",'version',u.version,
    'role',u.role,'restricted',u.restricted,'mappingVersion',m.version,'mappingKind',m.kind,
    'serverMachineId',m."serverMachineId",'homeUserId',m."homeUserId",'serverAccountId',m."serverAccountId",
    'permittedSectionIds',COALESCE(to_jsonb(m."permittedSectionIds"),'[]'::jsonb),
    'permittedMediaKinds',COALESCE(to_jsonb(m."permittedMediaKinds"),'[]'::jsonb),
    'plexRestricted',COALESCE(m."plexRestricted",true),
    'declarationAuthority',CASE WHEN m.kind='managed' THEN 'managed_owner' ELSE 'self' END),false)
  FROM "MediaUser" u LEFT JOIN "PlexIdentityMapping" m ON m."userId"=u.id WHERE u.id=p_subject->>'id';
$$;

-- This is the literal registered-definition digest already used by movie choice SQL022.
CREATE FUNCTION media_movie_history_definition_v3(p_scope jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_scope->'registryVersion'='1'::jsonb
    AND p_scope#>'{definition,definitionVersion}'=to_jsonb(d."definitionVersion")
    AND p_scope#>>'{definition,definitionDigest}'=encode(sha256(convert_to(
      '{"definitionVersion":'||d."definitionVersion"::text||',"key":'||to_json(d.key)::text
      ||',"pathLabel":'||to_json(d."pathLabel")::text||',"plexLabel":'||to_json(d."plexLabel")::text
      ||',"policy":'||to_json(d.policy)::text||',"rootMediaId":'||to_json(d."rootMediaId")::text||'}','UTF8')),'hex'),false)
    FROM "MediaEditionDefinition" d WHERE d."rootMediaId"=p_scope#>>'{scope,rootMediaId}' AND d.key=p_scope#>>'{scope,edition}';
$$;

CREATE FUNCTION media_movie_history_inventory_v3(p_scope jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_request jsonb; v_keep jsonb; v_row "MediaRequest"; v_hold "RetentionHold"; v_choice "MovieEditionChoice";
BEGIN
  IF (SELECT count(*) FROM "MediaRequest" r WHERE r."mediaId"=p_scope#>>'{scope,mediaId}' AND r.edition=p_scope#>>'{scope,edition}')
    <>jsonb_array_length(p_scope->'requests') OR jsonb_array_length(p_scope->'requests')>100
    OR (SELECT count(DISTINCT a.value->>'id') FROM jsonb_array_elements(p_scope->'requests') AS a(value))<>jsonb_array_length(p_scope->'requests')
    THEN RETURN false; END IF;
  FOR v_request IN SELECT a.value FROM jsonb_array_elements(p_scope->'requests') AS a(value) LOOP
    SELECT r.* INTO STRICT v_row FROM "MediaRequest" r WHERE r.id=v_request->>'id';
    IF NOT COALESCE(v_row."mediaId"=p_scope#>>'{scope,mediaId}' AND v_row.edition=p_scope#>>'{scope,edition}'
      AND v_request->>'userId'=v_row."userId" AND v_request->'version'=to_jsonb(v_row.version)
      AND v_request->'active'=to_jsonb(v_row.active) AND v_request->'excluded'=to_jsonb(v_row.excluded)
      AND v_request->'direct'=to_jsonb(v_row.direct)
      AND v_request->'movieEditionChoiceId'=COALESCE(to_jsonb(v_row."movieEditionChoiceId"),'null'::jsonb)
      AND v_request->'movieEditionChoiceRevision'=to_jsonb(v_row."movieEditionChoiceRevision")
      AND v_request->'subtitleLanguages'=to_jsonb(v_row."subtitleLanguages")
      AND ((v_request->>'createdAt')::timestamptz AT TIME ZONE 'UTC')=v_row."createdAt"
      AND ((v_request->>'updatedAt')::timestamptz AT TIME ZONE 'UTC')=v_row."updatedAt",false)
    THEN RETURN false; END IF;
    IF v_row."movieEditionChoiceId" IS NOT NULL THEN
      SELECT c.* INTO STRICT v_choice FROM "MovieEditionChoice" c WHERE c.id=v_row."movieEditionChoiceId";
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'choices') AS a(value)
        WHERE a.value=jsonb_build_object('id',v_choice.id,'requestId',v_choice."requestId",'choiceRevision',v_choice."choiceRevision",
          'actorId',v_choice."actorId",'subjectUserId',v_choice."subjectUserId",'rootMediaId',v_choice."rootMediaId",
          'edition',v_choice.edition,'definitionVersion',v_choice."definitionVersion",'registryVersion',v_choice."registryVersion",
          'requestVersionAtChoice',v_choice."requestVersionAtChoice",'authority',v_choice.authority,
          'createdAt',to_char(v_choice."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          AND v_choice."requestId"=v_row.id AND v_choice."choiceRevision"=v_row."movieEditionChoiceRevision"
          AND v_choice."subjectUserId"=v_row."userId" AND v_choice."rootMediaId"=v_row."mediaId" AND v_choice.edition=v_row.edition)
      THEN RETURN false; END IF;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT a.value->>'id') FROM jsonb_array_elements(p_scope->'choices') AS a(value))<>jsonb_array_length(p_scope->'choices')
    OR jsonb_array_length(p_scope->'choices')<>(SELECT count(*) FROM "MediaRequest" r
      WHERE r."mediaId"=p_scope#>>'{scope,mediaId}' AND r.edition=p_scope#>>'{scope,edition}' AND r."movieEditionChoiceId" IS NOT NULL)
    THEN RETURN false; END IF;
  IF (SELECT count(*) FROM "RetentionHold" h WHERE h."mediaId"=p_scope#>>'{scope,mediaId}' AND h.edition=p_scope#>>'{scope,edition}')
    <>jsonb_array_length(p_scope->'personalHolds') OR jsonb_array_length(p_scope->'personalHolds')>100
    OR (SELECT count(DISTINCT a.value->>'id') FROM jsonb_array_elements(p_scope->'personalHolds') AS a(value))<>jsonb_array_length(p_scope->'personalHolds')
    THEN RETURN false; END IF;
  FOR v_keep IN SELECT a.value FROM jsonb_array_elements(p_scope->'personalHolds') AS a(value) LOOP
    SELECT h.* INTO STRICT v_hold FROM "RetentionHold" h WHERE h.id=v_keep->>'id';
    IF NOT COALESCE(v_hold."mediaId"=p_scope#>>'{scope,mediaId}' AND v_hold.edition=p_scope#>>'{scope,edition}'
      AND v_keep->>'userId'=v_hold."userId" AND v_keep->'isPin'=to_jsonb(v_hold."isPin")
      AND ((v_keep->>'until')::timestamptz AT TIME ZONE 'UTC') IS NOT DISTINCT FROM v_hold.until
      AND ((v_keep->>'createdAt')::timestamptz AT TIME ZONE 'UTC')=v_hold."createdAt",false) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION media_movie_history_coordinates_v3(p_record jsonb,p_media text,p_exact boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_exact THEN
    p_record->>'scope'='movie' AND p_record->'externalIds'<>'{}'::jsonb AND jsonb_strip_nulls(jsonb_build_object(
      'tmdb',COALESCE(to_jsonb(m."tmdbId"),m."externalIds"->'tmdb'),'tvdb',m."externalIds"->'tvdb','imdb',m."externalIds"->'imdb')) @> (p_record->'externalIds')
  ELSE p_record->'externalIds'='{}'::jsonb OR (p_record->>'scope'='movie' AND EXISTS (
    SELECT 1 FROM jsonb_each(p_record->'externalIds') AS a(key,value)
    WHERE a.value=CASE WHEN a.key='tmdb' THEN COALESCE(to_jsonb(m."tmdbId"),m."externalIds"->'tmdb') ELSE m."externalIds"->a.key END)) END
  FROM "MediaItem" m WHERE m.id=p_media AND m.kind='movie';
$$;

CREATE FUNCTION media_movie_history_claims_v3(p_scope jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_claim jsonb; v_record "MigrationRecord"; v_capture "MigrationCapture"; v_binding "LegacyRequesterBinding";
BEGIN
  FOR v_claim IN SELECT a.value FROM jsonb_array_elements(p_scope->'legacyClaims') AS a(value) LOOP
    SELECT c.* INTO STRICT v_capture FROM "MigrationCapture" c WHERE c.id=v_claim->>'captureId';
    SELECT r.* INTO STRICT v_record FROM "MigrationRecord" r WHERE r."captureId"=v_capture.id AND r."provenanceKey"=v_claim->>'provenanceKey';
    SELECT b.* INTO STRICT v_binding FROM "LegacyRequesterBinding" b WHERE b.id=v_claim->>'bindingId';
    IF NOT COALESCE(v_capture.complete AND v_capture.stable AND v_capture."sourceKind" IN ('overseerr','jellyseerr','seerr')
      AND v_capture."manifestHash"=v_claim->>'captureHash' AND v_capture."sourceInstanceId"=v_claim->>'sourceInstanceId'
      AND v_record."observationHash"=v_claim->>'recordDigest' AND v_record.kind='request'
      AND v_record.payload->>'scope'='movie' AND v_record.payload->'active'='true'::jsonb
      AND media_movie_history_coordinates_v3(v_record.payload,p_scope#>>'{scope,mediaId}',true)
      AND v_record.payload->>'requesterSourceId'=v_claim->>'requesterSourceId'
      AND v_binding."captureId"=v_capture.id AND v_binding."captureHash"=v_capture."manifestHash"
      AND v_binding."sourceKind"=v_capture."sourceKind" AND v_binding."sourceInstanceId"=v_capture."sourceInstanceId"
      AND v_binding."requesterSourceId"=v_claim->>'requesterSourceId' AND v_binding."userId"=v_claim->>'userId'
      AND v_binding.revision=(v_claim->>'bindingRevision')::integer
      AND v_claim->'mediaIds'=jsonb_build_array(p_scope#>>'{scope,mediaId}')
      AND v_claim->'outsideMediaIds'='[]'::jsonb AND v_claim->'sourceScope'='"movie"'::jsonb AND v_claim->'seasons'='[]'::jsonb
      AND (v_claim->>'latestBindingRevision')::integer=(SELECT b.revision FROM "LegacyRequesterBinding" b
        WHERE b."sourceKind"=v_binding."sourceKind" AND b."sourceInstanceId"=v_binding."sourceInstanceId"
          AND b."requesterSourceId"=v_binding."requesterSourceId" ORDER BY b.revision DESC LIMIT 1),false) THEN RETURN false; END IF;
  END LOOP;
  -- Every current active selected-movie record must still be shown or be accounted by its literal selected-cut parent.
  -- A blocked review may be captured for inspection; only a blocker-free review can release anything.
  IF jsonb_array_length(p_scope->'blockers')=0 AND EXISTS (
    SELECT 1 FROM "MigrationRecord" r JOIN "MigrationCapture" c ON c.id=r."captureId"
    JOIN "MediaItem" m ON m.id=p_scope#>>'{scope,mediaId}'
    WHERE r.kind='request' AND r.payload->'active'='true'::jsonb
      AND media_movie_history_coordinates_v3(r.payload,m.id,false)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'legacyClaims') AS a(value)
        WHERE a.value->>'captureId'=r."captureId" AND a.value->>'provenanceKey'=r."provenanceKey"
          AND a.value->>'recordDigest'=r."observationHash")
      AND NOT EXISTS (SELECT 1 FROM "RecoveryReleaseReceipt" q JOIN "RecoveryReview" v ON v.id=q."reviewId",
        LATERAL jsonb_array_elements(CASE WHEN q."claimAccounting"->'schemaVersion'='3'::jsonb
          THEN q."claimAccounting"->'claims' WHEN jsonb_typeof(q."claimAccounting")='array' AND p_scope#>>'{scope,edition}'='default'
          THEN q."claimAccounting" ELSE '[]'::jsonb END) AS a(value)
        WHERE q."recoveryEpoch"=(p_scope->>'recoveryEpoch')::integer AND v.state='released' AND q."scopeHash"=v."scopeHash"
          AND ((v.scope->'schemaVersion'='3'::jsonb AND v.scope->'scope'=p_scope->'scope'
              AND q."claimAccounting"->'scope'=p_scope->'scope' AND media_movie_history_capture_hash_v3(v))
            OR (p_scope#>>'{scope,edition}'='default' AND (NOT (v.scope ? 'schemaVersion') OR v.scope->'schemaVersion'='2'::jsonb)
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.scope->'holds') AS h(value) WHERE h.value->>'mediaId'=m.id)))
          AND a.value->>'captureId'=r."captureId" AND a.value->>'provenanceKey'=r."provenanceKey"
          AND a.value->>'recordDigest'=r."observationHash" AND (a.value->'mediaIds') @> jsonb_build_array(m.id)))
  THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION media_movie_history_subtitle_v3(p_s "SubtitleAsset") RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id',p_s.id,'assetId',p_s."assetId",'version',p_s.version,'ownershipEpoch',p_s."ownershipEpoch",
    'state',p_s.state,'qualityStatus',p_s."qualityStatus",'storageKind',p_s."storageKind",'language',p_s.language,
    'providerId',p_s."providerId",'path',p_s.path,'checksum',p_s.checksum,'videoChecksum',p_s."videoChecksum",
    'videoVersion',p_s."videoVersion",'forced',p_s.forced,'hearingImpaired',p_s."hearingImpaired",'streamIndex',p_s."streamIndex",
    'codec',p_s.codec,'provenance',p_s.provenance,'matchingEvidence',p_s."matchingEvidence",
    'contentChecksum',CASE WHEN p_s.content IS NULL THEN NULL ELSE encode(sha256(p_s.content),'hex') END);
$$;

CREATE FUNCTION media_movie_history_asset_v3(p_scope jsonb,p_asset "LibraryAsset") RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_rows jsonb; v_row jsonb; v_subtitle "SubtitleAsset"; v_coverage jsonb;
BEGIN
  IF p_scope#>'{asset,scope}' IS DISTINCT FROM p_scope->'scope' OR p_scope#>'{asset,schemaVersion}' IS DISTINCT FROM '2'::jsonb THEN RETURN false; END IF;
  IF (p_scope->'asset')-ARRAY['scope','schemaVersion','coverage','subtitles','subtitleHistory'] IS DISTINCT FROM jsonb_build_object(
    'id',p_asset.id,'version',p_asset.version,'edition',p_asset.edition,'editionRootId',p_asset."editionRootId",
    'owned',p_asset.owned,'ownershipEpoch',p_asset."ownershipEpoch",'state',p_asset.state,'path',p_asset.path,'sourcePath',p_asset."sourcePath",
    'checksum',p_asset.checksum,'sizeBytes',p_asset."sizeBytes"::text,'properties',p_asset.properties,'supersededByAssetId',p_asset."supersededByAssetId",
    'plexPublishedAt',CASE WHEN p_asset."plexPublishedAt" IS NULL THEN NULL ELSE to_char(p_asset."plexPublishedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'rollbackExpiresAt',CASE WHEN p_asset."rollbackExpiresAt" IS NULL THEN NULL ELSE to_char(p_asset."rollbackExpiresAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mediaId',c."mediaId",'edition',c.edition,'current',c.current) ORDER BY c."mediaId"),'[]'::jsonb)
    INTO v_coverage FROM "AssetCoverage" c WHERE c."assetId"=p_asset.id;
  IF v_coverage IS DISTINCT FROM p_scope#>'{asset,coverage}' THEN RETURN false; END IF;
  v_rows:=(p_scope#>'{asset,subtitles}')||(p_scope#>'{asset,subtitleHistory}');
  IF (SELECT count(*) FROM "SubtitleAsset" s WHERE s."assetId"=p_asset.id)<>jsonb_array_length(v_rows)
    OR (SELECT count(DISTINCT a.value->>'id') FROM jsonb_array_elements(v_rows) AS a(value))<>jsonb_array_length(v_rows) THEN RETURN false; END IF;
  FOR v_row IN SELECT a.value FROM jsonb_array_elements(v_rows) AS a(value) LOOP
    SELECT s.* INTO STRICT v_subtitle FROM "SubtitleAsset" s WHERE s.id=v_row->>'id' AND s."assetId"=p_asset.id;
    IF media_movie_history_subtitle_v3(v_subtitle) IS DISTINCT FROM v_row THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION media_movie_history_scope_current_v3(p_scope jsonb,p_released boolean,p_birth boolean) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_target "MediaIntent"; v_media "MediaItem"; v_hold "RecoveryHold"; v_asset "LibraryAsset";
  v_adoption "MediaHandoffReceipt"; v_plan "MediaHandoffPlan"; v_pointer "PlexBindingCurrent";
  v_association "PlexAssociationEvidence"; v_runtime "MediaRuntimeState"; v_subject jsonb;
  v_approval "MigrationBundleReview"; v_bundle "MigrationBundle";
  v_delta integer:=CASE WHEN p_released THEN 1 ELSE 0 END;
BEGIN
  IF NOT COALESCE(p_scope->'schemaVersion'='3'::jsonb AND p_scope#>>'{scope,rootMediaId}'=p_scope#>>'{scope,mediaId}'
    AND p_scope#>'{scope,edition}'=p_scope#>'{target,edition}' AND p_scope#>'{scope,mediaId}'=p_scope#>'{target,mediaId}'
    AND p_scope#>'{scope,mediaId}'=p_scope#>'{hold,mediaId}' AND p_scope#>'{scope,edition}'=p_scope#>'{hold,edition}',false) THEN RETURN false; END IF;
  SELECT m.* INTO STRICT v_media FROM "MediaItem" m WHERE m.id=p_scope#>>'{scope,mediaId}';
  SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_media.id AND t.edition=p_scope#>>'{scope,edition}';
  SELECT h.* INTO STRICT v_hold FROM "RecoveryHold" h WHERE h."mediaId"=v_media.id AND h.edition=v_target.edition;
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT p.* INTO STRICT v_pointer FROM "PlexBindingCurrent" p WHERE p."mediaId"=v_media.id AND p.edition=v_target.edition;
  SELECT a.* INTO STRICT v_association FROM "PlexAssociationEvidence" a WHERE a.id=v_pointer."evidenceId";
  SELECT a.* INTO STRICT v_asset FROM "LibraryAsset" a WHERE a.id=v_association."assetId";
  IF NOT COALESCE(v_media.kind='movie' AND v_media.id=v_target."editionRootId" AND v_asset."editionRootId"=v_media.id
    AND v_asset.edition=v_target.edition AND v_asset.owned AND v_asset.state='published'
    AND v_media.version=(p_scope#>>'{media,version}')::integer+v_delta
    AND v_target.version=(p_scope#>>'{target,version}')::integer+v_delta
    AND v_target.generation=(p_scope#>>'{target,generation}')::integer+v_delta
    AND v_target."automationEpoch"=(p_scope->>'recoveryEpoch')::integer
    AND v_target."desiredPresence"=(p_scope#>>'{target,desiredPresence}')::boolean
    AND v_target.monitoring=(p_scope#>>'{target,monitoring}')::boolean
    AND v_target."libraryMonitoring"=(p_scope#>>'{target,libraryMonitoring}')::boolean
    AND v_target."profileId" IS NOT DISTINCT FROM p_scope#>>'{target,profileId}'
    AND v_target.availability::text=p_scope#>>'{target,availability}'
    AND v_target."intentionallyRemovedAt" IS NOT DISTINCT FROM ((p_scope#>>'{target,intentionallyRemovedAt}')::timestamptz AT TIME ZONE 'UTC')
    AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_runtime."recoveryEpoch"=v_target."automationEpoch"
    AND v_runtime.version=(p_scope->>'runtimeVersion')::integer
    AND v_hold."recoveryEpoch"=v_runtime."recoveryEpoch" AND v_hold.version=(p_scope#>>'{hold,version}')::integer+v_delta
    AND v_hold.reason=p_scope#>>'{hold,reason}' AND (v_hold."releasedAt" IS NOT NULL)=p_released
    AND v_pointer."evidenceId"=p_scope#>>'{binding,evidenceId}' AND v_pointer."associationHash"=p_scope#>>'{binding,associationHash}'
    AND v_pointer.revision=(p_scope#>>'{binding,revision}')::integer
    AND v_association."mediaId"=v_media.id AND v_association.edition=v_target.edition
    AND v_association."serverMachineId"=p_scope#>>'{access,serverMachineId}'
    AND v_association.evidence#>>'{access,sectionId}'=p_scope#>>'{access,movieSectionId}'
    AND v_association.evidence#>>'{access,sectionType}'='movie'
    AND v_asset.id=p_scope#>>'{publication,assetId}' AND v_asset.version=(p_scope#>>'{publication,assetVersion}')::integer
    AND media_movie_history_asset_v3(p_scope,v_asset)
    AND EXISTS (SELECT 1 FROM "LegacyWriterLease" l WHERE l.id='singleton' AND l."revokedAt" IS NULL
      AND l."recoveryEpoch"=v_runtime."recoveryEpoch" AND l."observedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
      AND l."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
      AND l."expiresAt"-l."observedAt"<=interval '120 seconds'),false) THEN RETURN false; END IF;
  IF v_target."profileId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "QualityProfile" q WHERE q.id=v_target."profileId"
    AND q.id=p_scope#>>'{profile,id}' AND q.version=(p_scope#>>'{profile,version}')::integer) THEN RETURN false; END IF;
  IF p_birth THEN
    SELECT r.* INTO STRICT v_adoption FROM "MediaHandoffReceipt" r WHERE r.id=p_scope#>>'{adoption,receiptId}';
    SELECT p.* INTO STRICT v_plan FROM "MediaHandoffPlan" p WHERE p.id=v_adoption."planId";
    SELECT b.* INTO STRICT v_approval FROM "MigrationBundleReview" b WHERE b.id=v_plan."bundleReviewId";
    SELECT b.* INTO STRICT v_bundle FROM "MigrationBundle" b WHERE b.id=v_approval."bundleId";
    IF NOT COALESCE(v_plan.state='applied' AND v_adoption."recoveryEpoch"=v_runtime."recoveryEpoch"
      AND v_adoption."actorId"=p_scope#>>'{adoption,actorId}' AND v_plan."actorId"=v_adoption."actorId"
      AND v_adoption."planId"=p_scope#>>'{adoption,planId}' AND v_adoption."planHash"=p_scope#>>'{adoption,planHash}'
      AND v_plan."planHash"=v_adoption."planHash" AND v_adoption.selection->'scope'=v_plan.scope
      AND (p_scope#>>'{adoption,planRaw}')::jsonb=v_plan.plan
      AND encode(sha256(convert_to(p_scope#>>'{adoption,planRaw}','UTF8')),'hex')=v_plan."planHash"
      AND v_adoption.selection->'fileEvidence'=v_plan.plan->'files'
      AND ((v_adoption.selection->'schemaVersion'='2'::jsonb AND v_adoption.selection->'networkEvidence'=v_plan.plan->'network')
        OR (v_adoption.selection->'schemaVersion'='3'::jsonb
          AND (v_adoption.selection->'networkEvidence')-'plex'=(v_plan.plan->'network')-'plex'
          AND v_adoption.selection->'plexEdits' IS NOT NULL))
      AND v_plan.scope#>>'{request,purpose}'='migration' AND v_bundle.manifest->'schemaVersion'='2'::jsonb
      AND v_bundle.manifest->>'purpose'='initial_library' AND v_bundle."bundleHash"=v_bundle.manifest->>'bundleHash'
      AND v_approval."reportHash"=v_approval.report->>'reportHash' AND v_approval.report->>'bundleHash'=v_bundle."bundleHash"
      AND v_plan.scope#>>'{request,bundleReviewId}'=v_approval.id
      AND v_plan.scope#>>'{request,reportHash}'=v_approval."reportHash" AND v_plan.scope#>>'{request,bundleHash}'=v_bundle."bundleHash"
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_adoption.selection#>'{scope,targets}') AS a(value)
        WHERE a.value->>'mediaId'=v_media.id AND a.value->>'edition'=v_target.edition)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_adoption.selection#>'{scope,files}') AS a(value)
        WHERE a.value->>'assetId'=p_scope#>>'{adoption,assetId}' AND a.value->>'libraryKind'='movies'
          AND a.value->>'edition'=v_target.edition AND a.value->'mediaIds'=jsonb_build_array(v_media.id))
      AND (SELECT count(*)=1 FROM jsonb_array_elements(v_adoption.selection->'assets') AS a(value)
        WHERE a.value->>'id'=p_scope#>>'{adoption,assetId}' AND a.value=(p_scope#>>'{adoption,assetRaw}')::jsonb)
      AND encode(sha256(convert_to(p_scope#>>'{adoption,assetRaw}','UTF8')),'hex')=p_scope#>>'{adoption,bindingHash}'
      AND media_movie_subtitle_parent(p_scope->'publication',v_asset,p_scope->'scope'),false) THEN RETURN false; END IF;
    IF jsonb_array_length(p_scope->'blockers')=0 AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_approval.report->'entries') AS a(value)
    WHERE a.value#>>'{sourceRecord,kind}'='request'
      AND a.value#>'{sourceRecord,active}'='true'::jsonb
      AND ((a.value->'mediaIds') @> jsonb_build_array(v_media.id)
        OR media_movie_history_coordinates_v3(a.value->'sourceRecord',v_media.id,false))
      AND NOT EXISTS (SELECT 1 FROM "MigrationRecord" r JOIN "MigrationCapture" c ON c.id=r."captureId"
        WHERE c."manifestHash"=a.value->>'captureHash' AND r."provenanceKey"=a.value->>'provenanceKey'
          AND r."observationHash"=a.value->>'observationHash')) THEN RETURN false; END IF;
  END IF;
  IF (SELECT count(*) FROM "MediaUser")<>jsonb_array_length(p_scope->'householdRoster')
    OR (SELECT count(DISTINCT a.value->>'id') FROM jsonb_array_elements(p_scope->'householdRoster') AS a(value))<>jsonb_array_length(p_scope->'householdRoster')
    OR (SELECT count(DISTINCT a.value->>'id') FROM jsonb_array_elements(p_scope->'users') AS a(value))<>jsonb_array_length(p_scope->'users')
    OR jsonb_array_length(p_scope->'householdRoster')>100 THEN RETURN false; END IF;
  FOR v_subject IN SELECT a.value FROM jsonb_array_elements(p_scope->'householdRoster') AS a(value) LOOP
    IF NOT COALESCE(media_movie_history_subject_v3(v_subject),false) THEN RETURN false; END IF;
    IF v_subject->'applicableMediaIds'=jsonb_build_array(v_media.id) THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'users') AS a(value) WHERE a.value=v_subject) THEN RETURN false; END IF;
    ELSIF v_subject->'applicableMediaIds'='[]'::jsonb THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'excludedPairs') AS a(value)
        WHERE a.value->>'userId'=v_subject->>'id' AND a.value->>'mediaId'=v_media.id
          AND a.value->>'reason'='fresh_scope_denial_without_relevant_claim')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'users') AS a(value) WHERE a.value->>'id'=v_subject->>'id')
        OR EXISTS (SELECT 1 FROM "MediaRequest" r WHERE r."mediaId"=v_media.id AND r.edition=v_target.edition AND r."userId"=v_subject->>'id')
        OR EXISTS (SELECT 1 FROM "RetentionHold" h WHERE h."mediaId"=v_media.id AND h.edition=v_target.edition AND h."userId"=v_subject->>'id')
        OR EXISTS (SELECT 1 FROM "MigrationRecord" r JOIN LATERAL (
          SELECT b."userId" FROM "LegacyRequesterBinding" b WHERE b."captureId"=r."captureId"
            AND b."requesterSourceId"=r.payload->>'requesterSourceId' ORDER BY b.revision DESC LIMIT 1
          ) b ON true
          WHERE b."userId"=v_subject->>'id' AND r.kind='request' AND r.payload->'active'='true'::jsonb
            AND media_movie_history_coordinates_v3(r.payload,v_media.id,false))
        OR NOT EXISTS (SELECT 1 FROM "PlexIdentityMapping" m WHERE m."userId"=v_subject->>'id'
          AND m."serverMachineId"=p_scope#>>'{access,serverMachineId}' AND m."verifiedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
          AND m."verifiedAt">(clock_timestamp() AT TIME ZONE 'UTC')-interval '5 minutes'
          AND ((m.kind='account' AND m."homeUserId" IS NULL AND NOT m."plexRestricted") OR (m.kind='managed' AND m."homeUserId" IS NOT NULL))
          AND (NOT (m."permittedSectionIds" @> ARRAY[(p_scope#>>'{access,movieSectionId}')]::text[])
            OR NOT (m."permittedMediaKinds" @> ARRAY['movie']::text[]))) THEN RETURN false; END IF;
    ELSE RETURN false; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'users') AS a(value)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scope->'householdRoster') AS b(value) WHERE b.value=a.value)) THEN RETURN false; END IF;
  RETURN media_movie_history_definition_v3(p_scope) AND media_movie_history_inventory_v3(p_scope) AND media_movie_history_claims_v3(p_scope);
END;
$$;

CREATE FUNCTION media_movie_history_response_valid_v3(p_scope jsonb,p_response jsonb,p_actor text,p_user text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_actor "MediaUser"; v_user "MediaUser"; v_mapping "PlexIdentityMapping"; v_request "MediaRequest";
  v_choice "MovieEditionChoice"; v_keep "RetentionHold"; v_decl jsonb; v_subject jsonb;
BEGIN
  SELECT u.* INTO STRICT v_actor FROM "MediaUser" u WHERE u.id=p_actor;
  SELECT u.* INTO STRICT v_user FROM "MediaUser" u WHERE u.id=p_user;
  SELECT m.* INTO STRICT v_mapping FROM "PlexIdentityMapping" m WHERE m."userId"=p_user;
  SELECT a.value INTO STRICT v_subject FROM jsonb_array_elements(p_scope->'users') AS a(value) WHERE a.value->>'id'=p_user;
  v_decl:=p_response->'declaration';
  IF NOT COALESCE(p_response->'schemaVersion'='3'::jsonb AND p_response->'scope'=p_scope->'scope'
    AND p_response->'definition'=p_scope->'definition' AND p_response->'registryVersion'='1'::jsonb
    AND p_response->>'subjectUserId'=p_user AND p_response->'acknowledgeMissingHistory'='true'::jsonb
    AND p_response->'claimAcknowledgements'=v_subject->'claimAcknowledgements'
    AND p_response#>>'{authority,actorId}'=p_actor AND p_response#>>'{authority,subjectUserId}'=p_user
    AND p_response#>'{authority,actorVersion}'=to_jsonb(v_actor.version)
    AND p_response#>'{authority,mappingVersion}'=to_jsonb(v_mapping.version)
    AND NOT v_actor.restricted AND NOT v_user.restricted
    AND v_mapping."serverMachineId"=p_scope#>>'{access,serverMachineId}'
    AND v_mapping."verifiedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
    AND v_mapping."verifiedAt">(clock_timestamp() AT TIME ZONE 'UTC')-interval '5 minutes'
    AND v_mapping."permittedSectionIds" @> ARRAY[(p_scope#>>'{access,movieSectionId}')]::text[]
    AND v_mapping."permittedMediaKinds" @> ARRAY['movie']::text[]
    AND ((p_actor=p_user AND v_mapping.kind='account' AND NOT v_mapping."plexRestricted"
      AND p_response#>>'{authority,mode}'='self') OR (p_actor<>p_user AND v_actor.role='owner'
      AND v_mapping.kind='managed' AND v_mapping."homeUserId" IS NOT NULL AND p_response#>>'{authority,mode}'='managed_owner')),false)
  THEN RETURN false; END IF;
  IF v_decl->>'intent'='no_longer_request' THEN
    RETURN NOT EXISTS (SELECT 1 FROM "MediaRequest" r WHERE r."userId"=p_user AND r."mediaId"=p_scope#>>'{scope,mediaId}'
      AND r.edition=p_scope#>>'{scope,edition}' AND r.active AND NOT r.excluded);
  ELSIF v_decl->>'intent' NOT IN ('request','keep') THEN RETURN false; END IF;
  SELECT r.* INTO STRICT v_request FROM "MediaRequest" r WHERE r.id=v_decl#>>'{currentChoice,requestId}';
  SELECT c.* INTO STRICT v_choice FROM "MovieEditionChoice" c WHERE c.id=v_decl#>>'{currentChoice,choiceId}';
  IF NOT COALESCE(v_request."userId"=p_user AND v_request."mediaId"=p_scope#>>'{scope,mediaId}'
    AND v_request.edition=p_scope#>>'{scope,edition}' AND v_request.active AND NOT v_request.excluded AND v_request.direct
    AND v_request.version=(v_decl#>>'{currentChoice,requestVersion}')::integer
    AND v_request."movieEditionChoiceId"=v_choice.id AND v_choice."requestId"=v_request.id
    AND v_choice."subjectUserId"=p_user AND v_choice."rootMediaId"=v_request."mediaId" AND v_choice.edition=v_request.edition
    AND v_request."movieEditionChoiceRevision"=v_choice."choiceRevision"
    AND v_choice."choiceRevision"=(v_decl#>>'{currentChoice,choiceRevision}')::integer
    AND to_jsonb(v_request."subtitleLanguages")=v_decl#>'{currentChoice,subtitleLanguages}',false) THEN RETURN false; END IF;
  IF v_decl->>'intent'='keep' THEN
    SELECT h.* INTO STRICT v_keep FROM "RetentionHold" h WHERE h.id=v_decl#>>'{currentKeep,id}';
    IF NOT COALESCE(v_keep."mediaId"=v_request."mediaId" AND v_keep.edition=v_request.edition AND v_keep."userId"=p_user
      AND v_keep."isPin"=(v_decl#>>'{currentKeep,isPin}')::boolean
      AND v_keep.until IS NOT DISTINCT FROM ((v_decl#>>'{currentKeep,until}')::timestamptz AT TIME ZONE 'UTC')
      AND (v_keep."isPin" OR v_keep.until>(clock_timestamp() AT TIME ZONE 'UTC')),false) THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION media_movie_history_capture_v3() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_review "RecoveryReview";
BEGIN
  IF NEW.scope->'schemaVersion' IS DISTINCT FROM '3'::jsonb THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT r.* INTO STRICT v_review FROM "RecoveryReview" r WHERE r.id=NEW.id;
  IF NOT COALESCE(v_review.state='awaiting_responses' AND v_review.version=0 AND v_review."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
    AND v_review."expiresAt"<=v_review."createdAt"+interval '7 days 1 minute'
    AND v_review."recoveryEpoch"=(v_review.scope->>'recoveryEpoch')::integer
    AND v_review."runtimeVersion"=(v_review.scope->>'runtimeVersion')::integer
    AND media_movie_history_capture_hash_v3(v_review) AND media_movie_history_scope_current_v3(v_review.scope,false,true)
    AND EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=v_review."actorId" AND u.role='owner' AND NOT u.restricted)
    AND EXISTS (SELECT 1 FROM "ApplicationEvent" e WHERE e."dedupeKey"='movie-history-review-v3:'||v_review.id
      AND e.xmin::text::bigint=txid_current()%4294967296),false)
  THEN RAISE EXCEPTION 'Movie history review requires its exact current cut, physical source, household and canonical capture'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "MovieHistoryReview_capture_v3" AFTER INSERT ON "RecoveryReview"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_history_capture_v3();

CREATE FUNCTION media_movie_history_response_v3() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_review "RecoveryReview";
BEGIN
  SELECT r.* INTO STRICT v_review FROM "RecoveryReview" r WHERE r.id=NEW."reviewId";
  IF v_review.scope->'schemaVersion' IS DISTINCT FROM '3'::jsonb THEN
    IF NEW.response->'schemaVersion'='3'::jsonb THEN RAISE EXCEPTION 'Scoped movie declaration requires a v3 review'; END IF;
    RETURN NEW;
  END IF;
  PERFORM media_plex_assert_deadline();
  IF NOT COALESCE(v_review.state='awaiting_responses' AND v_review."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
    AND NEW.response->>'scopeHash'=v_review."scopeHash" AND media_movie_history_capture_hash_v3(v_review)
    AND media_movie_history_scope_current_v3(v_review.scope,false,false)
    AND media_movie_history_response_valid_v3(v_review.scope,NEW.response,NEW."actorId",NEW."userId"),false)
  THEN RAISE EXCEPTION 'Movie history response requires unchanged actual cut choice, Keep and subject authority'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "MovieHistoryResponse_birth_v3" AFTER INSERT ON "RecoveryResponse"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_history_response_v3();

CREATE FUNCTION media_movie_history_release_v3() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_review "RecoveryReview"; v_receipt "RecoveryReleaseReceipt"; v_event "ApplicationEvent";
  v_hold "RecoveryHold"; v_response "RecoveryResponse"; v_responses jsonb; v_claim jsonb; v_operation "Operation"; v_outbox "OutboxCommand";
BEGIN
  SELECT r.* INTO STRICT v_review FROM "RecoveryReview" r WHERE r.id=NEW."reviewId";
  IF v_review.scope->'schemaVersion' IS DISTINCT FROM '3'::jsonb THEN
    IF NEW."claimAccounting"->'schemaVersion'='3'::jsonb THEN RAISE EXCEPTION 'Scoped movie accounting requires its literal v3 review'; END IF;
    RETURN NEW;
  END IF;
  PERFORM media_plex_assert_deadline();
  SELECT r.* INTO STRICT v_receipt FROM "RecoveryReleaseReceipt" r WHERE r.id=NEW.id;
  SELECT e.* INTO STRICT v_event FROM "ApplicationEvent" e WHERE e."dedupeKey"='movie-history-release-v3:'||v_review.id;
  SELECT h.* INTO STRICT v_hold FROM "RecoveryHold" h WHERE h."mediaId"=v_review.scope#>>'{scope,mediaId}' AND h.edition=v_review.scope#>>'{scope,edition}';
  SELECT o.* INTO STRICT v_operation FROM "Operation" o WHERE o.id=v_event.payload->>'operationId';
  SELECT o.* INTO STRICT v_outbox FROM "OutboxCommand" o WHERE o."operationId"=v_operation.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',r."userId",'actorId',r."actorId",'response',r.response) ORDER BY r."userId"),'[]'::jsonb)
    INTO v_responses FROM "RecoveryResponse" r WHERE r."reviewId"=v_review.id;
  IF NOT COALESCE(v_review.state='released' AND v_review.version=jsonb_array_length(v_responses)+1
    AND v_review."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') AND jsonb_array_length(v_review.scope->'blockers')=0
    AND jsonb_array_length(v_responses)=jsonb_array_length(v_review.scope->'users')
    AND media_movie_history_capture_hash_v3(v_review) AND media_movie_history_scope_current_v3(v_review.scope,true,false)
    AND v_receipt."recoveryEpoch"=v_review."recoveryEpoch" AND v_receipt."scopeHash"=v_review."scopeHash"
    AND v_receipt."releasedHoldIds"=ARRAY[v_review.scope#>>'{scope,mediaId}']::text[]
    AND v_receipt."claimAccounting"->'schemaVersion'='3'::jsonb
    AND v_receipt."claimAccounting"->'scope'=v_review.scope->'scope'
    AND v_receipt."claimAccounting"-ARRAY['schemaVersion','scope','claims']='{}'::jsonb
    AND jsonb_array_length(v_receipt."claimAccounting"->'claims')=jsonb_array_length(v_review.scope->'legacyClaims')
    AND v_receipt."claimAccounting"->'claims'=(SELECT COALESCE(jsonb_agg(a.value-ARRAY['latestBindingRevision','outsideMediaIds','sourceScope','seasons'] ORDER BY a.ordinality),'[]'::jsonb)
      FROM jsonb_array_elements(v_review.scope->'legacyClaims') WITH ORDINALITY AS a(value,ordinality))
    AND v_hold."releasedById"=v_receipt."actorId" AND v_hold."releaseEvidence"->'scope'=v_review.scope->'scope'
    AND v_hold."releaseEvidence"->'schemaVersion'='3'::jsonb AND v_hold."releaseEvidence"->>'reviewId'=v_review.id
    AND v_hold."releaseEvidence"->>'receiptId'=v_receipt.id AND v_hold."releaseEvidence"->>'scopeHash'=v_receipt."scopeHash"
    AND v_hold."releaseEvidence"->>'responseHash'=v_receipt."responseHash"
    AND v_hold."releaseEvidence"->'confirmHouseholdBaseline'='true'::jsonb
    AND v_hold."releaseEvidence"->'confirmExistingPins'='true'::jsonb AND v_hold."releaseEvidence"->'acknowledgeMissingHistory'='true'::jsonb
    AND v_event.kind='movie_history_reconciled_v3' AND v_event."actorId"=v_receipt."actorId"
    AND v_event.payload->>'receiptId'=v_receipt.id AND v_event.payload->'scope'=v_review.scope->'scope'
    AND v_event.payload->>'scopeHash'=v_receipt."scopeHash" AND v_event.payload->>'responseHash'=v_receipt."responseHash"
    AND (v_event.payload->>'responsesRaw')::jsonb=v_responses
    AND encode(sha256(convert_to(v_event.payload->>'responsesRaw','UTF8')),'hex')=v_receipt."responseHash"
    AND v_operation.kind='retain_movie_edition_v4' AND v_operation."targetId"=v_review.scope#>>'{scope,mediaId}'
    AND v_operation."idempotencyKey"='movie-history-release:'||v_review.id AND v_operation."userId"=v_receipt."actorId"
    AND v_operation.status='queued' AND v_operation.result IS NULL
    AND v_operation.payload->>'operationId'=v_operation.id AND v_operation.payload->>'kind'=v_operation.kind
    AND v_operation.payload->>'mediaId'=v_operation."targetId" AND v_operation.payload->'recoveryEpoch'=to_jsonb(v_review."recoveryEpoch")
    AND v_operation.payload->'scope'=v_review.scope->'scope' AND v_operation.payload->'schemaVersion'='4'::jsonb
    AND (v_operation.payload->>'generation')::integer=(v_review.scope#>>'{target,generation}')::integer+1
    AND v_outbox.kind=v_operation.kind AND v_outbox.payload=v_operation.payload AND v_outbox."dispatchedAt" IS NULL
    AND v_outbox.attempts=0 AND v_outbox."availableAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
    AND EXISTS (SELECT 1 FROM "RecoveryReleaseReceipt" r WHERE r.id=v_receipt.id AND r.xmin::text::bigint=txid_current()%4294967296)
    AND EXISTS (SELECT 1 FROM "ApplicationEvent" e WHERE e.id=v_event.id AND e.xmin::text::bigint=txid_current()%4294967296)
    AND EXISTS (SELECT 1 FROM "Operation" o WHERE o.id=v_operation.id AND o.xmin::text::bigint=txid_current()%4294967296)
    AND EXISTS (SELECT 1 FROM "OutboxCommand" o WHERE o.id=v_outbox.id AND o.xmin::text::bigint=txid_current()%4294967296)
    AND EXISTS (SELECT 1 FROM "MediaItem" m WHERE m.id=v_review.scope#>>'{scope,mediaId}' AND m.xmin::text::bigint=txid_current()%4294967296)
    AND EXISTS (SELECT 1 FROM "MediaIntent" t WHERE t."mediaId"=v_review.scope#>>'{scope,mediaId}' AND t.edition=v_review.scope#>>'{scope,edition}' AND t.xmin::text::bigint=txid_current()%4294967296)
    AND EXISTS (SELECT 1 FROM "RecoveryHold" h WHERE h."mediaId"=v_hold."mediaId" AND h.edition=v_hold.edition AND h.xmin::text::bigint=txid_current()%4294967296)
    AND EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=v_receipt."actorId" AND u.role='owner' AND NOT u.restricted),false)
  THEN RAISE EXCEPTION 'Movie history release requires exact unchanged household declarations and same-transaction selected-cut closure'; END IF;
  FOR v_response IN SELECT r.* FROM "RecoveryResponse" r WHERE r."reviewId"=v_review.id LOOP
    IF NOT COALESCE(media_movie_history_response_valid_v3(v_review.scope,v_response.response,v_response."actorId",v_response."userId"),false)
    THEN RAISE EXCEPTION 'Movie history declaration no longer has current selected-cut authority'; END IF;
  END LOOP;
  FOR v_claim IN SELECT a.value FROM jsonb_array_elements(v_receipt."claimAccounting"->'claims') AS a(value) LOOP
    IF v_claim->'mediaIds'<>jsonb_build_array(v_review.scope#>>'{scope,mediaId}') OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_review.scope->'legacyClaims') AS a(value)
      WHERE a.value-ARRAY['latestBindingRevision','outsideMediaIds','sourceScope','seasons']=v_claim)
    THEN RAISE EXCEPTION 'Movie history accounting must bind each exact original cut claim'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "MovieHistoryRelease_closure_v3" AFTER INSERT ON "RecoveryReleaseReceipt"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_history_release_v3();

CREATE FUNCTION media_movie_history_hold_v3() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."releasedAt" IS NULL AND NEW."releasedAt" IS NOT NULL
    AND ((OLD.edition<>'default' AND OLD.reason IN ('migration_household_intent_review_required','legacy_claim_reconciliation_required')
      AND EXISTS (SELECT 1 FROM "MediaItem" m WHERE m.id=OLD."mediaId" AND m.kind='movie')) OR NEW."releaseEvidence"->'schemaVersion'='3'::jsonb) THEN
    PERFORM media_plex_assert_deadline();
    IF NOT COALESCE(NEW."releaseEvidence"->'schemaVersion'='3'::jsonb
      AND NEW."releaseEvidence"#>>'{scope,mediaId}'=OLD."mediaId" AND NEW."releaseEvidence"#>>'{scope,rootMediaId}'=OLD."mediaId"
      AND NEW."releaseEvidence"#>>'{scope,edition}'=OLD.edition AND NEW.version=OLD.version+1
      AND NEW."recoveryEpoch"=OLD."recoveryEpoch" AND NEW.reason=OLD.reason
      AND EXISTS (SELECT 1 FROM "RecoveryReleaseReceipt" r JOIN "RecoveryReview" v ON v.id=r."reviewId"
        WHERE r.id=NEW."releaseEvidence"->>'receiptId' AND v.id=NEW."releaseEvidence"->>'reviewId'
          AND v.scope->'schemaVersion'='3'::jsonb AND v.scope->'scope'=NEW."releaseEvidence"->'scope'
          AND r."scopeHash"=v."scopeHash" AND r."actorId"=NEW."releasedById"
          AND r.xmin::text::bigint=txid_current()%4294967296),false)
    THEN RAISE EXCEPTION 'Named movie history hold requires its actual same-transaction exact-cut v3 release'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MovieHistoryHold_release_v3" BEFORE UPDATE ON "RecoveryHold"
  FOR EACH ROW EXECUTE FUNCTION media_movie_history_hold_v3();

CREATE FUNCTION media_movie_history_immutable_v3() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ApplicationEvent' THEN
    IF OLD.kind IN ('movie_history_review_captured_v3','movie_history_reconciled_v3') THEN
      RAISE EXCEPTION 'Movie history scope and release byte proofs are immutable';
    END IF;
    IF TG_OP='UPDATE' AND NEW.kind IN ('movie_history_review_captured_v3','movie_history_reconciled_v3') THEN
      RAISE EXCEPTION 'Movie history byte proofs require their actual inserted birth';
    END IF;
  ELSIF OLD.scope->'schemaVersion'='3'::jsonb THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Scoped movie history review is immutable'; END IF;
    IF NEW.state NOT IN ('awaiting_responses','released') OR OLD.state='released' OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'Scoped movie history review requires its next response or terminal release';
    END IF;
    IF NEW.state='released' AND NOT EXISTS (SELECT 1 FROM "RecoveryReleaseReceipt" r WHERE r."reviewId"=NEW.id AND r.xmin::text::bigint=txid_current()%4294967296) THEN
      RAISE EXCEPTION 'Movie history terminal review requires its real same-transaction release receipt';
    END IF;
    IF NEW.state='awaiting_responses' AND NOT EXISTS (SELECT 1 FROM "RecoveryResponse" r WHERE r."reviewId"=NEW.id AND r.xmin::text::bigint=txid_current()%4294967296) THEN
      RAISE EXCEPTION 'Movie history response version requires its actual same-transaction declaration';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MovieHistoryReview_state_v3" BEFORE UPDATE OR DELETE ON "RecoveryReview"
  FOR EACH ROW EXECUTE FUNCTION media_movie_history_immutable_v3();
CREATE TRIGGER "MovieHistoryEvent_immutable_v3" BEFORE UPDATE OR DELETE ON "ApplicationEvent"
  FOR EACH ROW EXECUTE FUNCTION media_movie_history_immutable_v3();

-- This reserved producer key binds the queued command without adding reads to old command updates.
CREATE FUNCTION media_movie_history_command_v3() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."idempotencyKey" LIKE 'movie-history-release:%' THEN
    IF TG_OP='DELETE' OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload,NEW."createdAt")
      IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload,OLD."createdAt")
    THEN RAISE EXCEPTION 'Movie history release command source is immutable'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MovieHistoryCommand_immutable_v3" BEFORE UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_movie_history_command_v3();
