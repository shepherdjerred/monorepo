-- Scoped restore is an additive physical successor; original owner/publication/quarantine records stay literal.
CREATE FUNCTION media_movie_restore_caption_snapshot(s "SubtitleAsset") RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',s.id,'assetId',s."assetId",'version',s.version,'ownershipEpoch',s."ownershipEpoch",
    'state',s.state,'qualityStatus',s."qualityStatus",'storageKind',s."storageKind",
    'language',s.language,'providerId',s."providerId",'path',s.path,'checksum',s.checksum,
    'videoChecksum',s."videoChecksum",'videoVersion',s."videoVersion",'forced',s.forced,
    'hearingImpaired',s."hearingImpaired",'streamIndex',s."streamIndex",'codec',s.codec,
    'provenance',s.provenance,'matchingEvidence',s."matchingEvidence",
    'contentChecksum',CASE WHEN s.content IS NULL THEN NULL ELSE encode(sha256(s.content),'hex') END);
$$;

CREATE FUNCTION media_movie_restore_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE envelope jsonb; proof jsonb; selected jsonb; source jsonb; physical jsonb; before_asset jsonb; after_asset jsonb;
  entry jsonb; original jsonb; restored jsonb; file jsonb; journal jsonb; descriptor jsonb;
  parent "Operation"; decision "RetentionDecision"; asset "LibraryAsset";
  target "MediaIntent"; runtime "MediaRuntimeState"; subtitle "SubtitleAsset";
  snapshots jsonb; caption_ids text[]; operation_id text; participant_count integer;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'movieRestoreReceiptV1' THEN RAISE EXCEPTION 'Committed movie restore receipt is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'movieRestoreReceiptV1' THEN
    IF NEW.result->'movieRestoreReceiptV1' IS DISTINCT FROM OLD.result->'movieRestoreReceiptV1'
      OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload)
        IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
    THEN RAISE EXCEPTION 'Committed movie restore receipt or command is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'movieRestoreReceiptV1') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope:=NEW.result->'movieRestoreReceiptV1'; proof:=envelope->'receipt'; selected:=proof->'scope';
  IF NOT COALESCE(jsonb_typeof(envelope)='object' AND envelope ?& ARRAY['receipt','receiptHash']
    AND envelope-ARRAY['receipt','receiptHash']='{}'::jsonb AND envelope->>'receiptHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(proof)='object'
    AND proof ?& ARRAY['schemaVersion','scope','input','command','quarantine','manifest','before','after','participants','journals','observedAt','sdkExpiresAt','expiresAt','committedAt']
    AND proof-ARRAY['schemaVersion','scope','input','command','quarantine','manifest','before','after','participants','journals','observedAt','sdkExpiresAt','expiresAt','committedAt']='{}'::jsonb
    AND proof->'schemaVersion'='1'::jsonb AND NEW.kind='restore_movie_edition_v4'
    AND proof #>> '{command,kind}'=NEW.kind AND proof #>> '{command,targetId}'=NEW."targetId"
    AND (proof #>> '{command,userId}') IS NOT DISTINCT FROM NEW."userId"
    AND proof #>> '{command,payloadHash}' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(proof->'command')='object'
    AND (proof->'command') ?& ARRAY['kind','targetId','userId','payloadHash']
    AND (proof->'command')-ARRAY['kind','targetId','userId','payloadHash']='{}'::jsonb
    AND jsonb_typeof(proof->'quarantine')='object'
    AND (proof->'quarantine') ?& ARRAY['operationId','receiptHash','decisionId','manifestHash']
    AND (proof->'quarantine')-ARRAY['operationId','receiptHash','decisionId','manifestHash']='{}'::jsonb
    AND jsonb_typeof(proof->'input')='object'
    AND (proof->'input') ?& ARRAY['schemaVersion','operationId','mediaId','generation','scope']
    AND (proof->'input')-ARRAY['schemaVersion','operationId','mediaId','generation','scope']='{}'::jsonb
    AND selected ?& ARRAY['mediaId','rootMediaId','edition'] AND selected-ARRAY['mediaId','rootMediaId','edition']='{}'::jsonb
    AND selected->>'mediaId'=NEW."targetId" AND selected->>'rootMediaId'=NEW."targetId"
    AND selected->>'edition' IN ('default','theatrical_cut','directors_cut','extended_cut','final_cut','unrated_cut','uncut_version')
    AND proof #> '{input,scope}'=selected AND proof #>> '{input,operationId}'=NEW.id
    AND proof #>> '{input,mediaId}'=NEW."targetId" AND proof #> '{input,schemaVersion}'='4'::jsonb
    AND proof->'input'=jsonb_build_object('schemaVersion',NEW.payload->'schemaVersion','operationId',NEW.id,
      'mediaId',NEW.payload->'mediaId','generation',NEW.payload->'generation','scope',NEW.payload->'scope')
    AND NEW.payload->>'operationId'=NEW.id AND NEW.payload->>'kind'=NEW.kind
    AND NEW.payload->'scope'=selected AND NEW.payload->'schemaVersion'='4'::jsonb
    AND jsonb_typeof(NEW.payload->'generation')='number' AND NEW.payload->>'generation' ~ '^(0|[1-9][0-9]*)$'
    AND jsonb_typeof(proof->'participants')='array' AND jsonb_typeof(proof->'journals')='array'
    AND (proof->>'committedAt')::timestamptz >= (proof->>'observedAt')::timestamptz
    AND (proof->>'committedAt')::timestamptz < (proof->>'expiresAt')::timestamptz
    AND (proof->>'expiresAt')::timestamptz <= (proof->>'sdkExpiresAt')::timestamptz
    AND (proof->>'expiresAt')::timestamptz <= (proof->>'observedAt')::timestamptz+interval '60 seconds'
    AND (proof->>'committedAt')::timestamptz >= date_trunc('milliseconds',transaction_timestamp())
    AND (proof->>'committedAt')::timestamptz <= clock_timestamp(),false)
  THEN RAISE EXCEPTION 'Movie restore receipt shape, command or original clock changed'; END IF;
  SELECT * INTO STRICT parent FROM "Operation" WHERE id=proof #>> '{quarantine,operationId}';
  source:=parent.result->'movieQuarantinePlexReceiptV2'; physical:=source #> '{groups,0}';
  SELECT * INTO STRICT decision FROM "RetentionDecision" WHERE id=proof #>> '{quarantine,decisionId}';
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=NEW."targetId" AND edition=selected->>'edition';
  SELECT * INTO STRICT runtime FROM "MediaRuntimeState" WHERE id='singleton';
  before_asset:=proof->'before'; after_asset:=proof->'after'; entry:=proof #> '{manifest,assets,0}';
  IF NOT COALESCE(jsonb_typeof(proof->'manifest')='object' AND (proof->'manifest')-'assets'='{}'::jsonb
    AND jsonb_typeof(entry)='object' AND entry ?& ARRAY['assetId','assetVersion','libraryKind','libraryPath','checksum','quarantineId','mediaIds','generations','sidecars']
    AND entry-ARRAY['assetId','assetVersion','libraryKind','libraryPath','checksum','quarantineId','mediaIds','generations','sidecars']='{}'::jsonb
    AND jsonb_typeof(before_asset)='object' AND jsonb_typeof(after_asset)='object'
    AND before_asset ?& ARRAY['schemaVersion','scope','id','version','edition','editionRootId','owned','ownershipEpoch','state','path','sourcePath','checksum','sizeBytes','properties','supersededByAssetId','plexPublishedAt','rollbackExpiresAt','coverage','subtitles','subtitleHistory']
    AND after_asset ?& ARRAY['schemaVersion','scope','id','version','edition','editionRootId','owned','ownershipEpoch','state','path','sourcePath','checksum','sizeBytes','properties','supersededByAssetId','plexPublishedAt','rollbackExpiresAt','coverage','subtitles','subtitleHistory']
    AND before_asset-ARRAY['schemaVersion','scope','id','version','edition','editionRootId','owned','ownershipEpoch','state','path','sourcePath','checksum','sizeBytes','properties','supersededByAssetId','plexPublishedAt','rollbackExpiresAt','coverage','subtitles','subtitleHistory']='{}'::jsonb
    AND after_asset-ARRAY['schemaVersion','scope','id','version','edition','editionRootId','owned','ownershipEpoch','state','path','sourcePath','checksum','sizeBytes','properties','supersededByAssetId','plexPublishedAt','rollbackExpiresAt','coverage','subtitles','subtitleHistory']='{}'::jsonb
    AND before_asset->'schemaVersion'='2'::jsonb AND after_asset->'schemaVersion'='2'::jsonb,false)
  THEN RAISE EXCEPTION 'Movie restore snapshot or manifest shape changed'; END IF;
  IF NOT COALESCE(parent.kind='retain_movie_edition_v4' AND source->'schemaVersion'='2'::jsonb
    AND source->>'operationId'=parent.id AND source->'scope'=selected
    AND source->>'decisionId'=decision.id AND source->>'manifestHash'=proof #>> '{quarantine,manifestHash}'
    AND proof #>> '{quarantine,receiptHash}' ~ '^[a-f0-9]{64}$'
    AND decision."mediaId"=NEW."targetId" AND decision.edition=selected->>'edition' AND decision.state='restored'
    AND decision.version=(source #>> '{decisions,0,quarantinedVersion}')::integer+1
    AND decision.evidence->>'restoreOperationId'=NEW.id
    AND decision.evidence #> ARRAY['restoredGenerations',NEW."targetId"]=proof #> '{input,generation}'
    AND decision.manifest=proof->'manifest' AND jsonb_array_length(proof #> '{manifest,assets}')=1
    AND decision."quarantinedAt"=(source->>'committedAt')::timestamptz
    AND EXISTS (SELECT 1 FROM "RetentionDecision" WHERE id=decision.id AND xmin::text=(txid_current()%4294967296)::text)
    AND target."editionRootId"=NEW."targetId" AND target."desiredPresence" AND target.monitoring
    AND target."intentionallyRemovedAt" IS NULL AND target.availability='importing'
    AND to_jsonb(target.generation)=proof #> '{input,generation}'
    AND to_jsonb(target."automationEpoch")=source->'recoveryEpoch'
    AND to_jsonb(runtime."recoveryEpoch")=source->'recoveryEpoch' AND runtime.mode='active' AND runtime."ownershipConfirmed"
    AND NEW.payload->'recoveryEpoch'=source->'recoveryEpoch'
    AND NOT EXISTS (SELECT 1 FROM "RecoveryHold" WHERE "mediaId"=NEW."targetId" AND edition=selected->>'edition' AND "releasedAt" IS NULL)
    AND NOT EXISTS (SELECT 1 FROM "AcquisitionReservation" WHERE "mediaId"=NEW."targetId" AND edition=selected->>'edition'),false)
  THEN RAISE EXCEPTION 'Movie restore lost its same-transaction decision, target or original quarantine parent'; END IF;
  SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=physical->>'assetId';
  IF NOT COALESCE(before_asset->'scope'=selected AND after_asset->'scope'=selected
    AND before_asset->>'id'=asset.id AND after_asset->>'id'=asset.id AND entry->>'assetId'=asset.id
    AND before_asset->>'state'='quarantined' AND after_asset->>'state'='published'
    AND (before_asset->>'version')::integer=(physical->>'assetVersion')::integer+1
    AND (after_asset->>'version')::integer=(before_asset->>'version')::integer+1
    AND to_jsonb(asset.version)=after_asset->'version' AND asset.state='published' AND asset.owned
    AND asset.edition=selected->>'edition' AND asset."editionRootId"=selected->>'rootMediaId'
    AND before_asset-ARRAY['version','state','subtitles','subtitleHistory']=after_asset-ARRAY['version','state','subtitles','subtitleHistory']
    AND after_asset->>'path'=asset.path AND asset.path=physical->>'canonicalPath' AND asset.path='/data/movies/'||(entry->>'libraryPath')
    AND (after_asset->>'sourcePath') IS NOT DISTINCT FROM asset."sourcePath"
    AND after_asset->>'checksum'=asset.checksum AND asset.checksum=physical->>'checksum'
    AND after_asset->>'sizeBytes'=asset."sizeBytes"::text AND asset."sizeBytes"::text=physical->>'sizeBytes'
    AND after_asset->'properties'=asset.properties AND to_jsonb(asset."ownershipEpoch")=source->'recoveryEpoch'
    AND after_asset->'ownershipEpoch'=source->'recoveryEpoch' AND after_asset->'owned'='true'::jsonb
    AND (after_asset->>'supersededByAssetId') IS NOT DISTINCT FROM asset."supersededByAssetId"
    AND (after_asset->>'plexPublishedAt')::timestamptz IS NOT DISTINCT FROM asset."plexPublishedAt"
    AND (after_asset->>'rollbackExpiresAt')::timestamptz IS NOT DISTINCT FROM asset."rollbackExpiresAt"
    AND after_asset->'coverage'=jsonb_build_array(jsonb_build_object('mediaId',NEW."targetId",'edition',selected->>'edition','current',true))
    AND (SELECT jsonb_agg(jsonb_build_object('mediaId',"mediaId",'edition',edition,'current',current) ORDER BY "mediaId",edition)
      FROM "AssetCoverage" WHERE "assetId"=asset.id)=after_asset->'coverage'
    AND EXISTS (SELECT 1 FROM "LibraryAsset" WHERE id=asset.id AND xmin::text=(txid_current()%4294967296)::text)
    AND EXISTS (SELECT 1 FROM "PlexBindingCurrent" WHERE "mediaId"=NEW."targetId" AND edition=selected->>'edition'
      AND "evidenceId" IS NULL AND "associationHash" IS NULL AND revision=(source #>> '{bindings,0,revision}')::integer+1),false)
  THEN RAISE EXCEPTION 'Movie restore is not its exact same-transaction physical successor'; END IF;
  snapshots:=(after_asset->'subtitles')||(after_asset->'subtitleHistory');
  IF jsonb_typeof(before_asset->'subtitles') IS DISTINCT FROM 'array' OR jsonb_typeof(before_asset->'subtitleHistory') IS DISTINCT FROM 'array'
    OR jsonb_typeof(after_asset->'subtitles') IS DISTINCT FROM 'array' OR jsonb_typeof(after_asset->'subtitleHistory') IS DISTINCT FROM 'array'
    OR jsonb_array_length(snapshots)<>(SELECT count(*) FROM "SubtitleAsset" WHERE "assetId"=asset.id)
    OR jsonb_array_length(snapshots)<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(snapshots)) THEN
    RAISE EXCEPTION 'Movie restore caption inventory changed';
  END IF;
  FOR restored IN SELECT value FROM jsonb_array_elements(snapshots) LOOP
    SELECT * INTO STRICT subtitle FROM "SubtitleAsset" WHERE id=restored->>'id' AND "assetId"=asset.id;
    IF restored IS DISTINCT FROM media_movie_restore_caption_snapshot(subtitle) THEN RAISE EXCEPTION 'Movie restore caption snapshot differs from committed row'; END IF;
  END LOOP;
  caption_ids:=ARRAY[]::text[];
  FOR original IN SELECT value FROM jsonb_array_elements(before_asset->'subtitles') LOOP
    SELECT value INTO STRICT restored FROM jsonb_array_elements(after_asset->'subtitles') WHERE value->>'id'=original->>'id';
    SELECT * INTO STRICT subtitle FROM "SubtitleAsset" WHERE id=restored->>'id';
    IF NOT COALESCE(original->>'assetId'=asset.id AND original->>'state'='quarantined'
      AND original->'videoVersion'=before_asset->'version' AND original->>'videoChecksum'=asset.checksum
      AND original->'ownershipEpoch'=source->'recoveryEpoch' AND original->>'storageKind' IN ('sidecar','embedded')
      AND restored=original||jsonb_build_object('version',(original->>'version')::integer+1,'state','installed','videoVersion',asset.version)
      AND EXISTS (SELECT 1 FROM "SubtitleAsset" WHERE id=subtitle.id AND xmin::text=(txid_current()%4294967296)::text),false)
    THEN RAISE EXCEPTION 'Movie restore caption is not its exact same-transaction successor'; END IF;
    caption_ids:=array_append(caption_ids,subtitle.id);
    IF subtitle."storageKind"='sidecar' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(entry->'sidecars') f
      WHERE f->>'subtitleId'=subtitle.id AND f->>'checksum'=subtitle.checksum AND subtitle.path='/data/movies/'||(f->>'libraryPath'))
    THEN RAISE EXCEPTION 'Movie restore omitted an owned sidecar'; END IF;
    IF subtitle."storageKind"='embedded' AND (subtitle."streamIndex" IS NULL OR subtitle.codec IS NULL) THEN RAISE EXCEPTION 'Movie restore embedded caption lost stream binding'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(after_asset->'subtitles'))<>cardinality(caption_ids)
    OR before_asset->'subtitleHistory' IS DISTINCT FROM after_asset->'subtitleHistory'
    OR (SELECT count(*) FROM jsonb_array_elements(entry->'sidecars'))<>(SELECT count(*) FROM "SubtitleAsset" WHERE id=ANY(caption_ids) AND "storageKind"='sidecar') THEN
    RAISE EXCEPTION 'Movie restore changed independent caption history or manifest coverage';
  END IF;
  IF jsonb_array_length(proof->'journals')<>1+jsonb_array_length(entry->'sidecars')
    OR jsonb_array_length(proof->'participants')<>2*(1+jsonb_array_length(entry->'sidecars')) THEN RAISE EXCEPTION 'Movie restore physical evidence coverage changed'; END IF;
  FOR file IN SELECT value FROM jsonb_array_elements(jsonb_build_array(entry||jsonb_build_object('subtitleId',NULL))||(entry->'sidecars')) LOOP
    operation_id:=NEW.id||'-restore-'||(file->>'quarantineId');
    SELECT value INTO STRICT journal FROM jsonb_array_elements(proof->'journals') WHERE value->>'path'='journal/'||operation_id||'.json';
    descriptor:=(journal->>'raw')::jsonb;
    IF NOT COALESCE(journal ?& ARRAY['path','raw','sha256','sizeBytes','identity']
      AND journal-ARRAY['path','raw','sha256','sizeBytes','identity']='{}'::jsonb
      AND encode(sha256(convert_to(journal->>'raw','UTF8')),'hex')=journal->>'sha256'
      AND octet_length(journal->>'raw')::text=journal->>'sizeBytes'
      AND descriptor->>'operationId'=operation_id AND descriptor->>'kind'='restore' AND descriptor->>'phase'='complete'
      AND descriptor->>'sha256'=file->>'checksum' AND descriptor->'previousSha256'='null'::jsonb
      AND right(descriptor->>'source',length('/quarantine/'||(file->>'quarantineId')))='/quarantine/'||(file->>'quarantineId')
      AND right(descriptor->>'target',length(file->>'libraryPath')+1)='/'||(file->>'libraryPath')
      AND jsonb_typeof(journal #> '{identity,ancestors}')='array' AND jsonb_array_length(journal #> '{identity,ancestors}')>0,false)
    THEN RAISE EXCEPTION 'Movie restore journal is not its actual completed effect'; END IF;
    SELECT count(*) INTO participant_count FROM jsonb_array_elements(proof->'participants') p
      WHERE p->>'assetId'=asset.id AND p->'subtitleId'=file->'subtitleId' AND p->>'libraryKind'='movies'
      AND ((p #>> '{physical,root}'='library' AND p #>> '{physical,path}'=file->>'libraryPath'
        AND p #>> '{physical,state}'='present' AND p #>> '{physical,sha256}'=file->>'checksum'
        AND p #>> '{physical,identity,inode}' ~ '^[0-9]+$')
        OR (p->>'role'='quarantine' AND p #>> '{physical,root}'='control'
          AND p #>> '{physical,path}'='quarantine/'||(file->>'quarantineId') AND p #>> '{physical,state}'='absent'));
    IF participant_count<>2
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(proof->'participants') p WHERE p->>'assetId'=asset.id AND p->'subtitleId'=file->'subtitleId' AND p #>> '{physical,root}'='library')
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(proof->'participants') p WHERE p->>'assetId'=asset.id AND p->'subtitleId'=file->'subtitleId' AND p #>> '{physical,root}'='control')
    THEN RAISE EXCEPTION 'Movie restore physical participants changed'; END IF;
  END LOOP;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_restore_receipt_v1 BEFORE INSERT OR UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_movie_restore_receipt_v1();
