-- Feed observations contain encrypted provider data, not acquisition or physical authority.
CREATE FUNCTION media_provider_feed_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind='provider_feed_source_v1' THEN RAISE EXCEPTION 'Provider feed source is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.kind='provider_feed_source_v1' OR NEW.kind='provider_feed_source_v1') THEN
    IF (NEW.id,NEW.kind,NEW."dedupeKey",NEW."actorId",NEW."mediaId",NEW.payload,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD.kind,OLD."dedupeKey",OLD."actorId",OLD."mediaId",OLD.payload,OLD."createdAt")
    THEN RAISE EXCEPTION 'Provider feed source is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind='provider_feed_source_v1' AND NOT COALESCE(
    NEW."actorId" IS NULL AND NEW."mediaId" IS NULL AND NEW.payload->'schemaVersion'='1'::jsonb
    AND NEW.payload->>'providerId' IN ('knaben','privatehd','avistaz','animez')
    AND NEW.payload->>'identityHash' ~ '^[a-f0-9]{64}$' AND NEW.payload->>'sourceHash' ~ '^[a-f0-9]{64}$'
    AND NEW."dedupeKey"='feed-source-v1:' || (NEW.payload->>'providerId') || ':' || (NEW.payload->>'identityHash')
    AND length(NEW.payload->>'providerReleaseId')>0 AND length(NEW.payload->>'encryptedSource')>0,false)
  THEN RAISE EXCEPTION 'Provider feed source has no exact captured identity'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER provider_feed_source_immutable BEFORE INSERT OR UPDATE OR DELETE ON "ApplicationEvent" FOR EACH ROW EXECUTE FUNCTION media_provider_feed_source_immutable();

CREATE FUNCTION media_provider_feed_page_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind='provider_feed_page_v1' THEN RAISE EXCEPTION 'Provider feed page receipt is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.kind='provider_feed_page_v1' OR NEW.kind='provider_feed_page_v1') AND NEW IS DISTINCT FROM OLD
  THEN RAISE EXCEPTION 'Provider feed page receipt is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER provider_feed_page_immutable BEFORE UPDATE OR DELETE ON "ReconciliationScan" FOR EACH ROW EXECUTE FUNCTION media_provider_feed_page_immutable();

CREATE FUNCTION media_provider_feed_match_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "ApplicationEvent";
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind='match_provider_feed_source_v1' THEN RAISE EXCEPTION 'Provider feed matching command is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.kind='match_provider_feed_source_v1' OR NEW.kind='match_provider_feed_source_v1') THEN
    IF (NEW.id,NEW.kind,NEW."targetId",NEW."userId",NEW.payload,NEW."idempotencyKey") IS DISTINCT FROM (OLD.id,OLD.kind,OLD."targetId",OLD."userId",OLD.payload,OLD."idempotencyKey")
    THEN RAISE EXCEPTION 'Provider feed matching command is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind<>'match_provider_feed_source_v1' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT source FROM "ApplicationEvent" WHERE id=NEW."targetId";
  IF NOT COALESCE(source.kind='provider_feed_source_v1'
    AND NEW.payload->'schemaVersion'='1'::jsonb AND NEW.payload->>'kind'=NEW.kind
    AND NEW.payload->>'sourceId'=source.id AND NEW.payload->>'operationId'=NEW.id
    AND NEW.payload->'cursor'='null'::jsonb,false)
  THEN RAISE EXCEPTION 'Feed matching requires its actual captured source'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER provider_feed_match_command BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_provider_feed_match_command();

CREATE FUNCTION media_provider_feed_match_progress() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous JSONB; current JSONB;
BEGIN
  IF OLD.kind<>'match_provider_feed_source_v1' THEN RETURN NEW; END IF;
  previous := OLD.result->'feedMatchV1'; current := NEW.result->'feedMatchV1';
  IF current IS NULL THEN
    IF previous IS NOT NULL THEN RAISE EXCEPTION 'Provider feed matching checkpoint cannot disappear'; END IF;
    RETURN NEW;
  END IF;
  IF NOT COALESCE(current->'schemaVersion'='1'::jsonb AND current->>'sourceId'=NEW.payload->>'sourceId'
    AND jsonb_typeof(current->'completed')='boolean'
    AND (current->'cursor'='null'::jsonb OR (jsonb_typeof(current->'cursor')='object'
      AND current #>> '{cursor,mediaId}' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      AND length(current #>> '{cursor,edition}')>0)),false)
  THEN RAISE EXCEPTION 'Provider feed matching checkpoint lost its source or cursor'; END IF;
  IF previous->'completed'='true'::jsonb AND current IS DISTINCT FROM previous
  THEN RAISE EXCEPTION 'Completed provider feed matching checkpoint is immutable'; END IF;
  IF previous->'cursor' IS DISTINCT FROM 'null'::jsonb AND previous IS NOT NULL AND
    (current->'cursor'='null'::jsonb OR (current #>> '{cursor,mediaId}',current #>> '{cursor,edition}') < (previous #>> '{cursor,mediaId}',previous #>> '{cursor,edition}'))
  THEN RAISE EXCEPTION 'Provider feed matching checkpoint cannot regress'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER provider_feed_match_progress BEFORE UPDATE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_provider_feed_match_progress();
