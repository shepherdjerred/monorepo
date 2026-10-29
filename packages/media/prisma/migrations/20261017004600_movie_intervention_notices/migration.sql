-- Scoped acquisition failures have their own source and recipient identity; old default notices stay literal.
CREATE FUNCTION media_movie_intervention_event_v4() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation"; target "MediaIntent"; choice "MovieEditionChoice"; request "MediaRequest";
  recipient "MediaUser"; attempt "AcquisitionAttempt"; body jsonb; selected jsonb; personal boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.payload->>'kind'='movie_intervention' THEN RAISE EXCEPTION 'Movie intervention source is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.payload->>'kind'='movie_intervention' THEN
    IF (NEW.id,NEW."dedupeKey",NEW."mediaId",NEW."actorId",NEW.kind,NEW.payload)
      IS DISTINCT FROM (OLD.id,OLD."dedupeKey",OLD."mediaId",OLD."actorId",OLD.kind,OLD.payload)
    THEN RAISE EXCEPTION 'Movie intervention source is immutable'; END IF;
    RETURN NEW;
  END IF;
  body:=NEW.payload;
  IF body->>'kind' IS DISTINCT FROM 'movie_intervention' THEN RETURN NEW; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Movie intervention must retain its actual birth'; END IF;
  selected:=body #> '{source,scope}'; personal:=body #>> '{recipient,kind}'='personal';
  SELECT * INTO STRICT command FROM "Operation" WHERE id=body #>> '{source,operationId}';
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=NEW."mediaId" AND edition=selected->>'edition';
  SELECT * INTO STRICT recipient FROM "MediaUser" WHERE id=body #>> '{recipient,userId}';
  IF NOT COALESCE(body ?& ARRAY['schemaVersion','kind','eventKind','source','sourceHash','recoveryEpoch','failure','recipient']
    AND body-ARRAY['schemaVersion','kind','eventKind','source','sourceHash','recoveryEpoch','failure','recipient','attemptId']='{}'::jsonb
    AND body->'schemaVersion'='4'::jsonb AND body->>'sourceHash' ~ '^[a-f0-9]{64}$'
    AND command.kind IN ('reconcile_movie_edition_v4','acquire_movie_edition_v4')
    AND command.payload->>'kind'=command.kind AND command.payload->'schemaVersion'='4'::jsonb
    AND command.payload->>'operationId'=command.id AND command."targetId"=NEW."mediaId"
    AND body->>'eventKind'=NEW.kind AND NEW.kind=CASE WHEN personal THEN 'acquisition_failed' ELSE 'system_intervention' END
    AND body->'source' ?& ARRAY['schemaVersion','operationId','mediaId','generation','scope']
    AND (body->'source')-ARRAY['schemaVersion','operationId','mediaId','generation','scope']='{}'::jsonb
    AND body #> '{source,schemaVersion}'='4'::jsonb AND body #>> '{source,mediaId}'=NEW."mediaId"
    AND body #> '{source,generation}'=command.payload->'generation' AND selected=command.payload->'scope'
    AND selected ?& ARRAY['rootMediaId','mediaId','edition'] AND selected-ARRAY['rootMediaId','mediaId','edition']='{}'::jsonb
    AND selected->>'mediaId'=NEW."mediaId" AND selected->>'rootMediaId'=NEW."mediaId"
    AND body->'recoveryEpoch'=command.payload->'recoveryEpoch'
    AND target."editionRootId"=NEW."mediaId" AND to_jsonb(target.generation)=body #> '{source,generation}'
    AND to_jsonb(target."automationEpoch")=body->'recoveryEpoch'
    AND EXISTS (SELECT 1 FROM "MediaItem" WHERE id=NEW."mediaId" AND kind='movie')
    AND body->'failure' ?& ARRAY['status','reason'] AND (body->'failure')-ARRAY['status','reason']='{}'::jsonb
    AND command.status IN ('failed','reconciling') AND body #>> '{failure,status}'=command.status::text
    AND body #> '{failure,reason}'=COALESCE(command.result->'reason','null'::jsonb)
    AND NOT recipient.restricted
    AND EXISTS (SELECT 1 FROM "NotificationPreference" p WHERE p."userId"=recipient.id AND (p."emailEnabled" OR p."discordEnabled")),false)
  THEN RAISE EXCEPTION 'Movie intervention requires its actual failed scoped command and selected target'; END IF;
  IF personal THEN
    SELECT * INTO STRICT choice FROM "MovieEditionChoice" WHERE id=body #>> '{recipient,choiceId}';
    SELECT * INTO STRICT request FROM "MediaRequest" WHERE id=body #>> '{recipient,requestId}';
    IF NOT COALESCE((body->'recipient') ?& ARRAY['kind','userId','requestId','choiceId','choiceRevision']
      AND (body->'recipient')-ARRAY['kind','userId','requestId','choiceId','choiceRevision']='{}'::jsonb
      AND request.active AND NOT request.excluded AND request.direct
      AND request."userId"=recipient.id AND request."mediaId"=NEW."mediaId" AND request.edition=target.edition
      AND request."movieEditionChoiceId"=choice.id AND request."movieEditionChoiceRevision"=choice."choiceRevision"
      AND choice."requestId"=request.id AND choice."subjectUserId"=recipient.id AND choice."actorId"=NEW."actorId"
      AND choice."rootMediaId"=NEW."mediaId" AND choice.edition=target.edition
      AND to_jsonb(choice."choiceRevision")=body #> '{recipient,choiceRevision}',false)
    THEN RAISE EXCEPTION 'Movie failure notice requires its exact current personal request and choice'; END IF;
  ELSE
    IF NOT COALESCE(body #>> '{recipient,kind}'='owner'
      AND (body->'recipient') ?& ARRAY['kind','userId'] AND (body->'recipient')-ARRAY['kind','userId']='{}'::jsonb
      AND recipient.role='owner' AND NEW."actorId" IS NULL,false)
    THEN RAISE EXCEPTION 'Movie owner intervention requires its actual opted-in owner'; END IF;
  END IF;
  IF body ? 'attemptId' THEN
    SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=body->>'attemptId';
    IF NOT COALESCE((attempt."operationId"=command.id OR attempt."coordinatorOperationId"=command.id)
      AND cardinality(attempt."mediaIds")=1 AND attempt."mediaIds"[1]=NEW."mediaId"
      AND attempt.edition=target.edition AND to_jsonb(attempt."recoveryEpoch")=body->'recoveryEpoch'
      AND attempt."identityEvidence"->>'schemaVersion' IN ('2','3') AND attempt."identityEvidence"->'scope'=selected,false)
    THEN RAISE EXCEPTION 'Movie intervention cannot borrow another acquisition'; END IF;
  ELSIF EXISTS (SELECT 1 FROM "AcquisitionAttempt" a WHERE a."operationId"=command.id OR a."coordinatorOperationId"=command.id)
  THEN RAISE EXCEPTION 'Movie intervention must retain its actual acquisition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_intervention_event_v4 BEFORE INSERT OR UPDATE OR DELETE ON "ApplicationEvent"
  FOR EACH ROW EXECUTE FUNCTION media_movie_intervention_event_v4();

CREATE FUNCTION media_movie_intervention_delivery_v4() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event "ApplicationEvent"; previous "ApplicationEvent";
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT * INTO STRICT previous FROM "ApplicationEvent" WHERE id=OLD."eventId";
    IF previous.payload->>'kind'='movie_intervention' THEN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Movie intervention delivery is immutable'; END IF;
      IF (NEW.id,NEW."eventId",NEW."userId",NEW.channel,NEW."recoveryEpoch")
        IS DISTINCT FROM (OLD.id,OLD."eventId",OLD."userId",OLD.channel,OLD."recoveryEpoch")
      THEN RAISE EXCEPTION 'Movie intervention recipient and source are immutable'; END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO STRICT event FROM "ApplicationEvent" WHERE id=NEW."eventId";
  IF event.payload->>'kind' IS DISTINCT FROM 'movie_intervention' THEN RETURN NEW; END IF;
  IF NOT COALESCE(NEW."userId"=event.payload #>> '{recipient,userId}' AND NEW.channel IN ('email','discord')
    AND to_jsonb(NEW."recoveryEpoch")=event.payload->'recoveryEpoch',false)
  THEN RAISE EXCEPTION 'Movie intervention delivery must retain its original selected recipient'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_intervention_delivery_v4 BEFORE INSERT OR UPDATE OR DELETE ON "NotificationDelivery"
  FOR EACH ROW EXECUTE FUNCTION media_movie_intervention_delivery_v4();

CREATE FUNCTION media_movie_intervention_command_v4() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ApplicationEvent" e WHERE e.payload->>'kind'='movie_intervention'
    AND e.payload #>> '{source,operationId}'=OLD.id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Movie intervention command source is immutable'; END IF;
    IF (NEW.id,NEW.kind,NEW."targetId",NEW."userId",NEW.payload) IS DISTINCT FROM (OLD.id,OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
    THEN RAISE EXCEPTION 'Movie intervention command source is immutable'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_intervention_command_v4 BEFORE UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_movie_intervention_command_v4();
