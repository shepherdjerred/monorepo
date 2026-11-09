-- Ordinary Media-created effects use fresh canonical storage evidence.
-- Legacy adoption, history review and native recovery retain their writer lease.
CREATE FUNCTION media_runtime_proof_v1()
RETURNS TABLE (
  id text,
  "recoveryEpoch" integer,
  "observedAt" timestamp,
  "expiresAt" timestamp,
  "revokedAt" timestamp
) LANGUAGE plpgsql AS $$
DECLARE
  v_runtime "MediaRuntimeState";
  v_roots "MediaStorageAuthority"[];
  v_root "MediaStorageAuthority";
  v_mount jsonb;
  v_worker text;
  v_observed timestamp;
  v_expires timestamp;
  v_now timestamp := clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton' FOR SHARE;
  IF v_runtime.mode<>'active' OR NOT v_runtime."ownershipConfirmed"
  THEN RAISE EXCEPTION 'Media runtime is not active'; END IF;

  SELECT array_agg(s ORDER BY s."rootPath") INTO v_roots
    FROM "MediaStorageAuthority" s WHERE s."rootPath" IN ('/data/movies','/data/tv');

  IF EXISTS (
    SELECT 1 FROM unnest(v_roots) s WHERE s.evidence->>'kind'='canonical_storage'
  ) THEN
    IF cardinality(v_roots)<>2
    THEN RAISE EXCEPTION 'Media runtime requires both canonical storage roots'; END IF;
    FOREACH v_root IN ARRAY v_roots LOOP
      IF NOT COALESCE(v_root.evidence->>'kind'='canonical_storage'
        AND v_root.evidence->>'schemaVersion'='1' AND v_root.evidence->>'namespace'='media'
        AND v_root."recoveryEpoch"=v_runtime."recoveryEpoch" AND v_root."revokedAt" IS NULL
        AND v_root."observedAt"<=v_now AND v_root."expiresAt">v_now
        AND v_root."expiresAt">v_root."observedAt"
        AND v_root."expiresAt"-v_root."observedAt"<=interval '120 seconds'
        AND ((v_root.evidence->>'capturedAt')::timestamptz AT TIME ZONE 'UTC')=v_root."observedAt"
        AND ((v_root.evidence->>'expiresAt')::timestamptz AT TIME ZONE 'UTC')=v_root."expiresAt"
        -- snapshotHash(LEGACY_OBSERVER_CONFIG); the SQL parity regression detects config drift.
        AND v_root.evidence->>'configurationDigest'='17c2f2a23f0f71e7e4b264d643e598f728bd9f12d1225376646a99a3f2c34ad3'
        AND jsonb_array_length(v_root.evidence->'mounts')=2, false)
      THEN RAISE EXCEPTION 'Media runtime storage proof is missing, changed or expired'; END IF;
      SELECT m.value INTO STRICT v_mount
        FROM jsonb_array_elements(v_root.evidence->'mounts') m WHERE m.value->>'root'=v_root."rootPath";
      IF NOT COALESCE(v_mount->>'deployment'='media-media-files'
        AND v_mount->>'container'='media-files' AND v_mount->>'readOnly'='false'
        AND v_mount->>'pvcUid'=v_root."pvcUid" AND v_mount->>'volumeName'=v_root."volumeName"
        AND v_mount->>'volumePath'=v_root."volumePath" AND v_mount->>'podUid'=v_root."workerPodUid"
        AND length(v_root."workerPodUid")>0
        AND (v_worker IS NULL OR v_worker=v_root."workerPodUid"),false)
      THEN RAISE EXCEPTION 'Media runtime canonical storage identity changed'; END IF;
      v_worker:=v_root."workerPodUid";
      v_observed:=GREATEST(v_observed,v_root."observedAt");
      v_expires:=LEAST(v_expires,v_root."expiresAt");
    END LOOP;
    RETURN QUERY SELECT 'singleton'::text,v_runtime."recoveryEpoch",v_observed,v_expires,NULL::timestamp;
    RETURN;
  END IF;

  RETURN QUERY SELECT l.id,l."recoveryEpoch",l."observedAt",l."expiresAt",l."revokedAt"
    FROM "LegacyWriterLease" l WHERE l.id='singleton'
    AND l."recoveryEpoch"=v_runtime."recoveryEpoch" AND l."revokedAt" IS NULL
    AND l."observedAt"<=v_now AND l."expiresAt">v_now
    AND l."expiresAt"-l."observedAt"<=interval '120 seconds';
  IF NOT FOUND THEN RAISE EXCEPTION 'Media runtime writer proof is missing or expired'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_restore_plex_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE envelope jsonb; proof jsonb; physical jsonb; selected jsonb; expected jsonb; association jsonb; binding jsonb;
  group_value jsonb; previous jsonb; source jsonb; verification jsonb;
  asset "LibraryAsset"; target "MediaIntent"; runtime "MediaRuntimeState"; evidence "PlexAssociationEvidence";
  writer RECORD;
  quarantine "Operation"; claim "PlexClaimGroup"; part jsonb; original_evidence "PlexAssociationEvidence";
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'movieRestorePlexReceiptV1' THEN RAISE EXCEPTION 'Committed movie restore Plex receipt is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'movieRestorePlexReceiptV1' THEN
    IF NEW.result->'movieRestorePlexReceiptV1' IS DISTINCT FROM OLD.result->'movieRestorePlexReceiptV1'
      OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload)
        IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
    THEN RAISE EXCEPTION 'Committed movie restore Plex receipt or command is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'movieRestorePlexReceiptV1') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope:=NEW.result->'movieRestorePlexReceiptV1'; proof:=envelope->'receipt';
  physical:=NEW.result #> '{movieRestoreReceiptV1,receipt}'; selected:=proof #> '{input,scope}';
  expected:=proof->'expected'; association:=proof #> '{observation,associations,0}'; binding:=proof->'binding';
  group_value:=expected #> '{newGroups,0}'; previous:=expected #> '{previous,0}';
  verification:=proof #> '{observation,verification}';
  IF NOT COALESCE(jsonb_typeof(envelope)='object' AND envelope ?& ARRAY['receipt','receiptHash']
    AND envelope-ARRAY['receipt','receiptHash']='{}'::jsonb AND envelope->>'receiptHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(proof)='object' AND proof ?& ARRAY['schemaVersion','input','command','publication','expected','observation','binding','sdk','writerExpiresAt','assetPlexPublishedAt','reboundAt','committedAt']
    AND proof-ARRAY['schemaVersion','input','command','publication','expected','observation','binding','sdk','writerExpiresAt','assetPlexPublishedAt','reboundAt','committedAt']='{}'::jsonb
    AND proof->'schemaVersion'='1'::jsonb AND NEW.kind='restore_movie_edition_v4'
    AND NEW.payload->>'kind'=NEW.kind AND NEW.payload->>'operationId'=NEW.id
    AND proof #> '{input,schemaVersion}'='4'::jsonb AND proof #>> '{input,operationId}'=NEW.id
    AND proof #>> '{input,mediaId}'=NEW."targetId" AND selected=NEW.payload->'scope'
    AND selected->>'rootMediaId'=NEW."targetId" AND selected->>'mediaId'=NEW."targetId"
    AND proof->'input'=jsonb_build_object('schemaVersion',NEW.payload->'schemaVersion','operationId',NEW.id,'mediaId',NEW."targetId",'generation',NEW.payload->'generation','scope',NEW.payload->'scope')
    AND (proof->'command') ?& ARRAY['kind','targetId','userId','payloadHash']
    AND (proof->'command')-ARRAY['kind','targetId','userId','payloadHash']='{}'::jsonb
    AND proof #>> '{command,kind}'=NEW.kind AND proof #>> '{command,targetId}'=NEW."targetId"
    AND (proof #>> '{command,userId}') IS NOT DISTINCT FROM NEW."userId"
    AND proof #>> '{command,payloadHash}' ~ '^[a-f0-9]{64}$'
    AND physical->'schemaVersion'='1'::jsonb AND physical->'input'=proof->'input' AND physical->'scope'=selected
    AND proof #>> '{publication,kind}'='movie_restore_publication_v1'
    AND proof #>> '{publication,operationId}'=NEW.id AND proof #> '{publication,scope}'=selected
    AND proof #>> '{publication,receiptHash}'=NEW.result #>> '{movieRestoreReceiptV1,receiptHash}'
    AND proof #>> '{publication,assetId}'=physical #>> '{after,id}'
    AND proof #> '{publication,assetVersion}'=physical #> '{after,version}'
    AND proof #>> '{publication,bindingHash}' ~ '^[a-f0-9]{64}$' AND proof #>> '{publication,physicalEvidenceHash}' ~ '^[a-f0-9]{64}$'
    AND (proof->'publication') ?& ARRAY['kind','scope','operationId','receiptHash','assetId','assetVersion','bindingHash','physicalEvidenceHash']
    AND (proof->'publication')-ARRAY['kind','scope','operationId','receiptHash','assetId','assetVersion','bindingHash','physicalEvidenceHash']='{}'::jsonb
    AND expected ?& ARRAY['schemaVersion','originalItem','recoveryEpoch','access','targets','previous','oldGroups','newGroups','parents']
    AND expected-ARRAY['schemaVersion','originalItem','recoveryEpoch','access','targets','previous','oldGroups','newGroups','parents']='{}'::jsonb
    AND expected->'schemaVersion'='3'::jsonb AND jsonb_array_length(expected->'targets')=1
    AND jsonb_array_length(expected->'previous')=1 AND jsonb_array_length(expected->'newGroups')=1
    AND expected->'oldGroups'='[]'::jsonb AND jsonb_array_length(expected->'parents')=1
    AND expected #>> '{parents,0,kind}'='movie_restore_publication_v1'
    AND expected #> '{parents,0,reference}'=proof->'publication'
    AND expected #> '{parents,0,recoveryEpoch}'=expected->'recoveryEpoch'
    AND expected->'recoveryEpoch'=NEW.payload->'recoveryEpoch'
    AND expected #> '{targets,0,scope}'=selected-'rootMediaId'
    AND expected #>> '{targets,0,editionRootId}'=selected->>'rootMediaId'
    AND expected #> '{targets,0,generation}'=proof #> '{input,generation}'
    AND expected #> '{targets,0,automationEpoch}'=expected->'recoveryEpoch'
    AND proof #> '{observation,schemaVersion}'='2'::jsonb AND proof #>> '{observation,purpose}'='current_serving'
    AND jsonb_array_length(proof #> '{observation,associations}')=1
    AND association->'schemaVersion'='2'::jsonb AND association->>'kind'='movie'
    AND association->'group'=group_value AND association->'scope'=selected-'rootMediaId'
    AND association->>'editionRootId'=selected->>'rootMediaId'
    AND association->>'canonicalIdentityHash'=expected #>> '{targets,0,canonicalIdentityHash}'
    AND association->>'numberingHash'=expected #>> '{targets,0,numberingHash}'
    AND association->'definition'=expected #> '{targets,0,definition}'
    AND expected->'access'=jsonb_build_array(association->'access')
    AND binding->'scope'=association->'scope'
    AND binding ?& ARRAY['scope','evidenceId','associationHash','revision']
    AND binding-ARRAY['scope','evidenceId','associationHash','revision']='{}'::jsonb
    AND previous->'scope'=association->'scope' AND previous->'evidence'='null'::jsonb
    AND (binding->>'revision')::integer=(previous->>'revision')::integer+1
    AND (proof->>'assetPlexPublishedAt') IS NOT DISTINCT FROM (physical #>> '{after,plexPublishedAt}')
    AND (proof #>> '{sdk,observedAt}')::timestamptz <= (verification->>'startedAt')::timestamptz
    AND (verification->>'completedAt')::timestamptz >= (verification->>'startedAt')::timestamptz
    AND (verification->>'expiresAt')::timestamptz <= (proof #>> '{sdk,expiresAt}')::timestamptz
    AND (verification->>'expiresAt')::timestamptz <= (proof->>'writerExpiresAt')::timestamptz
    AND (verification->>'expiresAt')::timestamptz <= (proof #>> '{sdk,observedAt}')::timestamptz+interval '60 seconds'
    AND (proof->>'reboundAt')::timestamptz >= (verification->>'completedAt')::timestamptz
    AND (proof->>'committedAt')::timestamptz >= (proof->>'reboundAt')::timestamptz
    AND (proof->>'committedAt')::timestamptz < (verification->>'expiresAt')::timestamptz
    AND (proof->>'committedAt')::timestamptz >= date_trunc('milliseconds',transaction_timestamp())
    AND (proof->>'committedAt')::timestamptz <= clock_timestamp(),false)
  THEN RAISE EXCEPTION 'Movie restore Plex receipt lost its exact command, physical parent, observation or original clock'; END IF;
  SELECT * INTO STRICT quarantine FROM "Operation" WHERE id=physical #>> '{quarantine,operationId}';
  source:=quarantine.result->'movieQuarantinePlexReceiptV2';
  IF quarantine.kind<>'retain_movie_edition_v4' OR source->'scope' IS DISTINCT FROM selected
    OR (previous->>'revision')::integer<>(source #>> '{bindings,0,revision}')::integer+1 THEN
    RAISE EXCEPTION 'Movie restore Plex prior pointer is not its actual retired quarantine binding';
  END IF;
  SELECT * INTO STRICT original_evidence FROM "PlexAssociationEvidence" WHERE id=source #>> '{bindings,0,evidenceId}';
  IF NOT COALESCE(
    expected #> '{originalItem,binding}'=source #> '{bindings,0}'
    AND (expected->'originalItem') ?& ARRAY['binding','ratingKey','part']
    AND (expected->'originalItem')-ARRAY['binding','ratingKey','part']='{}'::jsonb
    AND (expected #> '{originalItem,part}') ?& ARRAY['id','file']
    AND (expected #> '{originalItem,part}')-ARRAY['id','file']='{}'::jsonb
    AND original_evidence."associationHash"=source #>> '{bindings,0,associationHash}'
    AND original_evidence."mediaId"=NEW."targetId" AND original_evidence.edition=selected->>'edition'
    AND original_evidence."assetId"=physical #>> '{after,id}'
    AND original_evidence.evidence->'scope'=selected-'rootMediaId'
    AND original_evidence.evidence->'group'=source #> '{groups,0}'
    AND expected #> '{originalItem,ratingKey}'=original_evidence.evidence #> '{item,ratingKey}'
    AND expected #> '{originalItem,part,id}'=original_evidence.evidence #> '{item,media,0,parts,0,id}'
    AND expected #> '{originalItem,part,file}'=original_evidence.evidence #> '{item,media,0,parts,0,file}'
    AND association->'access'=original_evidence.evidence->'access'
    AND association #> '{item,ratingKey}'=expected #> '{originalItem,ratingKey}'
    AND association #> '{item,media,0,parts,0,id}'=expected #> '{originalItem,part,id}'
    AND association #> '{item,media,0,parts,0,file}'=expected #> '{originalItem,part,file}',false)
  THEN RAISE EXCEPTION 'Movie restore Plex item or Part changed its original quarantine association'; END IF;
  SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=physical #>> '{after,id}';
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=NEW."targetId" AND edition=selected->>'edition';
  SELECT * INTO STRICT runtime FROM "MediaRuntimeState" WHERE id='singleton';
  SELECT * INTO STRICT writer FROM media_runtime_proof_v1() WHERE id='singleton';
  SELECT * INTO STRICT evidence FROM "PlexAssociationEvidence" WHERE id=binding->>'evidenceId';
  IF NOT COALESCE(asset.state='published' AND asset.owned AND asset.edition=selected->>'edition' AND asset."editionRootId"=selected->>'rootMediaId'
    AND asset.id=group_value->>'assetId' AND to_jsonb(asset.version)=group_value->'assetVersion'
    AND group_value->'assetVersion'=physical #> '{after,version}' AND group_value->>'checksum'=asset.checksum
    AND group_value->>'canonicalPath'=asset.path AND group_value->>'sizeBytes'=asset."sizeBytes"::text
    AND group_value->'ownershipEpoch'=to_jsonb(asset."ownershipEpoch") AND group_value->'ownershipEpoch'=expected->'recoveryEpoch'
    AND group_value->>'canonicalRootId'=selected->>'rootMediaId' AND group_value->>'edition'=selected->>'edition'
    AND group_value->'coverage'=jsonb_build_array(selected-'rootMediaId')
    AND (asset."plexPublishedAt") IS NOT DISTINCT FROM ((proof->>'assetPlexPublishedAt')::timestamptz AT TIME ZONE 'UTC')
    AND target.availability='available' AND target."desiredPresence" AND target.monitoring AND target."intentionallyRemovedAt" IS NULL
    AND target."editionRootId"=selected->>'rootMediaId' AND to_jsonb(target.generation)=proof #> '{input,generation}'
    AND to_jsonb(target.version)=expected #> '{targets,0,intentVersion}'
    AND to_jsonb(target."automationEpoch")=expected->'recoveryEpoch' AND to_jsonb(runtime."recoveryEpoch")=expected->'recoveryEpoch'
    AND runtime.mode='active' AND runtime."ownershipConfirmed"
    AND writer."revokedAt" IS NULL AND writer."recoveryEpoch"=runtime."recoveryEpoch"
    AND writer."observedAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND writer."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
    AND writer."expiresAt"=((proof->>'writerExpiresAt')::timestamptz AT TIME ZONE 'UTC')
    AND evidence.evidence=association AND evidence."associationHash"=binding->>'associationHash'
    AND evidence."assetId"=asset.id AND evidence."mediaId"=NEW."targetId" AND evidence.edition=selected->>'edition'
    AND evidence."serverMachineId"=association #>> '{access,serverMachineId}'
    AND EXISTS (SELECT 1 FROM "PlexAssociationEvidence" WHERE id=evidence.id AND xmin::text=(txid_current()%4294967296)::text)
    AND EXISTS (SELECT 1 FROM "MediaIntent" WHERE "mediaId"=NEW."targetId" AND edition=selected->>'edition' AND xmin::text=(txid_current()%4294967296)::text)
    AND EXISTS (SELECT 1 FROM "PlexBindingCurrent" p WHERE p."mediaId"=NEW."targetId" AND p.edition=selected->>'edition'
      AND p."evidenceId"=evidence.id AND p."associationHash"=evidence."associationHash" AND to_jsonb(p.revision)=binding->'revision'
      AND p."verifiedStartedAt"=((verification->>'startedAt')::timestamptz AT TIME ZONE 'UTC')
      AND p."verifiedCompletedAt"=((verification->>'completedAt')::timestamptz AT TIME ZONE 'UTC')
      AND p.xmin::text=(txid_current()%4294967296)::text),false)
  THEN RAISE EXCEPTION 'Movie restore Plex completion lacks its same-transaction actual association and scoped pointer'; END IF;
  SELECT * INTO STRICT claim FROM "PlexClaimGroup" WHERE "serverMachineId"=evidence."serverMachineId" AND "group"=group_value;
  part:=association #> '{item,media,0,parts,0}';
  IF NOT COALESCE((SELECT count(*) FROM "PlexClaimGroupMember" WHERE "groupId"=claim.id)=1
    AND EXISTS (SELECT 1 FROM "PlexClaimGroupMember" m JOIN "PlexItemClaim" i ON i."groupId"=m."groupId" AND i."mediaId"=m."mediaId" AND i.edition=m.edition
      WHERE m."groupId"=claim.id AND m."mediaId"=NEW."targetId" AND m.edition=selected->>'edition'
      AND m."evidenceId"=evidence.id AND m."associationHash"=evidence."associationHash"
      AND i."evidenceId"=evidence.id AND i."associationHash"=evidence."associationHash"
      AND i."serverMachineId"=evidence."serverMachineId" AND i."sectionId"=association #>> '{access,sectionId}'
      AND i."ratingKey"=association #>> '{item,ratingKey}')
    AND (SELECT count(*) FROM "PlexPartClaim" WHERE "groupId"=claim.id)=1
    AND EXISTS (SELECT 1 FROM "PlexPartClaim" WHERE "groupId"=claim.id AND "serverMachineId"=evidence."serverMachineId" AND "partId"=part->>'id' AND "canonicalPath"=asset.path)
    AND (SELECT count(*) FROM "PlexPathClaim" WHERE "groupId"=claim.id)=1
    AND EXISTS (SELECT 1 FROM "PlexPathClaim" WHERE "groupId"=claim.id AND "serverMachineId"=evidence."serverMachineId" AND "canonicalPath"=asset.path)
    AND EXISTS (SELECT 1 FROM "PlexClaimGroup" WHERE id=claim.id AND xmin::text=(txid_current()%4294967296)::text),false)
  THEN RAISE EXCEPTION 'Movie restore Plex completion omitted its complete physical claim group'; END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_post_effect_notice_event_v4() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation"; quarantine "Operation"; decision "RetentionDecision"; target "MediaIntent";
  choice "MovieEditionChoice"; request "MediaRequest"; asset "LibraryAsset"; runtime "MediaRuntimeState"; writer RECORD;
  body jsonb; source jsonb; proof jsonb; selected jsonb; group_value jsonb; binding jsonb; stage text; expected_version integer;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.payload->>'kind' IN ('movie_restoration','movie_removal') THEN RAISE EXCEPTION 'Movie post-effect notification source is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.payload->>'kind' IN ('movie_restoration','movie_removal') THEN
    IF (NEW.id,NEW."dedupeKey",NEW."mediaId",NEW."actorId",NEW.kind,NEW.payload) IS DISTINCT FROM (OLD.id,OLD."dedupeKey",OLD."mediaId",OLD."actorId",OLD.kind,OLD.payload)
    THEN RAISE EXCEPTION 'Movie post-effect notification source is immutable'; END IF;
    RETURN NEW;
  END IF;
  body:=NEW.payload;
  IF body->>'kind' NOT IN ('movie_restoration','movie_removal') OR body->>'kind' IS NULL THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  source:=body->'source'; selected:=source->'scope';
  SELECT * INTO STRICT command FROM "Operation" WHERE id=source->>'operationId';
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=NEW."mediaId" AND edition=selected->>'edition';
  SELECT * INTO STRICT choice FROM "MovieEditionChoice" WHERE id=body #>> '{request,choiceId}';
  SELECT * INTO STRICT request FROM "MediaRequest" WHERE id=body #>> '{request,id}';
  SELECT * INTO STRICT runtime FROM "MediaRuntimeState" WHERE id='singleton';
  SELECT * INTO STRICT writer FROM media_runtime_proof_v1() WHERE id='singleton';
  IF NOT COALESCE(jsonb_typeof(body)='object' AND body->'schemaVersion'='4'::jsonb
    AND body ?& ARRAY['schemaVersion','kind','eventKind','source','generation','recoveryEpoch','request','asset']
    AND body->>'eventKind'=NEW.kind AND selected->>'mediaId'=NEW."mediaId" AND selected->>'rootMediaId'=NEW."mediaId"
    AND selected ?& ARRAY['rootMediaId','mediaId','edition'] AND selected-ARRAY['rootMediaId','mediaId','edition']='{}'::jsonb
    AND source->'schemaVersion'='4'::jsonb AND source->>'operationId'=command.id
    AND command."targetId"=NEW."mediaId" AND command.payload->>'operationId'=command.id AND command.payload->>'kind'=command.kind
    AND command.payload->'scope'=selected AND command.payload->'generation'=body->'generation'
    AND command.payload->'recoveryEpoch'=body->'recoveryEpoch'
    AND body->'request' ?& ARRAY['id','choiceId','choiceRevision'] AND (body->'request')-ARRAY['id','choiceId','choiceRevision']='{}'::jsonb
    AND body->'asset' ?& ARRAY['id','version','checksum'] AND (body->'asset')-ARRAY['id','version','checksum']='{}'::jsonb
    AND body #>> '{request,id}'=choice."requestId" AND body #> '{request,choiceRevision}'=to_jsonb(choice."choiceRevision")
    AND choice."requestId"=request.id AND choice."subjectUserId"=request."userId" AND choice."actorId"=NEW."actorId"
    AND choice."rootMediaId"=NEW."mediaId" AND choice.edition=selected->>'edition'
    AND request."mediaId"=NEW."mediaId" AND request.edition=selected->>'edition' AND request.active AND NOT request.excluded AND request.direct
    AND request."movieEditionChoiceId"=choice.id AND request."movieEditionChoiceRevision"=choice."choiceRevision"
    AND target."editionRootId"=NEW."mediaId" AND to_jsonb(target.generation)=body->'generation'
    AND to_jsonb(target."automationEpoch")=body->'recoveryEpoch'
    AND runtime.mode='active' AND runtime."ownershipConfirmed" AND to_jsonb(runtime."recoveryEpoch")=body->'recoveryEpoch'
    AND writer."recoveryEpoch"=runtime."recoveryEpoch" AND writer."revokedAt" IS NULL
    AND writer."observedAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND writer."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC'),false)
  THEN RAISE EXCEPTION 'Movie post-effect notice requires its exact actual command, current target and personal choice'; END IF;
  IF body->>'kind'='movie_restoration' THEN
    proof:=command.result #> '{movieRestorePlexReceiptV1,receipt}';
    group_value:=proof #> '{expected,newGroups,0}'; binding:=proof->'binding';
    SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=group_value->>'assetId';
    IF NOT COALESCE(body ? 'publicationHash'
      AND body-ARRAY['schemaVersion','kind','eventKind','source','publicationHash','generation','recoveryEpoch','request','asset']='{}'::jsonb
      AND source ?& ARRAY['schemaVersion','operationId','mediaId','generation','scope']
      AND source-ARRAY['schemaVersion','operationId','mediaId','generation','scope']='{}'::jsonb
      AND command.kind='restore_movie_edition_v4' AND NEW.kind='media_available'
      AND proof->'schemaVersion'='1'::jsonb AND source=proof->'input'
      AND body->>'publicationHash'=command.result #>> '{movieRestorePlexReceiptV1,receiptHash}'
      AND body #>> '{asset,id}'=asset.id AND body #> '{asset,version}'=to_jsonb(asset.version)
      AND body #>> '{asset,checksum}'=asset.checksum AND asset.state='published' AND asset.owned
      AND asset.id=group_value->>'assetId' AND to_jsonb(asset.version)=group_value->'assetVersion'
      AND asset.checksum=group_value->>'checksum' AND asset.path=group_value->>'canonicalPath'
      AND asset.edition=selected->>'edition' AND asset."editionRootId"=NEW."mediaId"
      AND to_jsonb(asset."ownershipEpoch")=body->'recoveryEpoch'
      AND target.availability='available' AND target."desiredPresence" AND target."intentionallyRemovedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "PlexBindingCurrent" p WHERE p."mediaId"=NEW."mediaId" AND p.edition=selected->>'edition'
        AND p."evidenceId"=binding->>'evidenceId' AND p."associationHash"=binding->>'associationHash' AND to_jsonb(p.revision)=binding->'revision')
      AND EXISTS (SELECT 1 FROM "PlexAssociationEvidence" e WHERE e.id=binding->>'evidenceId'
        AND e.evidence=proof #> '{observation,associations,0}' AND e."associationHash"=binding->>'associationHash'
        AND e."assetId"=asset.id AND e."mediaId"=NEW."mediaId" AND e.edition=selected->>'edition'),false)
    THEN RAISE EXCEPTION 'Movie restoration notice requires its actual scoped restore serving receipt'; END IF;
  ELSE
    stage:=source->>'stage';
    SELECT * INTO STRICT decision FROM "RetentionDecision" WHERE id=source->>'decisionId';
    IF stage='quarantined' THEN quarantine:=command;
    ELSIF stage='purged' THEN
      SELECT * INTO STRICT quarantine FROM "Operation" WHERE kind='retain_movie_edition_v4'
        AND result #>> '{movieQuarantinePlexReceiptV2,decisionId}'=decision.id;
    ELSE RAISE EXCEPTION 'Movie removal notice stage is unknown'; END IF;
    proof:=quarantine.result->'movieQuarantinePlexReceiptV2'; group_value:=proof #> '{groups,0}';
    expected_version:=(group_value->>'assetVersion')::integer+CASE stage WHEN 'quarantined' THEN 1 ELSE 2 END;
    SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=group_value->>'assetId';
    IF NOT COALESCE(body ? 'sourceHash' AND body->>'sourceHash' ~ '^[a-f0-9]{64}$'
      AND body-ARRAY['schemaVersion','kind','eventKind','source','sourceHash','generation','recoveryEpoch','request','asset']='{}'::jsonb
      AND source ?& ARRAY['schemaVersion','operationId','decisionId','scope','stage']
      AND source-ARRAY['schemaVersion','operationId','decisionId','scope','stage']='{}'::jsonb
      AND command.kind='retain_movie_edition_v4' AND quarantine.kind='retain_movie_edition_v4'
      AND quarantine.payload->'scope'=selected AND quarantine.payload->'generation'=body->'generation'
      AND quarantine.payload->'recoveryEpoch'=body->'recoveryEpoch'
      AND proof->'schemaVersion'='2'::jsonb AND proof->>'operationId'=quarantine.id AND proof->>'decisionId'=decision.id
      AND proof->'scope'=selected AND proof->'recoveryEpoch'=body->'recoveryEpoch'
      AND decision."mediaId"=NEW."mediaId" AND decision.edition=selected->>'edition'
      AND to_jsonb(decision.generation)=body->'generation' AND decision.state::text=stage
      AND decision.version=(proof #>> '{decisions,0,quarantinedVersion}')::integer+CASE stage WHEN 'quarantined' THEN 0 ELSE 1 END
      AND decision."quarantinedAt"=((proof->>'committedAt')::timestamptz AT TIME ZONE 'UTC')
      AND decision."purgeAfter"=decision."quarantinedAt"+interval '7 days'
      AND (stage<>'purged' OR decision.evidence->>'purgeOperationId'=command.id)
      AND NEW.kind=CASE stage WHEN 'quarantined' THEN 'files_quarantined' ELSE 'files_purged' END
      AND target.availability::text=CASE stage WHEN 'quarantined' THEN 'quarantined' ELSE 'removed' END
      AND body #>> '{asset,id}'=asset.id AND (body #>> '{asset,version}')::integer=expected_version
      AND body #>> '{asset,checksum}'=group_value->>'checksum' AND asset.checksum=group_value->>'checksum'
      AND asset.version=expected_version AND asset.state::text=stage AND asset.owned
      AND asset.edition=selected->>'edition' AND asset."editionRootId"=NEW."mediaId"
      AND to_jsonb(asset."ownershipEpoch")=body->'recoveryEpoch' AND asset.path=group_value->>'canonicalPath'
      AND (SELECT count(*) FROM "AssetCoverage" WHERE "assetId"=asset.id)=1
      AND EXISTS (SELECT 1 FROM "AssetCoverage" WHERE "assetId"=asset.id AND "mediaId"=NEW."mediaId" AND edition=selected->>'edition' AND current=(stage='quarantined')),false)
    THEN RAISE EXCEPTION 'Movie removal notice requires its actual completed scoped removal and quarantine parent'; END IF;
  END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_retry_operation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capture jsonb; envelope jsonb; proof jsonb; input jsonb; selected jsonb; transfer jsonb;
  attempt "AcquisitionAttempt"; prior "Operation"; torrent "Torrent"; release "ReleaseCandidate"; writer RECORD;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.payload,'{}'::jsonb) ? 'movieRetryV1' OR COALESCE(OLD.result,'{}'::jsonb) ? 'movieRetryRenewalV1'
    THEN RAISE EXCEPTION 'Movie retry command and renewal are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF COALESCE(OLD.payload,'{}'::jsonb) ? 'movieRetryV1' THEN
      IF (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload)
        IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
      THEN RAISE EXCEPTION 'Movie retry command and original selection are immutable'; END IF;
    ELSIF COALESCE(NEW.payload,'{}'::jsonb) ? 'movieRetryV1' THEN
      RAISE EXCEPTION 'Movie retry selection must be captured at command birth';
    END IF;
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'movieRetryRenewalV1' THEN
      IF NEW.result->'movieRetryRenewalV1' IS DISTINCT FROM OLD.result->'movieRetryRenewalV1'
      THEN RAISE EXCEPTION 'Movie retry renewal receipt is immutable'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP='INSERT' AND COALESCE(NEW.payload,'{}'::jsonb) ? 'movieRetryV1' THEN
    SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=NEW.payload #>> '{movieRetryV1,attemptId}';
    PERFORM media_movie_retry_source_v1(NEW,attempt);
    IF attempt."coordinatorOperationId" IS DISTINCT FROM NEW.payload #>> '{movieRetryV1,previousCoordinatorOperationId}'
    THEN RAISE EXCEPTION 'Movie retry must capture the actual current coordinator'; END IF;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'movieRetryRenewalV1') THEN RETURN NEW; END IF;
  IF TG_OP<>'UPDATE' OR NOT (COALESCE(NEW.payload,'{}'::jsonb) ? 'movieRetryV1')
  THEN RAISE EXCEPTION 'Movie retry renewal requires an existing pending retry command'; END IF;
  PERFORM media_plex_assert_deadline();
  capture:=NEW.payload->'movieRetryV1'; selected:=NEW.payload->'scope';
  envelope:=NEW.result->'movieRetryRenewalV1'; proof:=envelope->'receipt'; input:=proof->'input'; transfer:=proof->'torrent';
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=capture->>'attemptId';
  SELECT * INTO STRICT prior FROM "Operation" WHERE id=capture->>'previousCoordinatorOperationId';
  SELECT * INTO STRICT writer FROM media_runtime_proof_v1() WHERE id='singleton';
  PERFORM media_movie_retry_source_v1(NEW,attempt);
  IF NOT COALESCE(envelope ?& ARRAY['receipt','receiptHash'] AND envelope-ARRAY['receipt','receiptHash']='{}'::jsonb
    AND envelope->>'receiptHash' ~ '^[a-f0-9]{64}$'
    AND proof ?& ARRAY['schemaVersion','scope','input','capture','commandHash','previousCommandHash','root','child','previousState','torrent','observedAt','sdkExpiresAt','expiresAt','committedAt']
    AND proof-ARRAY['schemaVersion','scope','input','capture','commandHash','previousCommandHash','root','child','previousState','torrent','observedAt','sdkExpiresAt','expiresAt','committedAt']='{}'::jsonb
    AND proof->'schemaVersion'='1'::jsonb AND proof->'scope'=selected AND proof->'capture'=capture
    AND proof->>'commandHash' ~ '^[a-f0-9]{64}$' AND proof->>'previousCommandHash' ~ '^[a-f0-9]{64}$'
    AND input ?& ARRAY['schemaVersion','operationId','mediaId','generation','scope']
    AND input-ARRAY['schemaVersion','operationId','mediaId','generation','scope']='{}'::jsonb
    AND input->'schemaVersion'='4'::jsonb AND input->>'operationId'=NEW.id AND input->>'mediaId'=NEW."targetId"
    AND input->'scope'=selected AND input->'generation'=capture->'generation'
    AND proof #> '{root}' ?& ARRAY['workflowId','runId','status'] AND (proof->'root')-ARRAY['workflowId','runId','status']='{}'::jsonb
    AND proof #>> '{root,workflowId}'='media-operation-'||prior.id AND length(proof #>> '{root,runId}') BETWEEN 1 AND 200
    AND proof #>> '{root,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND (proof->'child'='null'::jsonb OR ((proof->'child') ?& ARRAY['workflowId','runId','status']
      AND (proof->'child')-ARRAY['workflowId','runId','status']='{}'::jsonb
      AND proof #>> '{child,workflowId}'='media-acquire-'||attempt.id AND length(proof #>> '{child,runId}') BETWEEN 1 AND 200
      AND proof #>> '{child,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')))
    AND (proof->'child'<>'null'::jsonb OR (attempt.state='reserved' AND attempt."torrentId" IS NULL))
    AND proof->>'previousState'=attempt.state AND attempt."coordinatorOperationId"=NEW.id
    AND EXISTS (SELECT 1 FROM "AcquisitionAttempt" a WHERE a.id=attempt.id AND a.xmin::text=(txid_current()%4294967296)::text)
    AND (proof->>'observedAt')::timestamptz <= (proof->>'committedAt')::timestamptz
    AND (proof->>'committedAt')::timestamptz >= date_trunc('milliseconds',transaction_timestamp())
    AND (proof->>'committedAt')::timestamptz <= clock_timestamp()
    AND (proof->>'committedAt')::timestamptz < (proof->>'expiresAt')::timestamptz
    AND (proof->>'expiresAt')::timestamptz <= (proof->>'sdkExpiresAt')::timestamptz
    AND (proof->>'expiresAt')::timestamptz <= (proof->>'observedAt')::timestamptz+interval '60 seconds'
    AND current_setting('media.plex_deadline_ms',true)::numeric <= extract(epoch FROM (proof->>'expiresAt')::timestamptz)*1000
    AND writer."recoveryEpoch"=attempt."recoveryEpoch" AND writer."revokedAt" IS NULL
    AND writer."observedAt"<=clock_timestamp() AND writer."expiresAt">clock_timestamp()
    AND (proof->>'expiresAt')::timestamptz <= writer."expiresAt",false)
  THEN RAISE EXCEPTION 'Movie retry renewal requires actual closed predecessors and the same-transaction original acquisition'; END IF;
  IF transfer='null'::jsonb THEN
    IF attempt."torrentId" IS NOT NULL OR attempt.state<>'reserved'
    THEN RAISE EXCEPTION 'Only an untouched reservation may renew without a transfer'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "Operation" o WHERE o.id=attempt."operationId" AND COALESCE(o.result,'{}'::jsonb)?'movieTransferReuseGrantV1') THEN
      PERFORM media_movie_transfer_retry_source_v1(transfer,attempt);
      PERFORM media_plex_assert_deadline();
      RETURN NEW;
    END IF;
    SELECT * INTO STRICT torrent FROM "Torrent" WHERE id=attempt."torrentId";
    SELECT * INTO STRICT release FROM "ReleaseCandidate" WHERE id=attempt."releaseId";
    IF NOT COALESCE(transfer ?& ARRAY['id','infoHash','qbittorrentId','providerId','ownershipEpoch','observationHash','savePath','contentPath','tags','category','policyHash']
      AND transfer-ARRAY['id','infoHash','qbittorrentId','providerId','ownershipEpoch','observationHash','savePath','contentPath','tags','category','policyHash']='{}'::jsonb
      AND transfer->>'id'=torrent.id AND torrent.owned AND torrent."ownershipEpoch"=attempt."recoveryEpoch"
      AND transfer->>'infoHash'=torrent."infoHash" AND torrent."infoHash"=release."sourceEvidence"->>'infoHash'
      AND transfer->>'qbittorrentId'=torrent."qbittorrentId" AND transfer->>'qbittorrentId' ~ '^[a-f0-9]{40}$'
      AND transfer->>'providerId'=torrent."providerId" AND torrent."providerId"=release."providerId"
      AND transfer->'ownershipEpoch'=to_jsonb(torrent."ownershipEpoch")
      AND transfer->>'observationHash' ~ '^[a-f0-9]{64}$' AND transfer->>'policyHash' ~ '^[a-f0-9]{64}$'
      AND rtrim(transfer->>'savePath','/')='/downloads/media/'||attempt.id AND length(transfer->>'contentPath') BETWEEN 1 AND 4096
      AND transfer->>'category'='media'
      AND ARRAY(SELECT btrim(tag) FROM unnest(string_to_array(transfer->>'tags',',')) tag WHERE btrim(tag) ~ '^media-[a-f0-9-]{36}$')=ARRAY['media-'||attempt."operationId"]
      AND ARRAY(SELECT btrim(tag) FROM unnest(string_to_array(transfer->>'tags',',')) tag WHERE btrim(tag) LIKE 'media-attempt-%')=ARRAY['media-attempt-'||attempt.id],false)
    THEN RAISE EXCEPTION 'Movie retry cannot adopt or relabel a transfer outside its original Media add'; END IF;
  END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_retry_renewal_check_v2(command "Operation", attempt "AcquisitionAttempt")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE capture jsonb:=command.payload->'movieRetryV2'; envelope jsonb:=command.result->'movieRetryRenewalV2';
  proof jsonb:=envelope->'receipt'; input jsonb:=proof->'input'; before jsonb:=proof->'beforeAttempt';
  writer RECORD;
BEGIN
  PERFORM media_plex_assert_deadline();
  PERFORM media_movie_retry_continuation_source_v2(command,attempt);
  SELECT * INTO STRICT writer FROM media_runtime_proof_v1() WHERE id='singleton';
  IF NOT COALESCE(envelope ?& ARRAY['receipt','receiptHash'] AND envelope-ARRAY['receipt','receiptHash']='{}'::jsonb
    AND envelope->>'receiptHash' ~ '^[a-f0-9]{64}$'
    AND proof ?& ARRAY['schemaVersion','scope','input','capture','beforeAttempt','commandHash','previousCommandHash','root','child','previousState','transfer','observedAt','sdkExpiresAt','expiresAt','committedAt']
    AND proof-ARRAY['schemaVersion','scope','input','capture','beforeAttempt','commandHash','previousCommandHash','root','child','previousState','transfer','observedAt','sdkExpiresAt','expiresAt','committedAt']='{}'::jsonb
    AND proof->'schemaVersion'='2'::jsonb AND proof->'scope'=command.payload->'scope' AND proof->'capture'=capture
    AND proof->>'commandHash' ~ '^[a-f0-9]{64}$' AND proof->>'previousCommandHash' ~ '^[a-f0-9]{64}$'
    AND input ?& ARRAY['schemaVersion','operationId','mediaId','generation','scope']
    AND input-ARRAY['schemaVersion','operationId','mediaId','generation','scope']='{}'::jsonb
    AND input->'schemaVersion'='4'::jsonb AND input->>'operationId'=command.id AND input->>'mediaId'=command."targetId"
    AND input->'scope'=command.payload->'scope' AND input->'generation'=capture->'generation'
    AND (before-'coordinatorOperationId')=(media_movie_retry_native_snapshot_v2(attempt)-'coordinatorOperationId')
    AND before->'filePlan'=attempt."filePlan"
    AND before->>'coordinatorOperationId'=capture->>'previousCoordinatorOperationId'
    AND before->>'state'=proof->>'previousState' AND proof->>'previousState'=attempt.state
    AND proof->'root' ?& ARRAY['workflowId','runId','status'] AND (proof->'root')-ARRAY['workflowId','runId','status']='{}'::jsonb
    AND proof #>> '{root,workflowId}'='media-operation-'||(capture->>'previousCoordinatorOperationId')
    AND length(proof #>> '{root,runId}') BETWEEN 1 AND 200 AND proof #>> '{root,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND proof->'child' ?& ARRAY['workflowId','runId','status'] AND (proof->'child')-ARRAY['workflowId','runId','status']='{}'::jsonb
    AND proof #>> '{child,workflowId}'='media-acquire-'||attempt.id
    AND length(proof #>> '{child,runId}') BETWEEN 1 AND 200 AND proof #>> '{child,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND attempt."coordinatorOperationId"=command.id
    AND EXISTS (SELECT 1 FROM "AcquisitionAttempt" a WHERE a.id=attempt.id AND a.xmin::text=(txid_current()%4294967296)::text)
    AND (proof->>'observedAt')::timestamptz <= (proof->>'committedAt')::timestamptz
    AND (proof->>'committedAt')::timestamptz >= date_trunc('milliseconds',transaction_timestamp())
    AND (proof->>'committedAt')::timestamptz <= clock_timestamp()
    AND (proof->>'committedAt')::timestamptz < (proof->>'expiresAt')::timestamptz
    AND (proof->>'expiresAt')::timestamptz <= (proof->>'sdkExpiresAt')::timestamptz
    AND (proof->>'expiresAt')::timestamptz <= (proof->>'observedAt')::timestamptz+interval '60 seconds'
    AND current_setting('media.plex_deadline_ms',true)::numeric <= extract(epoch FROM (proof->>'expiresAt')::timestamptz)*1000
    AND writer."recoveryEpoch"=attempt."recoveryEpoch" AND writer."revokedAt" IS NULL
    AND writer."observedAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND writer."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
    AND ((proof->>'expiresAt')::timestamptz AT TIME ZONE 'UTC') <= writer."expiresAt",false)
  THEN RAISE EXCEPTION 'Movie continuation renewal requires its actual native before snapshot, closed predecessors and original deadlines'; END IF;
  PERFORM media_movie_retry_transfer_v2(proof,attempt);
  PERFORM media_plex_assert_deadline();
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_transfer_grant_check_v1(p_command "Operation") RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_envelope jsonb:=p_command.result->'movieTransferReuseGrantV1';
  v_grant jsonb:=v_envelope->'grant'; v_consumer jsonb:=v_grant->'consumer';
  v_origin jsonb:=v_grant->'origin'; v_transfer jsonb:=v_grant->'transfer'; v_scope jsonb:=v_grant->'scope';
  v_attempt "AcquisitionAttempt"; v_owner "AcquisitionAttempt"; v_torrent "Torrent";
  v_target "MediaIntent"; v_assessment "MovieReleaseAssessment"; v_old_assessment "MovieReleaseAssessment";
  v_release "ReleaseCandidate"; v_prior "Operation"; v_writer RECORD; v_participant "AcquisitionAttempt";
  v_marker jsonb; v_live jsonb;
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=v_consumer->>'attemptId';
  SELECT a.* INTO STRICT v_owner FROM "AcquisitionAttempt" a WHERE a.id=v_origin->>'attemptId';
  SELECT t.* INTO STRICT v_torrent FROM "Torrent" t WHERE t.id=v_transfer->>'id' FOR UPDATE;
  SELECT m.* INTO STRICT v_target FROM "MediaIntent" m WHERE m."mediaId"=v_scope->>'mediaId' AND m.edition=v_scope->>'edition';
  SELECT a.* INTO STRICT v_assessment FROM "MovieReleaseAssessment" a WHERE a.id=v_consumer->>'assessmentId';
  SELECT a.* INTO STRICT v_old_assessment FROM "MovieReleaseAssessment" a WHERE a.id=v_owner."identityEvidence" #>> '{assessment,id}';
  SELECT r.* INTO STRICT v_release FROM "ReleaseCandidate" r WHERE r.id=v_owner."releaseId";
  SELECT o.* INTO STRICT v_prior FROM "Operation" o WHERE o.id=v_owner."coordinatorOperationId";
  SELECT l.* INTO STRICT v_writer FROM media_runtime_proof_v1() l WHERE l.id='singleton';
  v_live:=v_torrent.observation->'torrent';
  IF NOT COALESCE(
    v_envelope ?& ARRAY['grant','grantHash'] AND v_envelope-ARRAY['grant','grantHash']='{}'::jsonb
    AND v_envelope->>'grantHash' ~ '^[a-f0-9]{64}$'
    AND v_grant ?& ARRAY['schemaVersion','scope','input','consumer','origin','transfer','root','child','observedAt','sdkExpiresAt','expiresAt','committedAt']
    AND v_grant-ARRAY['schemaVersion','scope','input','consumer','origin','transfer','root','child','observedAt','sdkExpiresAt','expiresAt','committedAt']='{}'::jsonb
    AND v_grant->'schemaVersion'='1'::jsonb
    AND v_scope ?& ARRAY['rootMediaId','mediaId','edition'] AND v_scope-ARRAY['rootMediaId','mediaId','edition']='{}'::jsonb
    AND v_scope->>'mediaId'=v_scope->>'rootMediaId' AND v_target."editionRootId"=v_scope->>'rootMediaId'
    AND EXISTS (SELECT 1 FROM "MediaItem" m WHERE m.id=v_scope->>'mediaId' AND m.kind='movie')
    AND v_grant->'input' ?& ARRAY['schemaVersion','operationId','attemptId','scope']
    AND (v_grant->'input')-ARRAY['schemaVersion','operationId','attemptId','scope']='{}'::jsonb
    AND v_grant #> '{input,schemaVersion}'='4'::jsonb AND v_grant #>> '{input,operationId}'=p_command.id
    AND v_grant #>> '{input,attemptId}'=v_attempt.id AND v_grant #> '{input,scope}'=v_scope
    AND v_consumer ?& ARRAY['attemptId','birthOperationId','birthHash','identityHash','generation','assessmentId','assessmentHash','profileId','profileVersion','access']
    AND v_consumer-ARRAY['attemptId','birthOperationId','birthHash','identityHash','generation','assessmentId','assessmentHash','profileId','profileVersion','access']='{}'::jsonb
    AND v_origin ?& ARRAY['attemptId','birthOperationId','coordinatorOperationId','birthHash','identityHash','sourceHash','releaseId']
    AND v_origin-ARRAY['attemptId','birthOperationId','coordinatorOperationId','birthHash','identityHash','sourceHash','releaseId']='{}'::jsonb
    AND v_consumer->>'birthHash' ~ '^[a-f0-9]{64}$' AND v_consumer->>'identityHash' ~ '^[a-f0-9]{64}$'
    AND v_origin->>'birthHash' ~ '^[a-f0-9]{64}$' AND v_origin->>'identityHash' ~ '^[a-f0-9]{64}$'
    AND v_attempt.id<>v_owner.id AND v_attempt."operationId"=p_command.id AND v_attempt."coordinatorOperationId"=p_command.id
    AND v_consumer->>'birthOperationId'=p_command.id AND v_owner."operationId"=v_origin->>'birthOperationId'
    AND v_owner."coordinatorOperationId"=v_origin->>'coordinatorOperationId'
    AND v_owner.state='cancelled' AND v_owner."filePlan" IS NULL AND v_attempt."filePlan" IS NULL AND v_attempt.state='downloading'
    AND v_attempt."torrentId"=v_torrent.id AND v_owner."torrentId"=v_torrent.id
    AND v_attempt.edition=v_scope->>'edition' AND v_owner.edition=v_attempt.edition
    AND cardinality(v_attempt."mediaIds")=1 AND v_attempt."mediaIds"=v_owner."mediaIds" AND v_attempt."mediaIds"[1]=v_scope->>'mediaId'
    AND v_attempt."identityEvidence"->>'schemaVersion' IN ('2','3') AND v_owner."identityEvidence"->>'schemaVersion' IN ('2','3')
    AND v_attempt."identityEvidence"->'scope'=v_scope AND v_owner."identityEvidence"->'scope'=v_scope
    AND v_attempt."identityEvidence"->'source'=v_owner."identityEvidence"->'source'
    AND v_attempt."releaseId"=v_owner."releaseId" AND v_owner."releaseId"=v_origin->>'releaseId'
    AND v_attempt."recoveryEpoch"=v_owner."recoveryEpoch" AND v_attempt."recoveryEpoch"=v_torrent."ownershipEpoch"
    AND v_torrent.owned AND v_torrent.state NOT IN ('removing','removed')
    AND v_torrent."infoHash"=v_release."sourceEvidence"->>'infoHash' AND v_torrent."providerId"=v_release."providerId"
    AND v_origin->>'sourceHash'=v_owner."identityEvidence" #>> '{source,candidateDigest}'
    AND v_old_assessment."sourceHash"=v_origin->>'sourceHash' AND v_old_assessment."releaseId"=v_release.id
    AND v_assessment."sourceHash"=v_origin->>'sourceHash' AND v_assessment."releaseId"=v_release.id
    AND v_assessment.assessment->'cut'=v_old_assessment.assessment->'cut'
    AND v_attempt."identityEvidence" #>> '{assessment,id}'=v_assessment.id
    AND v_attempt."identityEvidence" #>> '{assessment,hash}'=v_assessment."assessmentHash"
    AND v_consumer->>'assessmentHash'=v_assessment."assessmentHash"
    AND v_consumer->>'profileId'=v_assessment."profileId" AND v_consumer->'profileVersion'=to_jsonb(v_assessment."profileVersion")
    AND v_attempt.failure->>'profileId'=v_consumer->>'profileId' AND v_attempt.failure->'profileVersion'=v_consumer->'profileVersion'
    AND v_target."profileId"=v_consumer->>'profileId'
    AND EXISTS (SELECT 1 FROM "QualityProfile" p WHERE p.id=v_target."profileId" AND to_jsonb(p.version)=v_consumer->'profileVersion')
    AND v_target.monitoring AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL
    AND v_target."automationEpoch"=v_attempt."recoveryEpoch" AND to_jsonb(v_target.generation)=v_consumer->'generation'
    AND v_attempt.generations->(v_scope->>'mediaId')=v_consumer->'generation'
    AND p_command.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4') AND p_command."targetId"=v_scope->>'mediaId'
    AND p_command.payload->'scope'=v_scope AND p_command.payload->'generation'=v_consumer->'generation'
    AND p_command.payload->'recoveryEpoch'=to_jsonb(v_attempt."recoveryEpoch")
    AND NOT(COALESCE(p_command.payload,'{}'::jsonb) ?| ARRAY['movieRetryV1','movieRetryV2','movieRetryPlexAckV1'])
    AND v_prior.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4') AND v_prior.payload->'scope'=v_scope
    AND v_prior.payload->'generation'=v_owner.generations->(v_scope->>'mediaId')
    AND EXISTS (SELECT 1 FROM "AcquisitionReservation" r WHERE r."mediaId"=v_scope->>'mediaId' AND r.edition=v_attempt.edition AND r."attemptId"=v_attempt.id AND r.generation=v_target.generation)
    AND EXISTS (SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active' AND r."ownershipConfirmed" AND r."recoveryEpoch"=v_attempt."recoveryEpoch")
    AND EXISTS (SELECT 1 FROM "AcquisitionAttempt" a WHERE a.id=v_attempt.id AND a.xmin::text=(txid_current()%4294967296)::text)
    AND NOT EXISTS (SELECT 1 FROM "Operation" o WHERE o.id=v_owner."operationId" AND COALESCE(o.result,'{}'::jsonb)?'movieTransferReuseGrantV1')
    AND v_transfer ?& ARRAY['id','infoHash','qbittorrentId','providerId','ownershipEpoch','observationHash','savePath','contentPath','tags','category','policyHash']
    AND v_transfer-ARRAY['id','infoHash','qbittorrentId','providerId','ownershipEpoch','observationHash','savePath','contentPath','tags','category','policyHash']='{}'::jsonb
    AND v_transfer->>'infoHash'=v_torrent."infoHash" AND v_transfer->>'qbittorrentId'=v_torrent."qbittorrentId"
    AND v_transfer->>'providerId'=v_torrent."providerId" AND v_transfer->'ownershipEpoch'=to_jsonb(v_torrent."ownershipEpoch")
    AND v_transfer->>'observationHash' ~ '^[a-f0-9]{64}$' AND v_transfer->>'policyHash' ~ '^[a-f0-9]{64}$'
    AND v_transfer->>'savePath'=v_live->>'save_path' AND rtrim(v_transfer->>'savePath','/')='/downloads/media/'||v_owner.id
    AND v_transfer->>'contentPath'=v_live->>'content_path' AND starts_with(v_live->>'content_path',(v_transfer->>'savePath')||'/')
    AND v_transfer->>'tags'=v_live->>'tags' AND v_transfer->>'category'=v_live->>'category' AND v_transfer->>'category'='media'
    AND v_live->'ratio_limit'='-1'::jsonb AND v_live->'seeding_time_limit'='-1'::jsonb AND v_live->'inactive_seeding_time_limit'='-1'::jsonb
    AND v_live->'max_ratio'='-1'::jsonb AND v_live->'max_seeding_time'='-1'::jsonb AND v_live->'max_inactive_seeding_time'='-1'::jsonb
    AND v_live->>'share_limit_action'='Stop' AND v_live->'auto_tmm'='false'::jsonb AND v_live->'force_start'='false'::jsonb
    AND ARRAY(SELECT btrim(x.tag) FROM unnest(string_to_array(v_live->>'tags',',')) x(tag) WHERE btrim(x.tag) ~ '^media-[a-f0-9-]{36}$')=ARRAY['media-'||v_owner."operationId"]
    AND ARRAY(SELECT btrim(x.tag) FROM unnest(string_to_array(v_live->>'tags',',')) x(tag) WHERE btrim(x.tag) LIKE 'media-attempt-%')=ARRAY['media-attempt-'||v_owner.id]
    AND v_grant->'root' ?& ARRAY['workflowId','runId','status'] AND (v_grant->'root')-ARRAY['workflowId','runId','status']='{}'::jsonb
    AND v_grant #>> '{root,workflowId}'='media-operation-'||v_owner."coordinatorOperationId"
    AND length(v_grant #>> '{root,runId}') BETWEEN 1 AND 200 AND v_grant #>> '{root,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND v_grant->'child' ?& ARRAY['workflowId','runId','status'] AND (v_grant->'child')-ARRAY['workflowId','runId','status']='{}'::jsonb
    AND v_grant #>> '{child,workflowId}'='media-acquire-'||v_owner.id
    AND length(v_grant #>> '{child,runId}') BETWEEN 1 AND 200 AND v_grant #>> '{child,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
    AND v_writer."recoveryEpoch"=v_attempt."recoveryEpoch" AND v_writer."revokedAt" IS NULL
    AND v_writer."observedAt"<=clock_timestamp() AND v_writer."expiresAt">clock_timestamp()
    AND (v_grant->>'observedAt')::timestamptz<=(v_grant->>'committedAt')::timestamptz
    AND (v_grant->>'committedAt')::timestamptz>=date_trunc('milliseconds',transaction_timestamp())
    AND (v_grant->>'committedAt')::timestamptz<=clock_timestamp()
    AND (v_grant->>'committedAt')::timestamptz<(v_grant->>'expiresAt')::timestamptz
    AND (v_grant->>'expiresAt')::timestamptz<=v_writer."expiresAt"
    AND (v_grant->>'expiresAt')::timestamptz<=(v_grant->>'sdkExpiresAt')::timestamptz
    AND (v_grant->>'expiresAt')::timestamptz<=(v_grant->>'observedAt')::timestamptz+interval '60 seconds'
    AND v_torrent."observedAt">=(v_grant->>'observedAt')::timestamptz AND v_torrent."observedAt"<=clock_timestamp()
    AND current_setting('media.plex_deadline_ms',true)::numeric<=extract(epoch FROM (v_grant->>'expiresAt')::timestamptz)*1000,false)
  THEN RAISE EXCEPTION 'Movie transfer grant requires genuine current birth, exact original registered source and closed workflows within original deadlines'; END IF;
  PERFORM media_movie_transfer_consent_v1(v_attempt,v_grant);
  FOR v_participant IN SELECT a.* FROM "AcquisitionAttempt" a WHERE a."torrentId"=v_torrent.id AND a.id NOT IN (v_owner.id,v_attempt.id) LOOP
    SELECT o.result #> '{movieTransferReuseGrantV1,grant}' INTO v_marker FROM "Operation" o WHERE o.id=v_participant."operationId";
    IF NOT COALESCE(v_marker #>> '{origin,attemptId}'=v_owner.id AND v_marker #>> '{transfer,id}'=v_torrent.id
      AND v_marker #>> '{consumer,attemptId}'=v_participant.id AND v_marker->'scope'=v_scope
      AND v_participant."recoveryEpoch"=v_attempt."recoveryEpoch",false)
    THEN RAISE EXCEPTION 'Movie transfer source cohort has unknown or indirect ownership'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "LibraryAsset" a WHERE a."torrentId"=v_torrent.id AND (NOT a.owned OR a."ownershipEpoch"<>v_torrent."ownershipEpoch" OR a.edition<>v_scope->>'edition' OR a."editionRootId" IS DISTINCT FROM v_scope->>'mediaId'))
  THEN RAISE EXCEPTION 'Movie transfer source has a foreign physical participant'; END IF;
  PERFORM media_plex_assert_deadline();
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_rollback_rejection_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_envelope jsonb; v_proof jsonb; v_input jsonb; v_scope jsonb; v_expected jsonb; v_group jsonb;
  v_command "Operation"; v_attempt "AcquisitionAttempt"; v_publication "MediaPublicationTransition"; v_target "MediaIntent";
  v_runtime "MediaRuntimeState"; v_writer RECORD; v_profile "QualityProfile"; v_reservation "AcquisitionReservation";
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
  SELECT w.* INTO STRICT v_writer FROM media_runtime_proof_v1() w WHERE w.id='singleton';
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

CREATE OR REPLACE FUNCTION media_movie_automatic_rollback_plex_birth_v1(p_command "Operation",p_intent jsonb,p_physical jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_scope jsonb:=p_intent->'scope'; v_expected jsonb:=p_proof->'expected'; v_association jsonb:=p_proof#>'{observation,associations,0}';
  v_group jsonb:=p_proof#>'{expected,newGroups,0}'; v_binding jsonb:=p_proof->'binding'; v_verification jsonb:=p_proof#>'{observation,verification}';
  v_reference jsonb:=p_proof->'publication'; v_original "PlexAssociationEvidence"; v_evidence "PlexAssociationEvidence";
  v_attempt "AcquisitionAttempt"; v_target "MediaIntent"; v_runtime "MediaRuntimeState"; v_writer RECORD; v_media "MediaItem";
  v_pointer "PlexBindingCurrent"; v_claim "PlexClaimGroup"; v_member "PlexClaimGroupMember"; v_item "PlexItemClaim"; v_part "PlexPartClaim"; v_path "PlexPathClaim"; v_profile "QualityProfile";
  v_pointer_xmin text; v_evidence_xmin text; v_claim_xmin text; v_changed_captions text[]; v_capture record;
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT a.* INTO STRICT v_attempt FROM "AcquisitionAttempt" a WHERE a.id=p_intent#>>'{invocation,source,attemptId}';
  SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  SELECT w.* INTO STRICT v_writer FROM media_runtime_proof_v1() w WHERE w.id='singleton';
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

CREATE OR REPLACE FUNCTION media_movie_requested_rollback_playback_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m_envelope jsonb; m_guard jsonb; m_scope jsonb; m_input jsonb; m_review jsonb; m_expected jsonb;
  m_command "Operation"; m_source_command "Operation"; m_attempt "AcquisitionAttempt"; m_publication "MediaPublicationTransition";
  m_target "MediaIntent"; m_runtime "MediaRuntimeState"; m_writer RECORD; m_media "MediaItem";
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
  SELECT w.* INTO STRICT m_writer FROM media_runtime_proof_v1() w WHERE w.id='singleton';
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

CREATE OR REPLACE FUNCTION media_movie_requested_rollback_plex_birth_v1(p_command "Operation",p_intent jsonb,p_physical jsonb,p_proof jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_scope jsonb:=p_intent->'scope'; v_expected jsonb:=p_proof->'expected'; v_association jsonb:=p_proof#>'{observation,associations,0}';
  v_group jsonb:=p_proof#>'{expected,newGroups,0}'; v_binding jsonb:=p_proof->'binding'; v_verification jsonb:=p_proof#>'{observation,verification}';
  v_reference jsonb:=p_proof->'publication'; v_original "PlexAssociationEvidence"; v_evidence "PlexAssociationEvidence";
  v_attempt "AcquisitionAttempt"; v_target "MediaIntent"; v_runtime "MediaRuntimeState"; v_writer RECORD; v_media "MediaItem";
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
  SELECT w.* INTO STRICT v_writer FROM media_runtime_proof_v1() w WHERE w.id='singleton';
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

CREATE OR REPLACE FUNCTION media_movie_rollback_handoff_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h_envelope jsonb:=NEW.payload; h_body jsonb:=NEW.payload->'handoff'; h_scope jsonb:=NEW.payload#>'{handoff,scope}';
  h_original "Operation"; h_command "Operation"; h_intent jsonb; h_review jsonb; h_physical jsonb; h_previous "ApplicationEvent";
  h_media "MediaItem"; h_target "MediaIntent"; h_runtime "MediaRuntimeState"; h_profile "QualityProfile"; h_writer RECORD;
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
  SELECT w.* INTO STRICT h_writer FROM media_runtime_proof_v1() w WHERE w.id='singleton';
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

CREATE OR REPLACE FUNCTION media_movie_rollback_retry_playback_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h_envelope jsonb:=NEW.payload; h_guard jsonb:=NEW.payload->'guard'; h_original "Operation"; h_intent jsonb; h_scope jsonb;
  h_target "MediaIntent"; h_runtime "MediaRuntimeState"; h_profile "QualityProfile"; h_writer RECORD;
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
  SELECT w.* INTO STRICT h_writer FROM media_runtime_proof_v1() w WHERE w.id='singleton';
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
