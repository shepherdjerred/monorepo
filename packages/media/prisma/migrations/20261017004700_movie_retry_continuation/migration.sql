-- Prepared/imported continuation retains literal V1 bodies with explicit V2-only dispatch.
-- Full nativeAttempt snapshots belong only to the immutable renewal result, never command/outbox payloads.
CREATE FUNCTION media_movie_retry_native_snapshot_v2(attempt "AcquisitionAttempt")
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id',attempt.id,'releaseId',attempt."releaseId",'sponsorRequestId',attempt."sponsorRequestId",
    'mediaIds',to_jsonb(attempt."mediaIds"),'generations',attempt.generations,'state',attempt.state,
    'torrentId',attempt."torrentId",'operationId',attempt."operationId",'coordinatorOperationId',attempt."coordinatorOperationId",
    'failure',attempt.failure,'filePlan',attempt."filePlan",'recoveryEpoch',attempt."recoveryEpoch")
$$;

CREATE FUNCTION media_movie_retry_continuation_source_v2(command "Operation", attempt "AcquisitionAttempt")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE capture jsonb:=command.payload->'movieRetryV2'; selected jsonb:=command.payload->'scope';
  continuation jsonb:=capture->'continuation'; parent jsonb:=continuation->'publication';
  target "MediaIntent"; prior "Operation"; publication "MediaPublicationTransition";
  asset "LibraryAsset"; successor jsonb;
BEGIN
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=command."targetId" AND edition=selected->>'edition';
  SELECT * INTO STRICT prior FROM "Operation" WHERE id=capture->>'previousCoordinatorOperationId';
  IF NOT COALESCE(capture ?& ARRAY['schemaVersion','mode','attemptId','previousCoordinatorOperationId','birthHash','generation','recoveryEpoch','profile','continuation']
    AND capture-ARRAY['schemaVersion','mode','attemptId','previousCoordinatorOperationId','birthHash','generation','recoveryEpoch','profile','continuation']='{}'::jsonb
    AND capture->'schemaVersion'='2'::jsonb AND capture->>'mode' IN ('manual','automatic')
    AND capture->>'birthHash' ~ '^[a-f0-9]{64}$'
    AND capture->'profile' ?& ARRAY['id','version'] AND (capture->'profile')-ARRAY['id','version']='{}'::jsonb
    AND continuation ?& ARRAY['phase','filePlanHash','beforeAttemptHash','publication']
    AND continuation-ARRAY['phase','filePlanHash','beforeAttemptHash','publication']='{}'::jsonb
    AND continuation->>'filePlanHash' ~ '^[a-f0-9]{64}$' AND continuation->>'beforeAttemptHash' ~ '^[a-f0-9]{64}$'
    AND continuation->>'phase'=CASE attempt.state WHEN 'validating' THEN 'prepared' WHEN 'imported' THEN 'imported' END
    AND command.kind='reconcile_movie_edition_v4' AND command.payload->>'kind'=command.kind
    AND command.payload ?& ARRAY['operationId','kind','mediaId','generation','recoveryEpoch','schemaVersion','scope','movieRetryV2']
    AND command.payload-ARRAY['operationId','kind','mediaId','generation','recoveryEpoch','schemaVersion','scope','movieRetryV2']='{}'::jsonb
    AND command.payload->'schemaVersion'='4'::jsonb AND command.payload->>'operationId'=command.id
    AND command.payload->>'mediaId'=command."targetId" AND command.id<>prior.id AND command.id<>attempt."operationId"
    AND NOT(COALESCE(command.payload,'{}'::jsonb) ?| ARRAY['movieRetryV1','movieRetryPlexAckV1'])
    AND selected ?& ARRAY['rootMediaId','mediaId','edition'] AND selected-ARRAY['rootMediaId','mediaId','edition']='{}'::jsonb
    AND selected->>'mediaId'=command."targetId" AND selected->>'rootMediaId'=command."targetId"
    AND selected->>'edition'=attempt.edition AND target."editionRootId"=command."targetId"
    AND EXISTS (SELECT 1 FROM "MediaItem" WHERE id=command."targetId" AND kind='movie')
    AND capture->>'attemptId'=attempt.id AND cardinality(attempt."mediaIds")=1 AND attempt."mediaIds"[1]=command."targetId"
    AND attempt."identityEvidence"->>'schemaVersion' IN ('2','3') AND attempt."identityEvidence"->'scope'=selected
    AND attempt.state IN ('validating','imported') AND attempt."filePlan" IS NOT NULL AND attempt."torrentId" IS NOT NULL
    AND attempt."filePlan"->>'schemaVersion'=attempt."identityEvidence"->>'schemaVersion'
    AND attempt."filePlan"->>'attemptId'=attempt.id AND attempt."filePlan"->'scope'=selected
    AND attempt."filePlan"->'birth'=attempt."movieEditionAuthority"
    AND jsonb_array_length(attempt."filePlan"->'entries')=1
    AND attempt."filePlan" #> '{entries,0,generations}'=attempt.generations
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
    AND prior.payload->'schemaVersion'='4'::jsonb AND prior.payload->>'kind'=prior.kind AND prior.payload->>'operationId'=prior.id
    AND prior.payload->'scope'=selected AND prior.payload->'generation'=capture->'generation'
    AND prior.payload->'recoveryEpoch'=capture->'recoveryEpoch'
    AND NOT(COALESCE(prior.result,'{}'::jsonb) ?| ARRAY['moviePlexReceiptV2','moviePlexReceiptV3']),false)
  THEN RAISE EXCEPTION 'Movie continuation requires its actual unchanged prepared/imported acquisition, plan and current target'; END IF;
  SELECT * INTO publication FROM "MediaPublicationTransition" WHERE "attemptId"=attempt.id;
  IF parent='null'::jsonb THEN
    IF FOUND OR attempt.state<>'validating' THEN RAISE EXCEPTION 'Only a genuine pre-publication plan may omit a publication parent'; END IF;
  ELSE
    IF NOT FOUND THEN RAISE EXCEPTION 'Movie continuation lost its original publication parent'; END IF;
    IF NOT COALESCE(parent ?& ARRAY['transitionId','intentHash','attemptSnapshotHash','outcomeHash']
      AND parent-ARRAY['transitionId','intentHash','attemptSnapshotHash','outcomeHash']='{}'::jsonb
      AND parent->>'transitionId'=publication.id AND parent->>'intentHash'=publication."intentHash"
      AND parent->>'attemptSnapshotHash'=publication.intent->>'attemptSnapshotHash'
      AND parent->'outcomeHash'=COALESCE(to_jsonb(publication."outcomeHash"),'null'::jsonb)
      AND publication."filePlanHash"=continuation->>'filePlanHash'
      AND publication.intent->'schemaVersion'='2'::jsonb AND publication.intent->'scope'=selected
      AND publication.intent->>'operationId'=attempt."operationId" AND publication."birthEpoch"=attempt."recoveryEpoch"
      AND publication.intent->>'attemptId'=attempt.id AND publication.intent #> '{entries,0,entry}'=attempt."filePlan" #> '{entries,0}'
      AND ((attempt.state='validating' AND publication.outcome IS NULL AND publication."outcomeHash" IS NULL)
        OR (attempt.state='imported' AND publication.outcome->>'kind'='published' AND publication."outcomeHash" IS NOT NULL
          AND publication.outcome->'scope'=selected AND publication.outcome->>'intentHash'=publication."intentHash")),false)
    THEN RAISE EXCEPTION 'Movie continuation must retain the exact original intent, native snapshot hash and actual outcome'; END IF;
    IF attempt.state='imported' THEN
      successor:=publication.outcome #> '{entries,0,successor}';
      SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=successor->>'id';
      IF NOT COALESCE(asset.state='published' AND asset.owned AND asset."ownershipEpoch"=attempt."recoveryEpoch"
        AND asset."editionRootId"=command."targetId" AND asset.edition=attempt.edition
        AND to_jsonb(asset.version)=successor->'version' AND asset.checksum=successor->>'checksum'
        AND asset.path=successor->>'path' AND asset."sizeBytes"::text=successor->>'sizeBytes'
        AND (SELECT count(*) FROM "AssetCoverage" c WHERE c."assetId"=asset.id)=1
        AND EXISTS (SELECT 1 FROM "AssetCoverage" c WHERE c."assetId"=asset.id AND c."mediaId"=command."targetId" AND c.edition=attempt.edition AND c.current),false)
      THEN RAISE EXCEPTION 'Imported movie continuation lost its exact actual owned physical successor'; END IF;
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION media_movie_retry_coordinator_check_v2(previous "AcquisitionAttempt", following "AcquisitionAttempt", command "Operation")
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM media_plex_assert_deadline();
  PERFORM media_movie_retry_continuation_source_v2(command,previous);
  IF (to_jsonb(following)-ARRAY['coordinatorOperationId','updatedAt']) IS DISTINCT FROM (to_jsonb(previous)-ARRAY['coordinatorOperationId','updatedAt'])
    OR command.payload #>> '{movieRetryV2,previousCoordinatorOperationId}' IS DISTINCT FROM previous."coordinatorOperationId"
    OR command.status NOT IN ('queued','running') OR COALESCE(command.result,'{}'::jsonb) ?| ARRAY['movieRetryRenewalV1','movieRetryRenewalV2','movieRetryPlexAcknowledgementV1']
  THEN RAISE EXCEPTION 'Movie continuation may change only its actual selected coordinator'; END IF;
END;
$$;

CREATE FUNCTION media_movie_retry_transfer_v2(proof jsonb, attempt "AcquisitionAttempt")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE transfer jsonb:=proof->'transfer'; observed jsonb; torrent "Torrent"; release "ReleaseCandidate";
BEGIN
  SELECT * INTO STRICT torrent FROM "Torrent" WHERE id=attempt."torrentId";
  SELECT * INTO STRICT release FROM "ReleaseCandidate" WHERE id=attempt."releaseId";
  IF NOT COALESCE(torrent.owned AND torrent."ownershipEpoch"=attempt."recoveryEpoch"
    AND torrent."infoHash"=release."sourceEvidence"->>'infoHash' AND torrent."providerId"=release."providerId",false)
  THEN RAISE EXCEPTION 'Movie continuation cannot borrow another transfer'; END IF;
  IF attempt.state='imported' THEN
    IF NOT COALESCE(transfer ?& ARRAY['kind','id','infoHash','providerId','ownershipEpoch','policyHash']
      AND transfer-ARRAY['kind','id','infoHash','providerId','ownershipEpoch','policyHash']='{}'::jsonb
      AND transfer->>'kind'='physical_publication' AND transfer->>'id'=torrent.id
      AND transfer->>'infoHash'=torrent."infoHash" AND transfer->>'providerId'=torrent."providerId"
      AND transfer->'ownershipEpoch'=to_jsonb(torrent."ownershipEpoch") AND transfer->>'policyHash' ~ '^[a-f0-9]{64}$',false)
    THEN RAISE EXCEPTION 'Imported movie continuation requires its actual recorded publication transfer parent'; END IF;
  ELSE
    observed:=transfer->'observation';
    IF NOT COALESCE(transfer ?& ARRAY['kind','observation'] AND transfer-ARRAY['kind','observation']='{}'::jsonb
      AND transfer->>'kind'='live_observation'
      AND observed ?& ARRAY['id','infoHash','qbittorrentId','providerId','ownershipEpoch','observationHash','savePath','contentPath','tags','category','policyHash']
      AND observed-ARRAY['id','infoHash','qbittorrentId','providerId','ownershipEpoch','observationHash','savePath','contentPath','tags','category','policyHash']='{}'::jsonb
      AND observed->>'id'=torrent.id AND observed->>'infoHash'=torrent."infoHash"
      AND observed->>'qbittorrentId'=torrent."qbittorrentId" AND observed->>'qbittorrentId' ~ '^[a-f0-9]{40}$'
      AND observed->>'providerId'=torrent."providerId" AND observed->'ownershipEpoch'=to_jsonb(torrent."ownershipEpoch")
      AND observed->>'observationHash' ~ '^[a-f0-9]{64}$' AND observed->>'policyHash' ~ '^[a-f0-9]{64}$'
      AND rtrim(observed->>'savePath','/')='/downloads/media/'||attempt.id AND length(observed->>'contentPath') BETWEEN 1 AND 4096
      AND observed->>'category'='media'
      AND ARRAY(SELECT btrim(tag) FROM unnest(string_to_array(observed->>'tags',',')) tag WHERE btrim(tag) ~ '^media-[a-f0-9-]{36}$')=ARRAY['media-'||attempt."operationId"]
      AND ARRAY(SELECT btrim(tag) FROM unnest(string_to_array(observed->>'tags',',')) tag WHERE btrim(tag) LIKE 'media-attempt-%')=ARRAY['media-attempt-'||attempt.id],false)
    THEN RAISE EXCEPTION 'Prepared movie continuation requires the original observed Media add, tags, path and policy'; END IF;
  END IF;
END;
$$;

CREATE FUNCTION media_movie_retry_renewal_check_v2(command "Operation", attempt "AcquisitionAttempt")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE capture jsonb:=command.payload->'movieRetryV2'; envelope jsonb:=command.result->'movieRetryRenewalV2';
  proof jsonb:=envelope->'receipt'; input jsonb:=proof->'input'; before jsonb:=proof->'beforeAttempt';
  writer "LegacyWriterLease";
BEGIN
  PERFORM media_plex_assert_deadline();
  PERFORM media_movie_retry_continuation_source_v2(command,attempt);
  SELECT * INTO STRICT writer FROM "LegacyWriterLease" WHERE id='singleton';
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

CREATE FUNCTION media_movie_retry_commit_check_v2(previous "AcquisitionAttempt", following "AcquisitionAttempt", command "Operation")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE proof jsonb:=command.result #> '{movieRetryRenewalV2,receipt}';
BEGIN
  PERFORM media_plex_assert_deadline();
  IF NOT COALESCE(proof->'beforeAttempt'=media_movie_retry_native_snapshot_v2(previous)
    AND proof #>> '{input,operationId}'=following."coordinatorOperationId"
    AND proof #>> '{capture,attemptId}'=following.id AND proof #>> '{capture,previousCoordinatorOperationId}'=previous."coordinatorOperationId"
    AND proof->'capture'=command.payload->'movieRetryV2' AND proof->>'previousState'=previous.state
    AND (to_jsonb(following)-ARRAY['coordinatorOperationId','updatedAt'])=(to_jsonb(previous)-ARRAY['coordinatorOperationId','updatedAt'])
    AND EXISTS (SELECT 1 FROM "Operation" o WHERE o.id=command.id
      AND o.xmin::text=(txid_current()%4294967296)::text
      AND o.result #> '{movieRetryRenewalV2,receipt}'=proof),false)
  THEN RAISE EXCEPTION 'Movie continuation coordinator requires its exact same-transaction native before snapshot and immutable renewal'; END IF;
  PERFORM media_plex_assert_deadline();
END;
$$;

CREATE FUNCTION media_movie_retry_operation_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt "AcquisitionAttempt"; selected boolean; previous_selected boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.payload,'{}'::jsonb) ? 'movieRetryV2' OR COALESCE(OLD.result,'{}'::jsonb) ? 'movieRetryRenewalV2'
    THEN RAISE EXCEPTION 'Movie continuation command and proof are immutable'; END IF;
    RETURN OLD;
  END IF;
  selected:=COALESCE(NEW.payload,'{}'::jsonb) ? 'movieRetryV2';
  IF selected AND COALESCE(NEW.payload,'{}'::jsonb) ?| ARRAY['movieRetryV1','movieRetryPlexAckV1']
  THEN RAISE EXCEPTION 'Movie retry has competing protocol identities'; END IF;
  IF TG_OP='UPDATE' THEN
    previous_selected:=COALESCE(OLD.payload,'{}'::jsonb) ? 'movieRetryV2';
    IF previous_selected THEN
      IF (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload)
        IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
      THEN RAISE EXCEPTION 'Movie continuation original selection is immutable'; END IF;
    ELSIF selected THEN RAISE EXCEPTION 'Movie continuation must be selected at command birth'; END IF;
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'movieRetryRenewalV2' THEN
      IF NEW.result->'movieRetryRenewalV2' IS DISTINCT FROM OLD.result->'movieRetryRenewalV2'
      THEN RAISE EXCEPTION 'Movie continuation proof is immutable'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP='INSERT' AND selected THEN
    SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=NEW.payload #>> '{movieRetryV2,attemptId}';
    PERFORM media_movie_retry_continuation_source_v2(NEW,attempt);
    IF attempt."coordinatorOperationId" IS DISTINCT FROM NEW.payload #>> '{movieRetryV2,previousCoordinatorOperationId}'
    THEN RAISE EXCEPTION 'Movie continuation must select the actual original coordinator'; END IF;
  END IF;
  IF NOT(COALESCE(NEW.result,'{}'::jsonb) ? 'movieRetryRenewalV2') THEN RETURN NEW; END IF;
  IF TG_OP<>'UPDATE' OR NOT selected OR COALESCE(NEW.result,'{}'::jsonb) ?| ARRAY['movieRetryRenewalV1','movieRetryPlexAcknowledgementV1']
  THEN RAISE EXCEPTION 'Movie continuation proof requires its distinct original pending command'; END IF;
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=NEW.payload #>> '{movieRetryV2,attemptId}';
  PERFORM media_movie_retry_renewal_check_v2(NEW,attempt);
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_retry_operation_v2 BEFORE INSERT OR UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_movie_retry_operation_v2();

CREATE FUNCTION media_movie_retry_plex_capture_v1(command "Operation")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE capture jsonb:=command.payload->'movieRetryPlexAckV1'; original_input jsonb:=capture->'originalInput';
  prior "Operation"; attempt "AcquisitionAttempt"; publication "MediaPublicationTransition";
  envelope jsonb; proof jsonb; association "PlexAssociationEvidence";
BEGIN
  SELECT * INTO STRICT prior FROM "Operation" WHERE id=original_input->>'operationId';
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=original_input->>'attemptId';
  IF COALESCE(prior.result,'{}'::jsonb) ? 'moviePlexReceiptV2' AND COALESCE(prior.result,'{}'::jsonb) ? 'moviePlexReceiptV3'
  THEN RAISE EXCEPTION 'Movie historical retry has competing Plex receipt identities'; END IF;
  IF COALESCE(prior.result,'{}'::jsonb) ? 'moviePlexReceiptV2' THEN
    envelope:=prior.result->'moviePlexReceiptV2';
    IF envelope #> '{receipt,schemaVersion}' IS DISTINCT FROM '2'::jsonb
    THEN RAISE EXCEPTION 'Movie historical retry cannot reinterpret another Plex receipt version'; END IF;
  ELSIF COALESCE(prior.result,'{}'::jsonb) ? 'moviePlexReceiptV3' THEN
    envelope:=prior.result->'moviePlexReceiptV3';
    IF envelope #> '{receipt,schemaVersion}' IS DISTINCT FROM '3'::jsonb
    THEN RAISE EXCEPTION 'Movie historical retry cannot reinterpret another Plex receipt version'; END IF;
  ELSE RAISE EXCEPTION 'Movie historical retry requires an actual committed Plex receipt'; END IF;
  proof:=envelope->'receipt';
  SELECT * INTO STRICT publication FROM "MediaPublicationTransition" WHERE "attemptId"=attempt.id;
  SELECT * INTO STRICT association FROM "PlexAssociationEvidence" WHERE id=proof #>> '{binding,evidenceId}';
  IF NOT COALESCE(capture ?& ARRAY['schemaVersion','mode','originalInput','originalReceiptHash','originalCommandHash','birthHash','generation','recoveryEpoch']
    AND capture-ARRAY['schemaVersion','mode','originalInput','originalReceiptHash','originalCommandHash','birthHash','generation','recoveryEpoch']='{}'::jsonb
    AND capture->'schemaVersion'='1'::jsonb AND capture->>'mode' IN ('manual','automatic')
    AND capture->>'originalReceiptHash'=envelope->>'receiptHash' AND capture->>'originalReceiptHash' ~ '^[a-f0-9]{64}$'
    AND capture->>'originalCommandHash'=proof #>> '{command,payloadHash}' AND capture->>'originalCommandHash' ~ '^[a-f0-9]{64}$'
    AND capture->>'birthHash' ~ '^[a-f0-9]{64}$'
    AND original_input ?& ARRAY['schemaVersion','operationId','attemptId','scope']
    AND original_input-ARRAY['schemaVersion','operationId','attemptId','scope']='{}'::jsonb
    AND original_input->'schemaVersion'='4'::jsonb AND original_input=proof->'input'
    AND command.kind='reconcile_movie_edition_v4' AND command.payload->'schemaVersion'='4'::jsonb
    AND command.payload ?& ARRAY['operationId','kind','mediaId','generation','recoveryEpoch','schemaVersion','scope','movieRetryPlexAckV1']
    AND command.payload-ARRAY['operationId','kind','mediaId','generation','recoveryEpoch','schemaVersion','scope','movieRetryPlexAckV1']='{}'::jsonb
    AND command.payload->>'kind'=command.kind AND command.payload->>'operationId'=command.id
    AND command.payload->>'mediaId'=command."targetId" AND command.id<>prior.id
    AND NOT(COALESCE(command.payload,'{}'::jsonb) ?| ARRAY['movieRetryV1','movieRetryV2'])
    AND command.payload->'scope'=original_input->'scope' AND command.payload->'generation'=capture->'generation'
    AND command.payload->'recoveryEpoch'=capture->'recoveryEpoch'
    AND prior.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4')
    AND prior.payload->>'operationId'=prior.id AND prior.payload->>'kind'=prior.kind AND prior.payload->'schemaVersion'='4'::jsonb
    AND prior."targetId"=command."targetId" AND prior.payload->'scope'=original_input->'scope'
    AND prior.payload->'generation'=capture->'generation' AND prior.payload->'recoveryEpoch'=capture->'recoveryEpoch'
    AND cardinality(attempt."mediaIds")=1 AND attempt."mediaIds"[1]=command."targetId"
    AND attempt.edition=original_input #>> '{scope,edition}' AND attempt."identityEvidence"->>'schemaVersion' IN ('2','3')
    AND attempt."identityEvidence"->'scope'=original_input->'scope' AND attempt."coordinatorOperationId"=prior.id
    AND attempt.state IN ('imported','completed') AND to_jsonb(attempt."recoveryEpoch")=capture->'recoveryEpoch'
    AND attempt.generations->command."targetId"=capture->'generation'
    AND proof #>> '{attempt,operationId}'=attempt."operationId" AND proof #>> '{attempt,coordinatorOperationId}'=prior.id
    AND proof #>> '{attempt,torrentId}'=attempt."torrentId" AND proof #>> '{attempt,releaseId}'=attempt."releaseId"
    AND proof #>> '{attempt,filePlanHash}'=publication."filePlanHash"
    AND proof #>> '{publication,transitionId}'=publication.id AND proof #>> '{publication,intentHash}'=publication."intentHash"
    AND proof #>> '{publication,outcomeHash}'=publication."outcomeHash" AND publication.outcome->>'kind'='published'
    AND association.evidence=proof #> '{observation,associations,0}'
    AND association."associationHash"=proof #>> '{binding,associationHash}'
    AND association."mediaId"=command."targetId" AND association.edition=attempt.edition
    AND association."assetId"=proof #>> '{expected,newGroups,0,assetId}',false)
  THEN RAISE EXCEPTION 'Movie historical retry requires the exact original committed Plex input, physical parent and unchanged coordinator'; END IF;
END;
$$;

CREATE FUNCTION media_movie_retry_plex_operation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected boolean; previous_selected boolean; proof jsonb; capture jsonb;
  attempt "AcquisitionAttempt"; target "MediaIntent";
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.payload,'{}'::jsonb) ? 'movieRetryPlexAckV1' OR COALESCE(OLD.result,'{}'::jsonb) ? 'movieRetryPlexAcknowledgementV1'
    THEN RAISE EXCEPTION 'Movie historical retry selection and acknowledgement are immutable'; END IF;
    RETURN OLD;
  END IF;
  selected:=COALESCE(NEW.payload,'{}'::jsonb) ? 'movieRetryPlexAckV1';
  IF selected AND COALESCE(NEW.payload,'{}'::jsonb) ?| ARRAY['movieRetryV1','movieRetryV2']
  THEN RAISE EXCEPTION 'Movie historical retry has competing protocol identities'; END IF;
  IF TG_OP='UPDATE' THEN
    previous_selected:=COALESCE(OLD.payload,'{}'::jsonb) ? 'movieRetryPlexAckV1';
    IF previous_selected THEN
      IF (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload)
        IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
      THEN RAISE EXCEPTION 'Movie historical retry must retain its original exact input'; END IF;
    ELSIF selected THEN RAISE EXCEPTION 'Movie historical retry must be selected at command birth'; END IF;
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'movieRetryPlexAcknowledgementV1' THEN
      IF NEW.result->'movieRetryPlexAcknowledgementV1' IS DISTINCT FROM OLD.result->'movieRetryPlexAcknowledgementV1'
      THEN RAISE EXCEPTION 'Movie historical retry acknowledgement is immutable'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP='INSERT' AND selected THEN
    PERFORM media_movie_retry_plex_capture_v1(NEW);
    SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=NEW."targetId" AND edition=NEW.payload #>> '{scope,edition}';
    IF NOT COALESCE(target."editionRootId"=NEW.payload #>> '{scope,rootMediaId}'
      AND to_jsonb(target.generation)=NEW.payload->'generation' AND to_jsonb(target."automationEpoch")=NEW.payload->'recoveryEpoch',false)
    THEN RAISE EXCEPTION 'New movie historical retry selection requires its actual current scoped target'; END IF;
    SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=NEW.payload #>> '{movieRetryPlexAckV1,originalInput,attemptId}';
    IF attempt.state='completed' AND NOT EXISTS (
      SELECT 1 FROM "PlexBindingCurrent" p JOIN "Operation" prior ON prior.id=attempt."coordinatorOperationId"
      JOIN "PlexAssociationEvidence" e ON e.id=p."evidenceId" JOIN "LibraryAsset" a ON a.id=e."assetId"
      WHERE p."mediaId"=NEW."targetId" AND p.edition=NEW.payload #>> '{scope,edition}'
        AND a.state='published' AND a.owned AND a."ownershipEpoch"=attempt."recoveryEpoch"
        AND a.edition=p.edition AND a."editionRootId"=NEW."targetId"
        AND to_jsonb(a.version)=e.evidence #> '{group,assetVersion}' AND a.checksum=e.evidence #>> '{group,checksum}'
        AND a.path=e.evidence #>> '{group,canonicalPath}' AND a."sizeBytes"::text=e.evidence #>> '{group,sizeBytes}'
        AND (SELECT count(*) FROM "AssetCoverage" c WHERE c."assetId"=a.id)=1
        AND EXISTS (SELECT 1 FROM "AssetCoverage" c WHERE c."assetId"=a.id AND c."mediaId"=NEW."targetId" AND c.edition=p.edition AND c.current)
        AND ((COALESCE(prior.result,'{}'::jsonb) ? 'moviePlexReceiptV2'
          AND p."evidenceId"=prior.result #>> '{moviePlexReceiptV2,receipt,binding,evidenceId}'
          AND p."associationHash"=prior.result #>> '{moviePlexReceiptV2,receipt,binding,associationHash}'
          AND to_jsonb(p.revision)=prior.result #> '{moviePlexReceiptV2,receipt,binding,revision}')
        OR (COALESCE(prior.result,'{}'::jsonb) ? 'moviePlexReceiptV3'
          AND p."evidenceId"=prior.result #>> '{moviePlexReceiptV3,receipt,binding,evidenceId}'
          AND p."associationHash"=prior.result #>> '{moviePlexReceiptV3,receipt,binding,associationHash}'
          AND to_jsonb(p.revision)=prior.result #> '{moviePlexReceiptV3,receipt,binding,revision}')))
    THEN RAISE EXCEPTION 'Fresh completed movie retry requires its exact current serving receipt; it cannot manufacture a reservation'; END IF;
  END IF;
  IF NOT(COALESCE(NEW.result,'{}'::jsonb) ? 'movieRetryPlexAcknowledgementV1') THEN RETURN NEW; END IF;
  IF TG_OP<>'UPDATE' OR NOT selected OR COALESCE(NEW.result,'{}'::jsonb) ?| ARRAY['movieRetryRenewalV1','movieRetryRenewalV2']
  THEN RAISE EXCEPTION 'Movie historical acknowledgement cannot manufacture coordinator renewal'; END IF;
  PERFORM media_movie_retry_plex_capture_v1(NEW);
  capture:=NEW.payload->'movieRetryPlexAckV1'; proof:=NEW.result->'movieRetryPlexAcknowledgementV1';
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=capture #>> '{originalInput,attemptId}';
  IF NOT COALESCE(proof ?& ARRAY['schemaVersion','command','originalInput','originalReceiptHash','originalCommandHash','kind','terminal','completed']
    AND proof-ARRAY['schemaVersion','command','originalInput','originalReceiptHash','originalCommandHash','kind','terminal','completed']='{}'::jsonb
    AND proof->'schemaVersion'='1'::jsonb AND proof->'completed'='true'::jsonb AND attempt.state='completed'
    AND proof->'command' ?& ARRAY['schemaVersion','operationId','mediaId','generation','scope']
    AND (proof->'command')-ARRAY['schemaVersion','operationId','mediaId','generation','scope']='{}'::jsonb
    AND proof #> '{command,schemaVersion}'='4'::jsonb AND proof #>> '{command,operationId}'=NEW.id
    AND proof #>> '{command,mediaId}'=NEW."targetId" AND proof #> '{command,generation}'=capture->'generation'
    AND proof #> '{command,scope}'=NEW.payload->'scope'
    AND proof->'originalInput'=capture->'originalInput' AND proof->'originalReceiptHash'=capture->'originalReceiptHash'
    AND proof->'originalCommandHash'=capture->'originalCommandHash'
    AND ((proof->>'kind'='historical_ack' AND proof->'terminal'='null'::jsonb)
      OR (proof->>'kind'='finalization' AND proof->'terminal' ?& ARRAY['root','child']
        AND (proof->'terminal')-ARRAY['root','child']='{}'::jsonb
        AND proof #> '{terminal,root}' ?& ARRAY['workflowId','runId','status']
        AND (proof #> '{terminal,root}')-ARRAY['workflowId','runId','status']='{}'::jsonb
        AND proof #>> '{terminal,root,workflowId}'='media-operation-'||(capture #>> '{originalInput,operationId}')
        AND length(proof #>> '{terminal,root,runId}') BETWEEN 1 AND 200
        AND proof #>> '{terminal,root,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT')
        AND proof #> '{terminal,child}' ?& ARRAY['workflowId','runId','status']
        AND (proof #> '{terminal,child}')-ARRAY['workflowId','runId','status']='{}'::jsonb
        AND proof #>> '{terminal,child,workflowId}'='media-acquire-'||attempt.id
        AND length(proof #>> '{terminal,child,runId}') BETWEEN 1 AND 200
        AND proof #>> '{terminal,child,status}' IN ('COMPLETED','FAILED','CANCELLED','TERMINATED','TIMED_OUT'))),false)
  THEN RAISE EXCEPTION 'Movie historical retry acknowledgement requires exact committed history or real terminal finalization'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_retry_plex_operation_v1 BEFORE INSERT OR UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_movie_retry_plex_operation_v1();

-- Existing V1 trigger functions: only the explicit V2 dispatch blocks below are new.
CREATE OR REPLACE FUNCTION media_movie_retry_coordinator_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation";
BEGIN
  IF NEW."coordinatorOperationId" IS NOT DISTINCT FROM OLD."coordinatorOperationId"
    OR OLD."identityEvidence"->>'schemaVersion' NOT IN ('2','3') OR OLD."identityEvidence"->>'schemaVersion' IS NULL THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT command FROM "Operation" WHERE id=NEW."coordinatorOperationId";
  IF COALESCE(command.payload,'{}'::jsonb) ? 'movieRetryV2' THEN
    PERFORM media_movie_retry_coordinator_check_v2(OLD,NEW,command);
    RETURN NEW;
  END IF;
  PERFORM media_movie_retry_source_v1(command,OLD);
  IF (to_jsonb(NEW)-ARRAY['coordinatorOperationId','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['coordinatorOperationId','updatedAt'])
    OR command.payload #>> '{movieRetryV1,previousCoordinatorOperationId}' IS DISTINCT FROM OLD."coordinatorOperationId"
    OR command.status NOT IN ('queued','running') OR COALESCE(command.result,'{}'::jsonb) ? 'movieRetryRenewalV1'
  THEN RAISE EXCEPTION 'Movie retry may change only the captured current coordinator'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_retry_commit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation"; proof jsonb;
BEGIN
  IF NEW."coordinatorOperationId" IS NOT DISTINCT FROM OLD."coordinatorOperationId"
    OR OLD."identityEvidence"->>'schemaVersion' NOT IN ('2','3') OR OLD."identityEvidence"->>'schemaVersion' IS NULL THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT command FROM "Operation" WHERE id=NEW."coordinatorOperationId";
  IF COALESCE(command.payload,'{}'::jsonb) ? 'movieRetryV2' THEN
    PERFORM media_movie_retry_commit_check_v2(OLD,NEW,command);
    RETURN NEW;
  END IF;
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
