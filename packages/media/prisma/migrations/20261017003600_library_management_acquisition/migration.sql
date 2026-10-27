-- New acquisitions may use actual owner-approved library policy. No historical
-- request, choice, acquisition, authority JSON or receipt is updated/backfilled.
ALTER TABLE "AcquisitionAttempt" ALTER COLUMN "sponsorRequestId" DROP NOT NULL;
ALTER TABLE "AcquisitionAttempt" ADD CONSTRAINT managed_attempt_sponsor CHECK (
  "sponsorRequestId" IS NOT NULL OR COALESCE(
    "identityEvidence"->>'schemaVersion'='3'
    AND "identityEvidence"->'management'="movieEditionAuthority"
    AND "movieEditionAuthority"->>'kind'='library_management'
    AND "movieEditionAuthority"->>'schemaVersion'='2'
    AND "movieEditionChoiceId" IS NULL AND "movieEditionChoiceRevision" IS NULL, false)
);

CREATE FUNCTION media_managed_movie_birth() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; approval "MediaHandoffReceipt"; target "MediaIntent";
  selected JSONB; imported JSONB; association "PlexAssociationEvidence";
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW."releaseId",NEW."sponsorRequestId",NEW."mediaIds",NEW.edition,
        NEW."operationId",NEW."createdAt",NEW."movieEditionChoiceId",NEW."movieEditionChoiceRevision",NEW."movieEditionAuthority")
      IS DISTINCT FROM
       (OLD.id,OLD."releaseId",OLD."sponsorRequestId",OLD."mediaIds",OLD.edition,
        OLD."operationId",OLD."createdAt",OLD."movieEditionChoiceId",OLD."movieEditionChoiceRevision",OLD."movieEditionAuthority")
    THEN RAISE EXCEPTION 'Managed acquisition birth is immutable'; END IF;
    RETURN NEW;
  END IF;
  NEW."createdAt" := clock_timestamp();
  proof := NEW."movieEditionAuthority";
  SELECT * INTO STRICT approval FROM "MediaHandoffReceipt" WHERE id=proof->>'receiptId';
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=proof->>'mediaId' AND edition=NEW.edition;
  SELECT * INTO STRICT association FROM "PlexAssociationEvidence" WHERE id=proof#>>'{binding,evidenceId}';
  SELECT item INTO STRICT selected FROM jsonb_array_elements(approval.selection#>'{scope,media}') item WHERE item->>'mediaId'=target."mediaId";
  SELECT item INTO STRICT imported FROM jsonb_array_elements(approval.selection#>'{scope,targets}') item WHERE item->>'mediaId'=target."mediaId" AND item->>'edition'=NEW.edition;
  IF NOT COALESCE(NEW."sponsorRequestId" IS NULL AND NEW."movieEditionChoiceId" IS NULL AND NEW."movieEditionChoiceRevision" IS NULL
    AND NEW."identityEvidence"->'management'=proof AND proof->>'schemaVersion'='2' AND proof->>'kind'='library_management'
    AND proof ?& ARRAY['schemaVersion','kind','rootMediaId','mediaId','edition','receiptId','planId','planHash','selectionHash','actorId','serverMachineId','sectionId','binding','profileId','profileVersionAtCapture','targetGenerationAtCapture','birthEpoch']
    AND proof - ARRAY['schemaVersion','kind','rootMediaId','mediaId','edition','receiptId','planId','planHash','selectionHash','actorId','serverMachineId','sectionId','binding','profileId','profileVersionAtCapture','targetGenerationAtCapture','birthEpoch']='{}'::jsonb
    AND proof->>'selectionHash' ~ '^[a-f0-9]{64}$'
    AND proof#>'{binding,scope}'=jsonb_build_object('mediaId',target."mediaId",'edition',NEW.edition)
    AND cardinality(NEW."mediaIds")=1 AND NEW."mediaIds"[1]=target."mediaId"
    AND proof->>'rootMediaId'=target."mediaId" AND target."editionRootId"=target."mediaId" AND proof->>'edition'=NEW.edition
    AND EXISTS (SELECT 1 FROM "MediaItem" WHERE id=target."mediaId" AND kind='movie')
    AND EXISTS (SELECT 1 FROM "MediaUser" WHERE id=approval."actorId" AND role='owner' AND NOT restricted)
    AND selected->'monitored'='true'::jsonb AND target.monitoring AND target."desiredPresence" AND target."intentionallyRemovedAt" IS NULL
    AND selected->>'profileId'=target."profileId" AND proof->>'profileId'=target."profileId"
    AND EXISTS (SELECT 1 FROM "QualityProfile" WHERE id=target."profileId" AND to_jsonb(version)=proof->'profileVersionAtCapture')
    AND approval."recoveryEpoch"=NEW."recoveryEpoch" AND target."automationEpoch"=NEW."recoveryEpoch" AND proof->'birthEpoch'=to_jsonb(NEW."recoveryEpoch")
    AND approval."planId"=proof->>'planId' AND approval."planHash"=proof->>'planHash' AND approval."actorId"=proof->>'actorId'
    AND proof->'targetGenerationAtCapture'=to_jsonb(target.generation) AND NEW.generations->target."mediaId"=to_jsonb(target.generation)
    AND association."mediaId"=target."mediaId" AND association.edition=NEW.edition
    AND association."associationHash"=proof#>>'{binding,associationHash}' AND association."serverMachineId"=proof->>'serverMachineId'
    AND association.evidence#>>'{access,sectionId}'=proof->>'sectionId'
    AND EXISTS (SELECT 1 FROM "PlexBindingCurrent" b WHERE b."mediaId"=target."mediaId" AND b.edition=NEW.edition AND b."evidenceId"=association.id AND to_jsonb(b.revision)=proof#>'{binding,revision}')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(approval.selection#>'{scope,files}') f WHERE f->>'libraryKind'='movies' AND f->>'edition'=NEW.edition AND f->'mediaIds'=jsonb_build_array(target."mediaId"))
    AND EXISTS (SELECT 1 FROM "MediaHandoffPlan" p WHERE p.id=approval."planId" AND p.state='applied' AND p."planHash"=approval."planHash"),false)
  THEN RAISE EXCEPTION 'Managed acquisition requires exact current owner-approved library policy'; END IF;
  RETURN NEW;
END;
$$;

-- Old trigger functions retain their exact request-only semantics and are
-- selected for every existing identity version. New identities have new gates.
DROP TRIGGER movie_attempt_choice ON "AcquisitionAttempt";
CREATE TRIGGER movie_attempt_choice BEFORE INSERT OR UPDATE ON "AcquisitionAttempt" FOR EACH ROW
  WHEN (NEW."identityEvidence"->>'schemaVersion' IS DISTINCT FROM '3') EXECUTE FUNCTION media_movie_attempt_choice();
CREATE TRIGGER managed_movie_birth BEFORE INSERT OR UPDATE ON "AcquisitionAttempt" FOR EACH ROW
  WHEN (NEW."identityEvidence"->>'schemaVersion'='3') EXECUTE FUNCTION media_managed_movie_birth();

ALTER TABLE "AcquisitionAttempt" DROP CONSTRAINT "movie_attempt_choice_shape";
ALTER TABLE "AcquisitionAttempt" ADD CONSTRAINT "movie_attempt_choice_shape" CHECK (
  ("movieEditionChoiceId" IS NULL AND "movieEditionChoiceRevision" IS NULL AND "movieEditionAuthority" IS NULL)
  OR ("movieEditionChoiceId" IS NOT NULL AND "movieEditionChoiceRevision" > 0 AND COALESCE(
    jsonb_typeof("movieEditionAuthority") = 'object'
    AND "movieEditionAuthority" ?& ARRAY['schemaVersion','choiceId','choiceRevision','sponsorRequestId','requestVersionAtCapture','rootMediaId','mediaId','edition','definitionVersion','definitionDigest','targetGenerationAtCapture','actorId','subjectUserId']
    AND "movieEditionAuthority" - ARRAY['schemaVersion','choiceId','choiceRevision','sponsorRequestId','requestVersionAtCapture','rootMediaId','mediaId','edition','definitionVersion','definitionDigest','targetGenerationAtCapture','actorId','subjectUserId'] = '{}'::jsonb
    AND "movieEditionAuthority"->'schemaVersion' = '1'::jsonb
    AND "movieEditionAuthority"->>'choiceId' = "movieEditionChoiceId"
    AND "movieEditionAuthority"->'choiceRevision' = to_jsonb("movieEditionChoiceRevision")
    AND "movieEditionAuthority"->>'definitionDigest' ~ '^[a-f0-9]{64}$', false))
  OR COALESCE("sponsorRequestId" IS NULL AND "movieEditionChoiceId" IS NULL AND "movieEditionChoiceRevision" IS NULL
    AND "identityEvidence"->>'schemaVersion'='3' AND "identityEvidence"->'management'="movieEditionAuthority"
    AND "movieEditionAuthority"->>'schemaVersion'='2' AND "movieEditionAuthority"->>'kind'='library_management',false)
);

CREATE FUNCTION media_managed_movie_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessed "MovieReleaseAssessment"%ROWTYPE; coordinator_kind TEXT; proof JSONB;
BEGIN
  proof := NEW."identityEvidence";
  SELECT kind INTO coordinator_kind FROM "Operation" WHERE id = COALESCE(NEW."coordinatorOperationId", NEW."operationId");
  IF coordinator_kind IN ('reconcile_movie_edition_v4', 'acquire_movie_edition_v4') OR proof->>'schemaVersion' = '3' THEN
    IF (proof->>'schemaVersion' = '3' AND coordinator_kind IN ('reconcile_movie_edition_v4', 'acquire_movie_edition_v4')) IS NOT TRUE THEN
      RAISE EXCEPTION 'V4 movie attempt requires versioned assessment identity';
    END IF;
    SELECT * INTO STRICT assessed FROM "MovieReleaseAssessment" WHERE id = proof#>>'{assessment,id}';
    IF (cardinality(NEW."mediaIds") = 1
      AND assessed."releaseId" = NEW."releaseId" AND assessed."mediaId" = NEW."mediaIds"[1] AND assessed.edition = NEW.edition
      AND assessed."assessmentHash" = proof#>>'{assessment,hash}'
      AND proof->'scope' = assessed.assessment->'scope' AND proof->'canonical' = assessed.assessment->'canonical'
      AND proof#>>'{source,releaseId}' = NEW."releaseId" AND proof#>>'{source,candidateDigest}' = assessed."sourceHash"
      AND proof->'coverage' = jsonb_build_array(assessed."mediaId")
      AND (NEW."sponsorRequestId" IS NULL AND proof->'management'=NEW."movieEditionAuthority") AND proof->'birthEpoch' = to_jsonb(NEW."recoveryEpoch")
      AND assessed.assessment#>>'{attributes,identityConfidence}' = 'exact'
      AND assessed.assessment#>'{attributes,mediaIds}' = jsonb_build_array(assessed."mediaId")
      AND ((assessed.edition = 'default' AND assessed.assessment#>>'{cut,conclusion,kind}' = 'standard_unmarked')
        OR (assessed.edition <> 'default' AND assessed.assessment#>>'{cut,conclusion,kind}' = 'named'
          AND assessed.assessment#>>'{cut,conclusion,cut}' = assessed.edition))) IS NOT TRUE
    THEN RAISE EXCEPTION 'V4 movie attempt assessment scope or identity mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER movie_attempt_assessment ON "AcquisitionAttempt";
CREATE TRIGGER movie_attempt_assessment BEFORE INSERT ON "AcquisitionAttempt" FOR EACH ROW WHEN (NEW."identityEvidence"->>'schemaVersion' IS DISTINCT FROM '3') EXECUTE FUNCTION media_movie_attempt_assessment();
CREATE TRIGGER managed_movie_assessment BEFORE INSERT ON "AcquisitionAttempt" FOR EACH ROW WHEN (NEW."identityEvidence"->>'schemaVersion'='3') EXECUTE FUNCTION media_managed_movie_assessment();

CREATE FUNCTION media_managed_movie_file_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan JSONB; entry JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."filePlan"->>'schemaVersion' = '3' AND NEW."filePlan" IS DISTINCT FROM OLD."filePlan" THEN
    RAISE EXCEPTION 'Versioned movie file plan is immutable';
  END IF;
  plan := NEW."filePlan";
  IF plan IS NOT NULL AND plan->>'schemaVersion' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'Managed movie requires its versioned file plan'; END IF;
  IF plan->>'schemaVersion' = '3' THEN
    entry := plan#>'{entries,0}';
    IF (NEW."identityEvidence"->>'schemaVersion' = '3'
      AND plan->>'attemptId' = NEW.id AND plan->'scope' = NEW."identityEvidence"->'scope'
      AND plan->'birth' = NEW."movieEditionAuthority"
      AND jsonb_typeof(plan->'entries') = 'array' AND jsonb_array_length(plan->'entries') = 1
      AND cardinality(NEW."mediaIds") = 1 AND entry->'mediaIds' = jsonb_build_array(NEW."mediaIds"[1])
      AND entry->>'libraryKind' = 'movies' AND entry#>>'{identityEvidence,parsedCoordinates,kind}' = 'movie'
      AND entry#>'{identityEvidence,coverage}' = entry->'mediaIds'
      AND entry#>'{identityEvidence,sourceFile,sizeBytes}' = entry->'sizeBytes'
      AND entry#>'{generations}' = NEW.generations
      AND entry#>'{generations}'->NEW."mediaIds"[1] = NEW."movieEditionAuthority"->'targetGenerationAtCapture'
      AND entry#>>'{editionEvidence,candidate,schemaVersion}' = '2'
      AND entry#>>'{editionEvidence,member,schemaVersion}' = '2'
      AND entry#>>'{editionEvidence,member,source,kind}' = 'member'
      AND entry#>>'{editionEvidence,member,source,attemptId}' = NEW.id) IS NOT TRUE
    THEN RAISE EXCEPTION 'Versioned movie file plan birth, member or scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER movie_file_plan ON "AcquisitionAttempt";
CREATE TRIGGER movie_file_plan BEFORE INSERT OR UPDATE ON "AcquisitionAttempt" FOR EACH ROW WHEN (NEW."identityEvidence"->>'schemaVersion' IS DISTINCT FROM '3') EXECUTE FUNCTION media_movie_file_plan();
CREATE TRIGGER managed_movie_file_plan BEFORE INSERT OR UPDATE ON "AcquisitionAttempt" FOR EACH ROW WHEN (NEW."identityEvidence"->>'schemaVersion'='3') EXECUTE FUNCTION media_managed_movie_file_plan();

CREATE OR REPLACE FUNCTION media_movie_publication_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt "AcquisitionAttempt"%ROWTYPE;
BEGIN
  IF NEW.intent->>'schemaVersion' = '2' THEN
    SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id = NEW."attemptId" FOR SHARE;
    IF (((attempt."identityEvidence"->>'schemaVersion' = '2' AND attempt."filePlan"->>'schemaVersion' = '2') OR (attempt."identityEvidence"->>'schemaVersion' = '3' AND attempt."filePlan"->>'schemaVersion' = '3'))
      AND NEW.intent->'scope' = attempt."identityEvidence"->'scope'
      AND NEW.intent->'scope' = attempt."filePlan"->'scope'
      AND NEW.intent->>'operationId' = attempt."operationId"
      AND NEW."birthEpoch" = attempt."recoveryEpoch" AND cardinality(attempt."mediaIds") = 1
      AND NEW.intent->'mediaIds' = jsonb_build_array(attempt."mediaIds"[1])
      AND jsonb_array_length(NEW.intent->'entries') = 1
      AND NEW.intent#>'{entries,0,entry}' = attempt."filePlan"#>'{entries,0}'
      AND (NEW.outcome IS NULL OR NEW.outcome->'scope' = NEW.intent->'scope')) IS NOT TRUE
    THEN RAISE EXCEPTION 'Movie publication scope or immutable plan mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION media_managed_movie_plex_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; envelope JSONB; binding JSONB; association JSONB; attempt "AcquisitionAttempt"; publication "MediaPublicationTransition";
BEGIN
  IF TG_OP <> 'DELETE' AND COALESCE(NEW.result,'{}'::jsonb) ? 'moviePlexReceiptV2' AND COALESCE(NEW.result,'{}'::jsonb) ? 'moviePlexReceiptV3' THEN RAISE EXCEPTION 'Movie completion cannot carry competing receipt identities'; END IF;
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'moviePlexReceiptV3' THEN RAISE EXCEPTION 'Committed movie Plex receipt is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'moviePlexReceiptV3' THEN
    IF NEW.result->'moviePlexReceiptV3' IS DISTINCT FROM OLD.result->'moviePlexReceiptV3'
      OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload) IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
    THEN RAISE EXCEPTION 'Committed movie Plex receipt or command is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'moviePlexReceiptV3') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope := NEW.result->'moviePlexReceiptV3'; proof := envelope->'receipt'; binding := proof->'binding'; association := proof #> '{observation,associations,0}';
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=proof #>> '{input,attemptId}';
  SELECT * INTO STRICT publication FROM "MediaPublicationTransition" WHERE "attemptId"=attempt.id;
  IF NOT COALESCE(envelope->>'receiptHash' ~ '^[a-f0-9]{64}$' AND proof->'schemaVersion'='3'::jsonb
    AND proof #> '{input,schemaVersion}'='4'::jsonb AND proof #>> '{input,operationId}'=NEW.id
    AND NEW.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4') AND NEW."targetId"=attempt."mediaIds"[1]
    AND attempt.state IN ('imported','completed') AND attempt."coordinatorOperationId"=NEW.id
    AND cardinality(attempt."mediaIds")=1 AND proof #> '{input,scope}'=attempt."filePlan"->'scope'
    AND proof #> '{input,scope}'=attempt."identityEvidence"->'scope'
    AND proof #>> '{attempt,operationId}'=attempt."operationId" AND proof #>> '{attempt,coordinatorOperationId}'=NEW.id
    AND proof #>> '{attempt,releaseId}'=attempt."releaseId" AND (proof #> '{attempt,sponsorRequestId}'='null'::jsonb AND attempt."sponsorRequestId" IS NULL AND attempt."identityEvidence"->>'schemaVersion'='3')
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
CREATE TRIGGER managed_movie_plex_receipt BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_managed_movie_plex_receipt();
