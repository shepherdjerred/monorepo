-- A current permission on a genuine new movie birth. No historical add is fabricated.
CREATE FUNCTION media_movie_transfer_consent_v1(p_attempt "AcquisitionAttempt", p_grant jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_access jsonb:=p_grant #> '{consumer,access}'; v_authority jsonb:=p_attempt."movieEditionAuthority";
BEGIN
  IF NOT COALESCE(v_access ?& ARRAY['serverMachineId','movieSectionId'] AND v_access-ARRAY['serverMachineId','movieSectionId']='{}'::jsonb
    AND length(v_access->>'serverMachineId')>0 AND length(v_access->>'movieSectionId')>0,false)
  THEN RAISE EXCEPTION 'Movie transfer grant requires actual configured movie access'; END IF;
  IF p_attempt."identityEvidence"->>'schemaVersion'='2' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "MediaRequest" r JOIN "MovieEditionChoice" c ON c.id=r."movieEditionChoiceId" AND c."choiceRevision"=r."movieEditionChoiceRevision"
      JOIN "MediaUser" actor ON actor.id=c."actorId" JOIN "MediaUser" subject ON subject.id=c."subjectUserId"
      JOIN "PlexIdentityMapping" m ON m."userId"=subject.id
      WHERE r.id=p_attempt."sponsorRequestId" AND r.active AND NOT r.excluded AND r.direct
        AND r."mediaId"=p_grant #>> '{scope,mediaId}' AND r.edition=p_attempt.edition
        AND c.id=p_attempt."movieEditionChoiceId" AND c."choiceRevision"=p_attempt."movieEditionChoiceRevision"
        AND c."actorId"=v_authority->>'actorId' AND c."subjectUserId"=v_authority->>'subjectUserId'
        AND NOT actor.restricted AND NOT subject.restricted AND (actor.id=subject.id OR actor.role='owner')
        AND m."serverMachineId"=v_access->>'serverMachineId' AND m."serverMachineId"=p_attempt."identityEvidence" #>> '{sponsorAuthority,serverMachineId}'
        AND m."verifiedAt"<=clock_timestamp() AND m."verifiedAt"+interval '300 seconds'>clock_timestamp()
        AND (p_grant->>'expiresAt')::timestamptz<=m."verifiedAt"+interval '300 seconds'
        AND 'movie'=ANY(m."permittedMediaKinds") AND v_access->>'movieSectionId'=ANY(m."permittedSectionIds")
        AND ((actor.id=subject.id AND m.kind='account' AND NOT m."plexRestricted") OR (actor.id<>subject.id AND m.kind='managed' AND m."homeUserId" IS NOT NULL))
    ) THEN RAISE EXCEPTION 'Movie transfer grant requires the still-current genuine choice and exact requester mapping'; END IF;
  ELSIF p_attempt."identityEvidence"->>'schemaVersion'='3' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "MediaHandoffReceipt" h JOIN "MediaHandoffPlan" p ON p.id=h."planId" JOIN "MediaUser" u ON u.id=h."actorId"
      JOIN "MediaIntent" t ON t."mediaId"=p_grant #>> '{scope,mediaId}' AND t.edition=p_attempt.edition
      WHERE h.id=v_authority->>'receiptId' AND p.id=v_authority->>'planId' AND p.state='applied'
        AND h."planHash"=v_authority->>'planHash' AND p."planHash"=h."planHash" AND u.role='owner' AND NOT u.restricted
        AND u.id=v_authority->>'actorId' AND h."recoveryEpoch"=p_attempt."recoveryEpoch"
        AND t.monitoring AND t."profileId"=v_authority->>'profileId'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(h.selection #> '{scope,media}') i WHERE i->>'mediaId'=t."mediaId" AND i->'monitored'='true'::jsonb AND i->>'profileId'=t."profileId")
        AND v_authority->>'serverMachineId'=v_access->>'serverMachineId' AND v_authority->>'sectionId'=v_access->>'movieSectionId'
    ) THEN RAISE EXCEPTION 'Movie transfer grant requires its still-current actual owner-approved library policy'; END IF;
  ELSE RAISE EXCEPTION 'Movie transfer grant cannot adopt legacy acquisition identity'; END IF;
END;
$$;

CREATE FUNCTION media_movie_transfer_grant_check_v1(p_command "Operation") RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_envelope jsonb:=p_command.result->'movieTransferReuseGrantV1';
  v_grant jsonb:=v_envelope->'grant'; v_consumer jsonb:=v_grant->'consumer';
  v_origin jsonb:=v_grant->'origin'; v_transfer jsonb:=v_grant->'transfer'; v_scope jsonb:=v_grant->'scope';
  v_attempt "AcquisitionAttempt"; v_owner "AcquisitionAttempt"; v_torrent "Torrent";
  v_target "MediaIntent"; v_assessment "MovieReleaseAssessment"; v_old_assessment "MovieReleaseAssessment";
  v_release "ReleaseCandidate"; v_prior "Operation"; v_writer "LegacyWriterLease"; v_participant "AcquisitionAttempt";
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
  SELECT l.* INTO STRICT v_writer FROM "LegacyWriterLease" l WHERE l.id='singleton';
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

CREATE FUNCTION media_movie_transfer_operation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' AND EXISTS (SELECT 1 FROM "Operation" o WHERE o.result #>> '{movieTransferReuseGrantV1,grant,origin,birthOperationId}'=OLD.id
    OR o.result #>> '{movieTransferReuseGrantV1,grant,origin,coordinatorOperationId}'=OLD.id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Movie transfer original operations must survive'; END IF;
    IF (NEW.id,NEW.payload,NEW.kind,NEW."targetId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD.payload,OLD.kind,OLD."targetId",OLD."createdAt")
    THEN RAISE EXCEPTION 'Movie transfer original operations remain literal'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb)?'movieTransferReuseGrantV1' THEN RAISE EXCEPTION 'Movie transfer grants cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb)?'movieTransferReuseGrantV1' THEN
    IF NEW.result->'movieTransferReuseGrantV1' IS DISTINCT FROM OLD.result->'movieTransferReuseGrantV1'
      OR (NEW.id,NEW.payload,NEW.kind,NEW."targetId") IS DISTINCT FROM (OLD.id,OLD.payload,OLD.kind,OLD."targetId")
    THEN RAISE EXCEPTION 'Movie transfer grant and actual consumer birth are immutable'; END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.result,'{}'::jsonb)?'movieTransferReuseGrantV1' THEN
    IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Movie transfer grant follows its real consumer birth'; END IF;
    IF (NEW.id,NEW.payload,NEW.kind,NEW."targetId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD.payload,OLD.kind,OLD."targetId",OLD."createdAt")
    THEN RAISE EXCEPTION 'Movie transfer grant cannot rewrite consumer birth'; END IF;
    PERFORM media_movie_transfer_grant_check_v1(NEW);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_transfer_operation_v1 BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_movie_transfer_operation_v1();

CREATE FUNCTION media_movie_transfer_attachment_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_birth "Operation";
BEGIN
  IF NEW."torrentId" IS NULL OR (TG_OP='UPDATE' AND NEW."torrentId" IS NOT DISTINCT FROM OLD."torrentId") THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "AcquisitionAttempt" a WHERE a."torrentId"=NEW."torrentId" AND a.id<>NEW.id)
    AND (NEW."identityEvidence"->>'schemaVersion' IN ('2','3') OR EXISTS (SELECT 1 FROM "Operation" o WHERE o.result #>> '{movieTransferReuseGrantV1,grant,transfer,id}'=NEW."torrentId")) THEN
    PERFORM media_plex_assert_deadline();
    SELECT o.* INTO STRICT v_birth FROM "Operation" o WHERE o.id=NEW."operationId";
    IF NOT COALESCE(v_birth.result #>> '{movieTransferReuseGrantV1,grant,consumer,attemptId}'=NEW.id
      AND EXISTS (SELECT 1 FROM "Operation" o WHERE o.id=v_birth.id AND o.xmin::text=(txid_current()%4294967296)::text),false)
    THEN RAISE EXCEPTION 'Shared movie source attachment requires its same-transaction immutable grant'; END IF;
    PERFORM media_movie_transfer_grant_check_v1(v_birth);
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER movie_transfer_attachment_v1 AFTER INSERT OR UPDATE ON "AcquisitionAttempt"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media_movie_transfer_attachment_v1();

CREATE FUNCTION media_movie_transfer_origin_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Operation" o WHERE o.result #>> '{movieTransferReuseGrantV1,grant,consumer,attemptId}'=OLD.id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Movie transfer consumer must retain its actual birth'; END IF;
    IF NEW."torrentId" IS DISTINCT FROM OLD."torrentId" THEN RAISE EXCEPTION 'Movie transfer consumer source link is immutable'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "Operation" o WHERE o.result #>> '{movieTransferReuseGrantV1,grant,origin,attemptId}'=OLD.id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Granted movie source origin must survive'; END IF;
    IF (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt') THEN RAISE EXCEPTION 'Granted movie source origin must remain literal'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_transfer_origin_v1 BEFORE UPDATE OR DELETE ON "AcquisitionAttempt" FOR EACH ROW EXECUTE FUNCTION media_movie_transfer_origin_v1();

CREATE FUNCTION media_movie_transfer_torrent_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_transfers jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM "Operation" o WHERE o.result #>> '{movieTransferReuseGrantV1,grant,transfer,id}'=OLD.id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Granted movie transfer parent must survive'; END IF;
    IF (NEW.id,NEW."infoHash",NEW."qbittorrentId",NEW."providerId",NEW.owned,NEW."ownershipEpoch",NEW."seedingPolicy",NEW."createdAt")
      IS DISTINCT FROM (OLD.id,OLD."infoHash",OLD."qbittorrentId",OLD."providerId",OLD.owned,OLD."ownershipEpoch",OLD."seedingPolicy",OLD."createdAt")
    THEN RAISE EXCEPTION 'Granted movie transfer original ownership and policy are immutable'; END IF;
    IF NEW.observation IS DISTINCT FROM OLD.observation THEN
      SELECT jsonb_agg(o.result #> '{movieTransferReuseGrantV1,grant,transfer}' ORDER BY o.id) INTO v_transfers FROM "Operation" o
        WHERE o.result #>> '{movieTransferReuseGrantV1,grant,transfer,id}'=OLD.id;
      IF v_transfers IS NULL OR jsonb_array_length(v_transfers)=0 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_transfers) p(transfer) WHERE NOT COALESCE(
          NEW.observation #>> '{torrent,hash}'=p.transfer->>'qbittorrentId'
          AND NEW.observation #>> '{torrent,save_path}'=p.transfer->>'savePath'
          AND NEW.observation #>> '{torrent,content_path}'=p.transfer->>'contentPath'
          AND NEW.observation #>> '{torrent,tags}'=p.transfer->>'tags'
          AND NEW.observation #>> '{torrent,category}'=p.transfer->>'category',false))
      THEN RAISE EXCEPTION 'Granted movie source observation cannot manufacture direct consumer ownership'; END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_transfer_torrent_v1 BEFORE UPDATE OR DELETE ON "Torrent" FOR EACH ROW EXECUTE FUNCTION media_movie_transfer_torrent_v1();

-- Retry remains the same genuine consumer and birth; only its actual immutable grant changes source resolution.
CREATE FUNCTION media_movie_transfer_retry_source_v1(p_transfer jsonb, p_attempt "AcquisitionAttempt")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_grant jsonb; v_owner "AcquisitionAttempt"; v_torrent "Torrent"; v_original jsonb;
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT o.result #> '{movieTransferReuseGrantV1,grant}' INTO STRICT v_grant FROM "Operation" o WHERE o.id=p_attempt."operationId";
  SELECT a.* INTO STRICT v_owner FROM "AcquisitionAttempt" a WHERE a.id=v_grant #>> '{origin,attemptId}';
  SELECT t.* INTO STRICT v_torrent FROM "Torrent" t WHERE t.id=p_attempt."torrentId" FOR UPDATE;
  v_original:=v_grant->'transfer';
  IF NOT COALESCE(v_grant #>> '{consumer,attemptId}'=p_attempt.id AND v_grant #>> '{consumer,birthOperationId}'=p_attempt."operationId"
    AND v_grant->'scope'=p_attempt."identityEvidence"->'scope'
    AND v_grant #>> '{origin,birthOperationId}'=v_owner."operationId" AND v_grant #>> '{origin,coordinatorOperationId}'=v_owner."coordinatorOperationId"
    AND v_owner.state='cancelled' AND v_owner."filePlan" IS NULL AND v_owner."torrentId"=v_torrent.id
    AND v_owner."identityEvidence"->'source'=p_attempt."identityEvidence"->'source'
    AND v_owner."identityEvidence"->'scope'=p_attempt."identityEvidence"->'scope'
    AND v_owner."recoveryEpoch"=p_attempt."recoveryEpoch" AND v_torrent.owned
    AND v_torrent."ownershipEpoch"=p_attempt."recoveryEpoch" AND v_torrent.state NOT IN ('removing','removed')
    AND v_original->>'id'=v_torrent.id AND v_original->>'infoHash'=v_torrent."infoHash"
    AND v_original->>'providerId'=v_torrent."providerId" AND v_original->>'qbittorrentId'=v_torrent."qbittorrentId"
    AND p_transfer ?& ARRAY['id','infoHash','qbittorrentId','providerId','ownershipEpoch','observationHash','savePath','contentPath','tags','category','policyHash']
    AND p_transfer-ARRAY['id','infoHash','qbittorrentId','providerId','ownershipEpoch','observationHash','savePath','contentPath','tags','category','policyHash']='{}'::jsonb
    AND (p_transfer-ARRAY['observationHash'])=(v_original-ARRAY['observationHash'])
    AND p_transfer->>'observationHash' ~ '^[a-f0-9]{64}$',false)
  THEN RAISE EXCEPTION 'Movie consumer retry requires its exact original immutable transfer grant and live registered source'; END IF;
END;
$$;

-- Only explicit actual-grant dispatch is added below; ungranted V1/V2 bodies remain literal.
CREATE OR REPLACE FUNCTION media_movie_retry_operation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION media_movie_retry_transfer_v2(proof jsonb, attempt "AcquisitionAttempt")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE transfer jsonb:=proof->'transfer'; observed jsonb; torrent "Torrent"; release "ReleaseCandidate";
BEGIN
  IF attempt.state<>'imported' AND EXISTS (SELECT 1 FROM "Operation" o WHERE o.id=attempt."operationId" AND COALESCE(o.result,'{}'::jsonb)?'movieTransferReuseGrantV1') THEN
    IF proof #>> '{transfer,kind}' IS DISTINCT FROM 'live_observation' THEN RAISE EXCEPTION 'Prepared granted consumer requires live original source'; END IF;
    PERFORM media_movie_transfer_retry_source_v1(proof #> '{transfer,observation}',attempt);
    RETURN;
  END IF;
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
