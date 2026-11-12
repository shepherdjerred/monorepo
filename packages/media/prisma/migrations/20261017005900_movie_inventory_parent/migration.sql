-- A current scoped movie association has its own immutable physical parent.
-- The original ordinary/default branch below is retained verbatim.
CREATE OR REPLACE FUNCTION media_plex_verification_request_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation"; movie_parent jsonb; movie_target jsonb; movie_pointer jsonb; movie_group jsonb;
  movie_access jsonb; movie_scope jsonb; movie_reference jsonb; reference_keys text[];
  movie_asset "LibraryAsset"; current_pointer "PlexBindingCurrent"; current_evidence "PlexAssociationEvidence";
BEGIN
  IF jsonb_typeof(NEW.expected->'targets') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.expected->'previous') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.expected->'oldGroups') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.expected->'newGroups') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.expected->'parents') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Plex verification expected arrays are required';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.expected->'parents') p WHERE p->>'kind'='existing_movie_asset_v2') THEN
    IF jsonb_array_length(NEW.expected->'parents')<>1
      OR jsonb_typeof(NEW.expected->'access') IS DISTINCT FROM 'array'
      OR jsonb_array_length(NEW.expected->'targets')<>1
      OR jsonb_array_length(NEW.expected->'previous')<>1
      OR jsonb_array_length(NEW.expected->'oldGroups')<>1
      OR jsonb_array_length(NEW.expected->'newGroups')<>1
      OR jsonb_array_length(NEW.expected->'access')<>1 THEN
      RAISE EXCEPTION 'Scoped movie verification requires one complete physical target';
    END IF;
    movie_parent:=NEW.expected#>'{parents,0}'; movie_target:=NEW.expected#>'{targets,0}';
    movie_pointer:=NEW.expected#>'{previous,0}'; movie_group:=NEW.expected#>'{newGroups,0}';
    movie_access:=NEW.expected#>'{access,0}'; movie_scope:=movie_parent->'scope';
    movie_reference:=movie_parent->'physicalGrant';
    SELECT * INTO STRICT movie_asset FROM "LibraryAsset" WHERE id=movie_parent->>'assetId';
    SELECT * INTO STRICT current_pointer FROM "PlexBindingCurrent"
      WHERE "mediaId"=movie_asset."editionRootId" AND edition=movie_asset.edition;
    SELECT * INTO STRICT current_evidence FROM "PlexAssociationEvidence" WHERE id=current_pointer."evidenceId";
    IF NOT COALESCE(movie_parent ?& ARRAY['kind','scope','assetId','assetVersion','recoveryEpoch','physicalGrant']
      AND movie_parent-ARRAY['kind','scope','assetId','assetVersion','recoveryEpoch','physicalGrant']='{}'::jsonb
      AND NEW.expected->'schemaVersion'='1'::jsonb
      AND NEW.expected->'recoveryEpoch'=to_jsonb(NEW."recoveryEpoch")
      AND movie_parent->'recoveryEpoch'=to_jsonb(NEW."recoveryEpoch")
      AND movie_parent->'assetVersion'=to_jsonb(movie_asset.version)
      AND movie_asset."ownershipEpoch"=NEW."recoveryEpoch"
      AND movie_asset.edition IN ('default','theatrical_cut','directors_cut','extended_cut','final_cut','unrated_cut','uncut_version')
      AND movie_asset.checksum ~ '^[a-f0-9]{64}$'
      AND media_movie_replacement_scope_v2(movie_asset,movie_scope)
      AND movie_target->'scope'=jsonb_build_object('mediaId',movie_asset."editionRootId",'edition',movie_asset.edition)
      AND movie_target->>'editionRootId'=movie_asset."editionRootId"
      AND movie_target#>>'{definition,rootMediaId}'=movie_asset."editionRootId"
      AND movie_target#>>'{definition,key}'=movie_asset.edition
      AND EXISTS(SELECT 1 FROM "MediaEditionDefinition" d WHERE d."rootMediaId"=movie_asset."editionRootId"
        AND d.key=movie_asset.edition AND to_jsonb(d."definitionVersion")=movie_target#>'{definition,definitionVersion}')
      AND EXISTS(SELECT 1 FROM "MediaItem" m JOIN "MediaIntent" i ON i."mediaId"=m.id
        WHERE m.id=movie_asset."editionRootId" AND m.kind='movie' AND i.edition=movie_asset.edition
          AND i."editionRootId"=m.id AND to_jsonb(m.version)=movie_target->'mediaVersion'
          AND to_jsonb(i.version)=movie_target->'intentVersion' AND to_jsonb(i.generation)=movie_target->'generation'
          AND to_jsonb(i."automationEpoch")=movie_target->'automationEpoch' AND i."automationEpoch"=NEW."recoveryEpoch")
      AND EXISTS(SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton'
        AND r.mode='active' AND r."ownershipConfirmed" AND r."recoveryEpoch"=NEW."recoveryEpoch")
      AND EXISTS(SELECT 1 FROM media_runtime_proof_v1() r WHERE r."recoveryEpoch"=NEW."recoveryEpoch"
        AND r."revokedAt" IS NULL AND r."observedAt"<=clock_timestamp() AND r."expiresAt">clock_timestamp())
      AND movie_pointer->'scope'=movie_target->'scope' AND movie_pointer->'revision'=to_jsonb(current_pointer.revision)
      AND movie_pointer#>>'{evidence,id}'=current_evidence.id
      AND movie_pointer#>>'{evidence,associationHash}'=current_evidence."associationHash"
      AND current_pointer."associationHash"=current_evidence."associationHash"
      AND current_evidence."assetId"=movie_asset.id AND current_evidence."mediaId"=movie_asset."editionRootId" AND current_evidence.edition=movie_asset.edition
      AND current_evidence.evidence->'schemaVersion'='2'::jsonb AND current_evidence.evidence->'scope'=movie_target->'scope'
      AND current_evidence.evidence->>'editionRootId'=movie_asset."editionRootId"
      AND current_evidence.evidence->'group'=movie_group AND current_evidence.evidence->'access'=movie_access
      AND movie_access->>'sectionType'='movie' AND movie_access->>'sectionId' ~ '^[1-9][0-9]{0,19}$'
      AND movie_access->>'serverMachineId'=current_evidence."serverMachineId"
      AND NEW.expected#>'{oldGroups,0}'=movie_group
      AND movie_group->>'assetId'=movie_asset.id AND movie_group->'assetVersion'=to_jsonb(movie_asset.version)
      AND movie_group->'ownershipEpoch'=to_jsonb(movie_asset."ownershipEpoch")
      AND movie_group->>'canonicalRootId'=movie_asset."editionRootId" AND movie_group->>'edition'=movie_asset.edition
      AND movie_group->>'canonicalPath'=movie_asset.path AND movie_group->>'checksum'=movie_asset.checksum
      AND movie_group->>'sizeBytes'=movie_asset."sizeBytes"::text
      AND movie_group->'coverage'=jsonb_build_array(movie_target->'scope')
      AND NEW."assetIds"=ARRAY[movie_asset.id],false) THEN
      RAISE EXCEPTION 'Scoped movie verification lost its exact current owned association';
    END IF;
    reference_keys:=CASE movie_reference->>'kind'
      WHEN 'movie_publication_transition_v2' THEN ARRAY['kind','scope','assetId','assetVersion','bindingHash','physicalEvidenceHash','transitionId','intentHash','outcomeHash']
      WHEN 'movie_library_adoption_v2' THEN ARRAY['kind','scope','assetId','assetVersion','bindingHash','physicalEvidenceHash','receiptId','planId','planHash']
      WHEN 'movie_restore_publication_v1' THEN ARRAY['kind','scope','assetId','assetVersion','bindingHash','physicalEvidenceHash','operationId','receiptHash']
      WHEN 'movie_rollback_publication_v1' THEN ARRAY['kind','scope','assetId','assetVersion','bindingHash','physicalEvidenceHash','operationId','intentId','intentHash','physicalHash']
      ELSE NULL END;
    IF NOT COALESCE(reference_keys IS NOT NULL AND movie_reference ?& reference_keys
      AND movie_reference-(reference_keys||ARRAY['subtitleLineage'])='{}'::jsonb
      AND movie_reference->'scope'=movie_scope AND movie_reference->>'assetId'=movie_asset.id
      AND movie_reference->'assetVersion'=to_jsonb(movie_asset.version)
      AND movie_reference->>'bindingHash' ~ '^[a-f0-9]{64}$'
      AND movie_reference->>'physicalEvidenceHash' ~ '^[a-f0-9]{64}$'
      AND (NOT movie_reference ? 'subtitleLineage' OR jsonb_typeof(movie_reference->'subtitleLineage')='object')
      AND media_movie_subtitle_parent(movie_reference,movie_asset,movie_scope)
      AND (movie_reference->>'kind'<>'movie_publication_transition_v2' OR EXISTS(
        SELECT 1 FROM "MediaPublicationTransition" p WHERE p.id=movie_reference->>'transitionId'
          AND p.outcome#>'{entries,0,successor,version}'=to_jsonb(movie_asset.version)
          AND p.outcome#>>'{entries,0,successor,path}'=movie_asset.path
          AND p.outcome#>>'{entries,0,successor,sizeBytes}'=movie_asset."sizeBytes"::text
          AND p.outcome#>'{entries,0,successor,ownershipEpoch}'=to_jsonb(movie_asset."ownershipEpoch"))),false) THEN
      RAISE EXCEPTION 'Scoped movie verification requires its actual typed physical reference';
    END IF;
  ELSE
  IF jsonb_array_length(NEW.expected->'targets') NOT BETWEEN 1 AND 10000
    OR jsonb_array_length(NEW.expected->'previous') <> jsonb_array_length(NEW.expected->'targets')
    OR jsonb_array_length(NEW.expected->'oldGroups') > 100
    OR jsonb_array_length(NEW.expected->'newGroups') NOT BETWEEN 1 AND 100
    OR jsonb_array_length(NEW.expected->'parents') NOT BETWEEN 1 AND 100
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.expected->'targets') target
      WHERE target #>> '{scope,edition}' IS DISTINCT FROM 'default'
        OR target #>> '{definition,key}' IS DISTINCT FROM 'default'
        OR target #>> '{scope,mediaId}' IS NULL
        OR target->>'editionRootId' IS NULL
        OR target #>> '{definition,rootMediaId}' IS DISTINCT FROM target->>'editionRootId')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.expected->'previous') pointer
      WHERE pointer #>> '{scope,edition}' IS DISTINCT FROM 'default') THEN
    RAISE EXCEPTION 'Cold Plex verification admits complete default targets only';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements((NEW.expected->'oldGroups') || (NEW.expected->'newGroups')) physical
    WHERE physical->>'edition' IS DISTINCT FROM 'default'
      OR jsonb_typeof(physical->'coverage') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Cold Plex verification admits complete default groups only';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements((NEW.expected->'oldGroups') || (NEW.expected->'newGroups')) physical
    WHERE jsonb_array_length(physical->'coverage') NOT BETWEEN 1 AND 10000
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(physical->'coverage') member
        WHERE member->>'edition' IS DISTINCT FROM 'default' OR member->>'mediaId' IS NULL))
    OR NEW."assetIds" IS DISTINCT FROM ARRAY(SELECT physical->>'assetId'
      FROM jsonb_array_elements(NEW.expected->'newGroups') physical ORDER BY physical->>'assetId')
    OR NEW."assetIds" IS DISTINCT FROM ARRAY(SELECT DISTINCT asset FROM unnest(NEW."assetIds") asset ORDER BY asset) THEN
    RAISE EXCEPTION 'Cold Plex verification command coverage changed';
  END IF;
  END IF;
  SELECT * INTO STRICT command FROM "Operation" WHERE id=NEW."operationId";
  IF command.kind <> 'reverify_plex_binding'
    OR command.payload IS DISTINCT FROM jsonb_build_object(
      'schemaVersion',1,'kind','reverify_plex_binding','operationId',NEW."operationId",
      'recoveryEpoch',NEW."recoveryEpoch",'assetIds',to_jsonb(NEW."assetIds")) THEN
    RAISE EXCEPTION 'Plex verification request does not match its exact command';
  END IF;
  IF movie_parent IS NOT NULL AND command."targetId" IS DISTINCT FROM movie_asset.id THEN
    RAISE EXCEPTION 'Scoped movie verification command targets another asset';
  END IF;
  RETURN NEW;
END;
$$;
