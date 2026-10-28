-- Additive scoped receipt. The historical quarantinePlexReceipt trigger is unchanged.
-- Literal hashes use the application serializer; SQL validates their relational parents.
CREATE FUNCTION media_movie_quarantine_receipt_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; selected JSONB; decision JSONB; physical JSONB; binding JSONB; entry JSONB;
  d "RetentionDecision"; p "RetentionPlexProjection"; a "LibraryAsset";
  target "MediaIntent"; runtime "MediaRuntimeState"; association "PlexAssociationEvidence";
  subtitle "SubtitleAsset"; sidecar JSONB;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'movieQuarantinePlexReceiptV2' THEN
      RAISE EXCEPTION 'Committed movie quarantine receipt is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'movieQuarantinePlexReceiptV2' THEN
    IF NEW.result->'movieQuarantinePlexReceiptV2' IS DISTINCT FROM OLD.result->'movieQuarantinePlexReceiptV2'
      OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload)
        IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload) THEN
      RAISE EXCEPTION 'Committed movie quarantine receipt or command is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'movieQuarantinePlexReceiptV2') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  proof := NEW.result->'movieQuarantinePlexReceiptV2';
  selected := proof->'scope';
  IF jsonb_typeof(proof) IS DISTINCT FROM 'object' OR NOT COALESCE(
    proof ?& ARRAY['schemaVersion','scope','operationId','decisionId','recoveryEpoch','manifestHash','decisions','groups','bindings','committedAt']
    AND proof - ARRAY['schemaVersion','scope','operationId','decisionId','recoveryEpoch','manifestHash','decisions','groups','bindings','committedAt']='{}'::jsonb
    AND proof->'schemaVersion'='2'::jsonb AND proof->>'operationId'=NEW.id
    AND jsonb_typeof(selected)='object' AND selected ?& ARRAY['rootMediaId','mediaId','edition']
    AND selected - ARRAY['rootMediaId','mediaId','edition']='{}'::jsonb
    AND selected->>'rootMediaId'=selected->>'mediaId' AND selected->>'mediaId'=NEW."targetId"
    AND selected->>'edition' IN ('default','theatrical_cut','directors_cut','extended_cut','final_cut','unrated_cut','uncut_version')
    AND NEW.kind='retain_movie_edition_v4' AND NEW.payload->>'kind'=NEW.kind
    AND NEW.payload->>'operationId'=NEW.id AND NEW.payload->>'mediaId'=NEW."targetId"
    AND NEW.payload->'scope'=selected AND NEW.payload->'schemaVersion'='4'::jsonb
    AND jsonb_typeof(NEW.payload->'generation')='number' AND NEW.payload->>'generation' ~ '^(0|[1-9][0-9]*)$'
    AND jsonb_typeof(proof->'recoveryEpoch')='number' AND proof->>'recoveryEpoch' ~ '^(0|[1-9][0-9]*)$'
    AND proof->'recoveryEpoch'=NEW.payload->'recoveryEpoch'
    AND proof->>'decisionId' ~ '^[a-f0-9-]{36}$' AND proof->>'manifestHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(proof->'committedAt')='string'
    AND proof->>'committedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
    AND jsonb_typeof(proof->'decisions')='array' AND jsonb_typeof(proof->'groups')='array'
    AND jsonb_typeof(proof->'bindings')='array',false) THEN
    RAISE EXCEPTION 'Movie quarantine receipt shape or command changed';
  END IF;
  IF jsonb_array_length(proof->'decisions')<>1 OR jsonb_array_length(proof->'groups')<>1
    OR jsonb_array_length(proof->'bindings')<>1 THEN
    RAISE EXCEPTION 'Movie quarantine requires one complete selected movie';
  END IF;
  decision := proof #> '{decisions,0}'; physical := proof #> '{groups,0}'; binding := proof #> '{bindings,0}';
  IF jsonb_typeof(decision) IS DISTINCT FROM 'object' OR NOT COALESCE(
    decision ?& ARRAY['decisionId','mediaId','beforeVersion','quarantinedVersion','projectionHash']
    AND decision - ARRAY['decisionId','mediaId','beforeVersion','quarantinedVersion','projectionHash']='{}'::jsonb
    AND decision->>'decisionId'=proof->>'decisionId' AND decision->>'mediaId'=selected->>'mediaId'
    AND decision->>'projectionHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(decision->'beforeVersion')='number' AND decision->>'beforeVersion' ~ '^(0|[1-9][0-9]*)$'
    AND jsonb_typeof(decision->'quarantinedVersion')='number' AND decision->>'quarantinedVersion' ~ '^[1-9][0-9]*$',false) THEN
    RAISE EXCEPTION 'Movie quarantine decision shape changed';
  END IF;
  SELECT * INTO STRICT d FROM "RetentionDecision" WHERE id=proof->>'decisionId';
  SELECT * INTO STRICT p FROM "RetentionPlexProjection" WHERE "decisionId"=d.id;
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=selected->>'mediaId' AND edition=selected->>'edition';
  SELECT * INTO STRICT runtime FROM "MediaRuntimeState" WHERE id='singleton';
  IF NOT COALESCE(d.state='quarantined' AND d."mediaId"=selected->>'mediaId' AND d.edition=selected->>'edition'
    AND target."editionRootId"=selected->>'rootMediaId' AND target.generation=d.generation
    AND to_jsonb(d.generation)=NEW.payload->'generation'
    AND to_jsonb(d.version)=decision->'quarantinedVersion'
    AND (decision->>'quarantinedVersion')::bigint=(decision->>'beforeVersion')::bigint+1
    AND p."projectionHash"=decision->>'projectionHash' AND p.projection->'schemaVersion'='1'::jsonb
    AND p.projection->>'decisionId'=d.id AND p.projection->'bindings'=proof->'bindings'
    AND d.evidence->'recoveryEpoch'=proof->'recoveryEpoch'
    AND to_jsonb(target."automationEpoch")=proof->'recoveryEpoch'
    AND to_jsonb(runtime."recoveryEpoch")=proof->'recoveryEpoch' AND runtime.mode='active' AND runtime."ownershipConfirmed"
    AND d."quarantinedAt"=(proof->>'committedAt')::timestamptz
    AND d."quarantinedAt">=date_trunc('milliseconds',transaction_timestamp()) AND d."quarantinedAt"<=clock_timestamp()
    AND d."purgeAfter"=d."quarantinedAt"+interval '7 days'
    AND EXISTS (SELECT 1 FROM "MediaItem" WHERE id=selected->>'mediaId' AND kind='movie')
    AND EXISTS (SELECT 1 FROM "RetentionDecision" WHERE id=d.id AND xmin::text=(txid_current() % 4294967296)::text),false) THEN
    RAISE EXCEPTION 'Movie quarantine decision is not its same-transaction physical commit';
  END IF;
  IF jsonb_typeof(d.manifest) IS DISTINCT FROM 'object' OR d.manifest - 'assets'<>'{}'::jsonb
    OR jsonb_typeof(d.manifest->'assets') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Movie quarantine manifest is missing';
  END IF;
  IF jsonb_array_length(d.manifest->'assets')<>1 THEN RAISE EXCEPTION 'Movie quarantine manifest is incomplete'; END IF;
  entry := d.manifest #> '{assets,0}';
  IF jsonb_typeof(physical) IS DISTINCT FROM 'object' OR NOT COALESCE(
    physical ?& ARRAY['assetId','assetVersion','checksum','sizeBytes','canonicalPath','ownershipEpoch','canonicalRootId','edition','coverage','coverageHash']
    AND physical - ARRAY['assetId','assetVersion','checksum','sizeBytes','canonicalPath','ownershipEpoch','canonicalRootId','edition','coverage','coverageHash']='{}'::jsonb
    AND jsonb_typeof(physical->'assetVersion')='number' AND physical->>'assetVersion' ~ '^(0|[1-9][0-9]*)$'
    AND physical->>'checksum' ~ '^[a-f0-9]{64}$' AND physical->>'coverageHash' ~ '^[a-f0-9]{64}$'
    AND physical->'ownershipEpoch'=proof->'recoveryEpoch' AND physical->>'canonicalRootId'=selected->>'rootMediaId'
    AND physical->>'edition'=selected->>'edition'
    AND physical->'coverage'=jsonb_build_array(selected-'rootMediaId')
    AND jsonb_typeof(entry)='object' AND entry->>'assetId'=physical->>'assetId'
    AND entry->'assetVersion'=physical->'assetVersion' AND entry->>'checksum'=physical->>'checksum'
    AND entry->>'libraryKind'='movies' AND entry->'mediaIds'=jsonb_build_array(selected->>'mediaId')
    AND entry->'generations'=jsonb_build_object(selected->>'mediaId',d.generation)
    AND jsonb_typeof(entry->'sidecars')='array',false) THEN
    RAISE EXCEPTION 'Movie quarantine physical group or manifest scope changed';
  END IF;
  SELECT * INTO STRICT a FROM "LibraryAsset" WHERE id=physical->>'assetId';
  IF NOT COALESCE(a.state='quarantined' AND a.owned AND a.edition=selected->>'edition'
    AND a."editionRootId"=selected->>'rootMediaId' AND a.checksum=physical->>'checksum'
    AND to_jsonb(a.version)=to_jsonb((physical->>'assetVersion')::integer+1)
    AND to_jsonb(a."ownershipEpoch")=proof->'recoveryEpoch' AND a."sizeBytes"::text=physical->>'sizeBytes'
    AND a.path=physical->>'canonicalPath' AND a.path='/data/movies/' || (entry->>'libraryPath')
    AND EXISTS (SELECT 1 FROM "LibraryAsset" WHERE id=a.id AND xmin::text=(txid_current() % 4294967296)::text)
    AND (SELECT jsonb_agg(jsonb_build_object('mediaId',"mediaId",'edition',edition) ORDER BY "mediaId",edition)
      FROM "AssetCoverage" WHERE "assetId"=a.id AND current)=physical->'coverage',false) THEN
    RAISE EXCEPTION 'Movie quarantine asset is not its complete same-transaction physical commit';
  END IF;
  IF jsonb_typeof(binding) IS DISTINCT FROM 'object' OR NOT COALESCE(
    binding ?& ARRAY['scope','evidenceId','associationHash','revision']
    AND binding - ARRAY['scope','evidenceId','associationHash','revision']='{}'::jsonb
    AND binding->'scope'=selected-'rootMediaId' AND binding->>'associationHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(binding->'revision')='number' AND binding->>'revision' ~ '^[1-9][0-9]*$',false) THEN
    RAISE EXCEPTION 'Movie quarantine binding shape changed';
  END IF;
  SELECT * INTO STRICT association FROM "PlexAssociationEvidence" WHERE id=binding->>'evidenceId';
  IF NOT COALESCE(association."associationHash"=binding->>'associationHash'
    AND association."mediaId"=d."mediaId" AND association.edition=d.edition AND association."assetId"=a.id
    AND association.evidence->'schemaVersion'='2'::jsonb AND association.evidence->>'kind'='movie'
    AND association.evidence->'scope'=binding->'scope' AND association.evidence->'group'=physical
    AND EXISTS (SELECT 1 FROM "PlexBindingCurrent" c WHERE c."mediaId"=d."mediaId" AND c.edition=d.edition
      AND c."evidenceId"=association.id AND c."associationHash"=association."associationHash" AND to_jsonb(c.revision)=binding->'revision')
    AND EXISTS (SELECT 1 FROM "PlexClaimGroup" g WHERE g."serverMachineId"=association."serverMachineId"
      AND g."group"=physical AND p.projection->'groupHashes'=jsonb_build_array(g."groupHash")),false) THEN
    RAISE EXCEPTION 'Movie quarantine association is not the captured current physical group';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(entry->'sidecars')) <>
    (SELECT count(DISTINCT value->>'subtitleId') FROM jsonb_array_elements(entry->'sidecars')) THEN
    RAISE EXCEPTION 'Movie quarantine sidecars are duplicated';
  END IF;
  FOR sidecar IN SELECT value FROM jsonb_array_elements(entry->'sidecars') LOOP
    SELECT * INTO STRICT subtitle FROM "SubtitleAsset" WHERE id=sidecar->>'subtitleId';
    IF NOT COALESCE(subtitle."assetId"=a.id AND subtitle.state='quarantined' AND subtitle."storageKind"='sidecar'
      AND subtitle.path='/data/movies/' || (sidecar->>'libraryPath') AND subtitle.checksum=sidecar->>'checksum'
      AND subtitle."videoVersion"=a.version AND subtitle."videoChecksum"=a.checksum
      AND subtitle."ownershipEpoch"=a."ownershipEpoch"
      AND EXISTS (SELECT 1 FROM "SubtitleAsset" WHERE id=subtitle.id AND xmin::text=(txid_current() % 4294967296)::text),false) THEN
      RAISE EXCEPTION 'Movie quarantine sidecar is not its same-transaction video binding';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s."assetId"=a.id AND s."storageKind"='sidecar' AND s.state IN ('installed','quarantined')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(entry->'sidecars') value WHERE value->>'subtitleId'=s.id)) THEN
    RAISE EXCEPTION 'Movie quarantine omitted owned sidecars';
  END IF;
  IF EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s."assetId"=a.id AND s."storageKind"='embedded'
    AND s.state IN ('installed','quarantined') AND NOT COALESCE(s.state='quarantined'
      AND s."videoVersion"=a.version AND s."videoChecksum"=a.checksum AND s."ownershipEpoch"=a."ownershipEpoch"
      AND s."streamIndex" IS NOT NULL AND s.codec IS NOT NULL
      AND s.xmin::text=(txid_current() % 4294967296)::text,false)) THEN
    RAISE EXCEPTION 'Movie quarantine embedded caption binding changed';
  END IF;
  IF EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s."assetId"=a.id AND s.state IN ('installed','quarantined')
    AND s."storageKind" NOT IN ('sidecar','embedded')) THEN
    RAISE EXCEPTION 'Movie quarantine contains unowned caption storage';
  END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_quarantine_receipt_v2 BEFORE INSERT OR UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_movie_quarantine_receipt_v2();
