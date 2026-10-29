-- Literal v1 association and acquisition receipt formats retain their original semantics.
ALTER TABLE "PlexAssociationEvidence" DROP CONSTRAINT "plex_evidence_shape";
ALTER TABLE "PlexAssociationEvidence" ADD CONSTRAINT "plex_evidence_shape" CHECK (COALESCE(
  "associationHash" ~ '^[a-f0-9]{64}$' AND evidence->'schemaVersion' IN ('1'::jsonb,'2'::jsonb)
  AND evidence #>> '{scope,mediaId}' = "mediaId" AND evidence #>> '{scope,edition}' = edition
  AND evidence #>> '{group,assetId}' = "assetId"
  AND evidence #>> '{access,serverMachineId}' = "serverMachineId", false));

CREATE FUNCTION media_movie_plex_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset "LibraryAsset"; definition "MediaEditionDefinition";
BEGIN
  IF NEW.evidence->>'schemaVersion' <> '2' THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=NEW."assetId";
  SELECT * INTO STRICT definition FROM "MediaEditionDefinition" WHERE "rootMediaId"=asset."editionRootId" AND key=NEW.edition;
  IF NOT COALESCE(NEW.evidence->>'kind'='movie' AND NEW.evidence #>> '{item,type}'='movie'
    AND NEW."mediaId"=asset."editionRootId" AND NEW.edition=asset.edition
    AND NEW.evidence->>'editionRootId'=asset."editionRootId"
    AND EXISTS (SELECT 1 FROM "MediaItem" WHERE id=NEW."mediaId" AND kind='movie')
    AND NEW.evidence #> '{item,editionTitle}'=CASE WHEN NEW.edition='default' THEN 'null'::jsonb ELSE to_jsonb(definition."plexLabel") END
    AND NEW.evidence #>> '{definition,key}'=definition.key
    AND NEW.evidence #>> '{definition,rootMediaId}'=definition."rootMediaId"
    AND NEW.evidence #> '{definition,definitionVersion}'=to_jsonb(definition."definitionVersion")
    AND NEW.evidence #>> '{group,canonicalRootId}'=asset."editionRootId"
    AND NEW.evidence #>> '{group,edition}'=NEW.edition
    AND NEW.evidence #> '{group,coverage}'=jsonb_build_array(jsonb_build_object('mediaId',NEW."mediaId",'edition',NEW.edition)),false)
  THEN RAISE EXCEPTION 'Movie Plex edition evidence differs from its exact registered scope'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_plex_evidence BEFORE INSERT ON "PlexAssociationEvidence" FOR EACH ROW EXECUTE FUNCTION media_movie_plex_evidence();

CREATE FUNCTION media_movie_plex_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; envelope JSONB; binding JSONB; association JSONB; attempt "AcquisitionAttempt"; publication "MediaPublicationTransition";
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'moviePlexReceiptV2' THEN RAISE EXCEPTION 'Committed movie Plex receipt is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'moviePlexReceiptV2' THEN
    IF NEW.result->'moviePlexReceiptV2' IS DISTINCT FROM OLD.result->'moviePlexReceiptV2'
      OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload) IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
    THEN RAISE EXCEPTION 'Committed movie Plex receipt or command is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'moviePlexReceiptV2') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope := NEW.result->'moviePlexReceiptV2'; proof := envelope->'receipt'; binding := proof->'binding'; association := proof #> '{observation,associations,0}';
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=proof #>> '{input,attemptId}';
  SELECT * INTO STRICT publication FROM "MediaPublicationTransition" WHERE "attemptId"=attempt.id;
  IF NOT COALESCE(envelope->>'receiptHash' ~ '^[a-f0-9]{64}$' AND proof->'schemaVersion'='2'::jsonb
    AND proof #> '{input,schemaVersion}'='4'::jsonb AND proof #>> '{input,operationId}'=NEW.id
    AND NEW.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4') AND NEW."targetId"=attempt."mediaIds"[1]
    AND attempt.state IN ('imported','completed') AND attempt."coordinatorOperationId"=NEW.id
    AND cardinality(attempt."mediaIds")=1 AND proof #> '{input,scope}'=attempt."filePlan"->'scope'
    AND proof #> '{input,scope}'=attempt."identityEvidence"->'scope'
    AND proof #>> '{attempt,operationId}'=attempt."operationId" AND proof #>> '{attempt,coordinatorOperationId}'=NEW.id
    AND proof #>> '{attempt,releaseId}'=attempt."releaseId" AND proof #>> '{attempt,sponsorRequestId}'=attempt."sponsorRequestId"
    AND proof #>> '{attempt,torrentId}'=attempt."torrentId" AND proof #> '{attempt,recoveryEpoch}'=to_jsonb(attempt."recoveryEpoch")
    AND proof #>> '{publication,transitionId}'=publication.id AND proof #>> '{publication,intentHash}'=publication."intentHash"
    AND proof #>> '{publication,outcomeHash}'=publication."outcomeHash" AND publication.outcome->>'kind'='published'
    AND association->'schemaVersion'='2'::jsonb AND association->>'kind'='movie'
    AND association->'scope'=binding->'scope' AND association #>> '{scope,mediaId}'=NEW."targetId"
    AND association #>> '{scope,edition}'=attempt.edition
    AND association #>> '{group,assetId}'=attempt."filePlan" #>> '{entries,0,assetId}'
    AND association #>> '{group,checksum}'=attempt."filePlan" #>> '{entries,0,checksum}'
    AND association #>> '{group,sizeBytes}'=attempt."filePlan" #>> '{entries,0,sizeBytes}'
    AND EXISTS (SELECT 1 FROM "LibraryAsset" a WHERE a.id=association #>> '{group,assetId}'
      AND a."plexPublishedAt"=((proof->>'publishedAt')::timestamptz AT TIME ZONE 'UTC'))
    AND jsonb_array_length(proof #> '{observation,associations}')=1
    AND proof #>> '{command,kind}'=NEW.kind AND proof #>> '{command,targetId}'=NEW."targetId"
    AND (proof #>> '{command,userId}') IS NOT DISTINCT FROM NEW."userId"
    AND (proof->>'committedAt')::timestamptz <= clock_timestamp()
    AND (proof->>'committedAt')::timestamptz >= (proof #>> '{observation,verification,completedAt}')::timestamptz
    AND (proof->>'committedAt')::timestamptz < (proof #>> '{observation,verification,expiresAt}')::timestamptz,false)
  THEN RAISE EXCEPTION 'Movie Plex receipt lost its exact command, attempt, physical publication or verification'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "PlexBindingCurrent" c JOIN "PlexAssociationEvidence" e ON e.id=c."evidenceId"
    WHERE c."mediaId"=binding #>> '{scope,mediaId}' AND c.edition=binding #>> '{scope,edition}'
    AND c."evidenceId"=binding->>'evidenceId' AND c."associationHash"=binding->>'associationHash' AND to_jsonb(c.revision)=binding->'revision'
    AND e.evidence=association AND c.xmin::text=(txid_current() % 4294967296)::text)
  THEN RAISE EXCEPTION 'Movie Plex receipt requires the same-transaction exact scoped binding'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_plex_receipt BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_movie_plex_receipt();
