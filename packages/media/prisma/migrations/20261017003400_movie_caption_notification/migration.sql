-- Add caption sources without rewriting older publication notices or their immutable bodies.
CREATE FUNCTION media_movie_caption_notice_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation"; choice "MovieEditionChoice"; target "MediaIntent"; proof JSONB;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.payload->>'kind'='movie_subtitles' THEN RAISE EXCEPTION 'Movie caption notification source is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.payload->>'kind'='movie_subtitles' THEN
    IF (NEW.id,NEW."dedupeKey",NEW."mediaId",NEW."actorId",NEW.kind,NEW.payload) IS DISTINCT FROM (OLD.id,OLD."dedupeKey",OLD."mediaId",OLD."actorId",OLD.kind,OLD.payload)
    THEN RAISE EXCEPTION 'Movie caption notification source is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.payload->>'kind' IS DISTINCT FROM 'movie_subtitles' THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT command FROM "Operation" WHERE id=NEW.payload #>> '{source,operationId}';
  SELECT * INTO STRICT choice FROM "MovieEditionChoice" WHERE id=NEW.payload #>> '{request,choiceId}';
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=NEW."mediaId" AND edition=NEW.payload #>> '{source,scope,edition}';
  proof := command.result #> '{movieSubtitleReceiptV4,receipt}';
  IF NOT COALESCE(NEW.payload->'schemaVersion'='4'::jsonb AND NEW.kind='subtitles_ready'
    AND NEW.payload->>'eventKind'=NEW.kind AND NEW.payload->'source'=proof->'input'
    AND NEW.payload->>'captionHash'=command.result #>> '{movieSubtitleReceiptV4,receiptHash}'
    AND NEW.payload #>> '{source,scope,mediaId}'=NEW."mediaId" AND NEW.payload #>> '{source,scope,rootMediaId}'=NEW."mediaId"
    AND NEW.payload #>> '{asset,id}'=proof #>> '{after,assetId}'
    AND NEW.payload #> '{asset,version}'=proof #> '{after,videoVersion}'
    AND NEW.payload #>> '{asset,checksum}'=proof #>> '{after,videoChecksum}'
    AND NEW.payload->'recoveryEpoch'=proof #> '{after,ownershipEpoch}'
    AND proof #>> '{after,state}'='installed' AND length(NEW.payload->>'targetAuthority')=64
    AND NEW.payload #>> '{request,id}'=choice."requestId" AND NEW.payload #> '{request,choiceRevision}'=to_jsonb(choice."choiceRevision")
    AND choice."rootMediaId"=NEW."mediaId" AND choice.edition=target.edition AND choice."actorId"=NEW."actorId"
    AND target.availability='available' AND to_jsonb(target.generation)=NEW.payload->'generation'
    AND to_jsonb(target."automationEpoch")=NEW.payload->'recoveryEpoch',false)
  THEN RAISE EXCEPTION 'Movie caption notification requires its actual installation and recipient choice'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_caption_notice_event BEFORE INSERT OR UPDATE OR DELETE ON "ApplicationEvent" FOR EACH ROW EXECUTE FUNCTION media_movie_caption_notice_event();

CREATE FUNCTION media_movie_caption_notice_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event "ApplicationEvent"; choice "MovieEditionChoice"; previous "ApplicationEvent";
BEGIN
  SELECT * INTO STRICT event FROM "ApplicationEvent" WHERE id=NEW."eventId";
  IF TG_OP='UPDATE' THEN
    SELECT * INTO STRICT previous FROM "ApplicationEvent" WHERE id=OLD."eventId";
    IF previous.payload->>'kind'='movie_subtitles' AND
      (NEW.id,NEW."eventId",NEW."userId",NEW.channel,NEW."recoveryEpoch") IS DISTINCT FROM (OLD.id,OLD."eventId",OLD."userId",OLD.channel,OLD."recoveryEpoch")
    THEN RAISE EXCEPTION 'Movie caption notification recipient and source are immutable'; END IF;
  END IF;
  IF event.payload->>'kind' IS DISTINCT FROM 'movie_subtitles' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT choice FROM "MovieEditionChoice" WHERE id=event.payload #>> '{request,choiceId}';
  IF NOT COALESCE(NEW."userId"=choice."subjectUserId" AND NEW.channel IN ('email','discord')
    AND to_jsonb(NEW."recoveryEpoch")=event.payload->'recoveryEpoch',false)
  THEN RAISE EXCEPTION 'Movie caption delivery must retain its exact original subject'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_caption_notice_delivery BEFORE INSERT OR UPDATE ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION media_movie_caption_notice_delivery();
