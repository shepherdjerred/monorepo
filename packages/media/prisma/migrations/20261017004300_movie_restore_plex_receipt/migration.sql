-- A new serving completion binds actual restored bytes; original acquisition/library/Plex records stay literal.
CREATE FUNCTION media_movie_restore_plex_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE envelope jsonb; proof jsonb; physical jsonb; selected jsonb; expected jsonb; association jsonb; binding jsonb;
  group_value jsonb; previous jsonb; source jsonb; verification jsonb;
  asset "LibraryAsset"; target "MediaIntent"; runtime "MediaRuntimeState"; evidence "PlexAssociationEvidence";
  writer "LegacyWriterLease";
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
  SELECT * INTO STRICT writer FROM "LegacyWriterLease" WHERE id='singleton';
  SELECT * INTO STRICT evidence FROM "PlexAssociationEvidence" WHERE id=binding->>'evidenceId';
  IF NOT COALESCE(asset.state='published' AND asset.owned AND asset.edition=selected->>'edition' AND asset."editionRootId"=selected->>'rootMediaId'
    AND asset.id=group_value->>'assetId' AND to_jsonb(asset.version)=group_value->'assetVersion'
    AND group_value->'assetVersion'=physical #> '{after,version}' AND group_value->>'checksum'=asset.checksum
    AND group_value->>'canonicalPath'=asset.path AND group_value->>'sizeBytes'=asset."sizeBytes"::text
    AND group_value->'ownershipEpoch'=to_jsonb(asset."ownershipEpoch") AND group_value->'ownershipEpoch'=expected->'recoveryEpoch'
    AND group_value->>'canonicalRootId'=selected->>'rootMediaId' AND group_value->>'edition'=selected->>'edition'
    AND group_value->'coverage'=jsonb_build_array(selected-'rootMediaId')
    AND (asset."plexPublishedAt") IS NOT DISTINCT FROM (proof->>'assetPlexPublishedAt')::timestamptz
    AND target.availability='available' AND target."desiredPresence" AND target.monitoring AND target."intentionallyRemovedAt" IS NULL
    AND target."editionRootId"=selected->>'rootMediaId' AND to_jsonb(target.generation)=proof #> '{input,generation}'
    AND to_jsonb(target.version)=expected #> '{targets,0,intentVersion}'
    AND to_jsonb(target."automationEpoch")=expected->'recoveryEpoch' AND to_jsonb(runtime."recoveryEpoch")=expected->'recoveryEpoch'
    AND runtime.mode='active' AND runtime."ownershipConfirmed"
    AND writer."revokedAt" IS NULL AND writer."recoveryEpoch"=runtime."recoveryEpoch"
    AND writer."observedAt"<=clock_timestamp() AND writer."expiresAt">clock_timestamp()
    AND writer."expiresAt"=(proof->>'writerExpiresAt')::timestamptz
    AND evidence.evidence=association AND evidence."associationHash"=binding->>'associationHash'
    AND evidence."assetId"=asset.id AND evidence."mediaId"=NEW."targetId" AND evidence.edition=selected->>'edition'
    AND evidence."serverMachineId"=association #>> '{access,serverMachineId}'
    AND EXISTS (SELECT 1 FROM "PlexAssociationEvidence" WHERE id=evidence.id AND xmin::text=(txid_current()%4294967296)::text)
    AND EXISTS (SELECT 1 FROM "MediaIntent" WHERE "mediaId"=NEW."targetId" AND edition=selected->>'edition' AND xmin::text=(txid_current()%4294967296)::text)
    AND EXISTS (SELECT 1 FROM "PlexBindingCurrent" p WHERE p."mediaId"=NEW."targetId" AND p.edition=selected->>'edition'
      AND p."evidenceId"=evidence.id AND p."associationHash"=evidence."associationHash" AND to_jsonb(p.revision)=binding->'revision'
      AND p."verifiedStartedAt"=(verification->>'startedAt')::timestamptz AND p."verifiedCompletedAt"=(verification->>'completedAt')::timestamptz
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
CREATE TRIGGER movie_restore_plex_receipt_v1 BEFORE INSERT OR UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_movie_restore_plex_receipt_v1();
