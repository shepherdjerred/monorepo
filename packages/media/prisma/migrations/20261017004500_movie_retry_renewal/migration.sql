-- Same-choice retries retain their original acquisition birth and generation.
-- Existing publication and receipt trigger bodies remain unchanged.
CREATE FUNCTION media_movie_retry_source_v1(command "Operation", attempt "AcquisitionAttempt")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE capture jsonb:=command.payload->'movieRetryV1'; selected jsonb:=command.payload->'scope';
  target "MediaIntent"; prior "Operation";
BEGIN
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=command."targetId" AND edition=selected->>'edition';
  SELECT * INTO STRICT prior FROM "Operation" WHERE id=capture->>'previousCoordinatorOperationId';
  IF NOT COALESCE(jsonb_typeof(capture)='object' AND capture->'schemaVersion'='1'::jsonb
    AND capture ?& ARRAY['schemaVersion','mode','attemptId','previousCoordinatorOperationId','birthHash','generation','recoveryEpoch','profile']
    AND capture-ARRAY['schemaVersion','mode','attemptId','previousCoordinatorOperationId','birthHash','generation','recoveryEpoch','profile']='{}'::jsonb
    AND capture->>'mode' IN ('manual','automatic') AND capture->>'birthHash' ~ '^[a-f0-9]{64}$'
    AND capture->'profile' ?& ARRAY['id','version'] AND (capture->'profile')-ARRAY['id','version']='{}'::jsonb
    AND command.kind='reconcile_movie_edition_v4' AND command.payload->>'kind'=command.kind
    AND command.payload->'schemaVersion'='4'::jsonb AND command.payload->>'operationId'=command.id
    AND command.payload->>'mediaId'=command."targetId" AND command.id<>prior.id AND command.id<>attempt."operationId"
    AND selected ?& ARRAY['rootMediaId','mediaId','edition'] AND selected-ARRAY['rootMediaId','mediaId','edition']='{}'::jsonb
    AND selected->>'mediaId'=command."targetId" AND selected->>'rootMediaId'=command."targetId"
    AND selected->>'edition'=attempt.edition AND target."editionRootId"=command."targetId"
    AND EXISTS (SELECT 1 FROM "MediaItem" WHERE id=command."targetId" AND kind='movie')
    AND capture->>'attemptId'=attempt.id AND cardinality(attempt."mediaIds")=1 AND attempt."mediaIds"[1]=command."targetId"
    AND attempt."identityEvidence"->>'schemaVersion' IN ('2','3') AND attempt."identityEvidence"->'scope'=selected
    AND attempt."filePlan" IS NULL AND attempt.state IN ('reserved','submitting','submission_unknown','submission_observed','downloading')
    AND capture->'generation'=attempt.generations->command."targetId" AND capture->'generation'=to_jsonb(target.generation)
    AND command.payload->'generation'=capture->'generation'
    AND capture->'recoveryEpoch'=to_jsonb(attempt."recoveryEpoch") AND command.payload->'recoveryEpoch'=capture->'recoveryEpoch'
    AND target."automationEpoch"=attempt."recoveryEpoch" AND target.monitoring AND target."desiredPresence" AND target."intentionallyRemovedAt" IS NULL
    AND capture #>> '{profile,id}'=attempt.failure->>'profileId' AND capture #> '{profile,version}'=attempt.failure->'profileVersion'
    AND target."profileId"=capture #>> '{profile,id}'
    AND EXISTS (SELECT 1 FROM "QualityProfile" p WHERE p.id=target."profileId" AND to_jsonb(p.version)=capture #> '{profile,version}')
    AND EXISTS (SELECT 1 FROM "AcquisitionReservation" r WHERE r."mediaId"=command."targetId" AND r.edition=attempt.edition
      AND r."attemptId"=attempt.id AND to_jsonb(r.generation)=capture->'generation')
    AND EXISTS (SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active' AND r."ownershipConfirmed" AND r."recoveryEpoch"=attempt."recoveryEpoch")
    AND prior.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4') AND prior."targetId"=command."targetId"
    AND prior.payload->>'kind'=prior.kind AND prior.payload->>'operationId'=prior.id AND prior.payload->'scope'=selected
    AND prior.payload->'generation'=capture->'generation' AND prior.payload->'recoveryEpoch'=capture->'recoveryEpoch',false)
  THEN RAISE EXCEPTION 'Movie retry requires its exact original scoped acquisition, reservation and generation'; END IF;
END;
$$;

CREATE FUNCTION media_movie_retry_operation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capture jsonb; envelope jsonb; proof jsonb; input jsonb; selected jsonb; transfer jsonb;
  attempt "AcquisitionAttempt"; prior "Operation"; torrent "Torrent"; release "ReleaseCandidate"; writer "LegacyWriterLease";
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
  SELECT * INTO STRICT writer FROM "LegacyWriterLease" WHERE id='singleton';
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
CREATE TRIGGER movie_retry_operation_v1 BEFORE INSERT OR UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_movie_retry_operation_v1();

CREATE FUNCTION media_movie_retry_coordinator_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation";
BEGIN
  IF NEW."coordinatorOperationId" IS NOT DISTINCT FROM OLD."coordinatorOperationId"
    OR OLD."identityEvidence"->>'schemaVersion' NOT IN ('2','3') OR OLD."identityEvidence"->>'schemaVersion' IS NULL THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT command FROM "Operation" WHERE id=NEW."coordinatorOperationId";
  PERFORM media_movie_retry_source_v1(command,OLD);
  IF (to_jsonb(NEW)-ARRAY['coordinatorOperationId','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['coordinatorOperationId','updatedAt'])
    OR command.payload #>> '{movieRetryV1,previousCoordinatorOperationId}' IS DISTINCT FROM OLD."coordinatorOperationId"
    OR command.status NOT IN ('queued','running') OR COALESCE(command.result,'{}'::jsonb) ? 'movieRetryRenewalV1'
  THEN RAISE EXCEPTION 'Movie retry may change only the captured current coordinator'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_retry_coordinator_v1 BEFORE UPDATE ON "AcquisitionAttempt"
  FOR EACH ROW EXECUTE FUNCTION media_movie_retry_coordinator_v1();

CREATE FUNCTION media_movie_retry_commit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation"; proof jsonb;
BEGIN
  IF NEW."coordinatorOperationId" IS NOT DISTINCT FROM OLD."coordinatorOperationId"
    OR OLD."identityEvidence"->>'schemaVersion' NOT IN ('2','3') OR OLD."identityEvidence"->>'schemaVersion' IS NULL THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT command FROM "Operation" WHERE id=NEW."coordinatorOperationId";
  proof:=command.result #> '{movieRetryRenewalV1,receipt}';
  IF NOT COALESCE(proof #>> '{input,operationId}'=NEW."coordinatorOperationId"
    AND proof #>> '{capture,attemptId}'=NEW.id AND proof #>> '{capture,previousCoordinatorOperationId}'=OLD."coordinatorOperationId"
    AND proof->'capture'=command.payload->'movieRetryV1' AND proof->>'previousState'=OLD.state
    AND command.xmin::text=(txid_current()%4294967296)::text,false)
  THEN RAISE EXCEPTION 'Movie retry coordinator requires its same-transaction immutable renewal receipt'; END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_retry_commit_v1 AFTER UPDATE ON "AcquisitionAttempt"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_retry_commit_v1();
