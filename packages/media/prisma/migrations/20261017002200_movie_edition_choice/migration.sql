ALTER TABLE "MediaRequest"
  ADD COLUMN "movieEditionChoiceId" TEXT,
  ADD COLUMN "movieEditionChoiceRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AcquisitionAttempt"
  ADD COLUMN "movieEditionChoiceId" TEXT,
  ADD COLUMN "movieEditionChoiceRevision" INTEGER,
  ADD COLUMN "movieEditionAuthority" JSONB;

CREATE UNIQUE INDEX "movie_request_subject_scope_key" ON "MediaRequest"("id", "userId", "mediaId", "edition");
CREATE UNIQUE INDEX "movie_definition_version_key" ON "MediaEditionDefinition"("rootMediaId", "key", "definitionVersion");
CREATE TABLE "MovieEditionChoice" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "choiceRevision" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "subjectUserId" TEXT NOT NULL,
  "rootMediaId" TEXT NOT NULL,
  "edition" TEXT NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "registryVersion" INTEGER NOT NULL,
  "requestVersionAtChoice" INTEGER NOT NULL,
  "authority" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MovieEditionChoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "movie_choice_shape" CHECK (COALESCE(
    "choiceRevision" > 0 AND "definitionVersion" = 0 AND "registryVersion" = 1 AND "requestVersionAtChoice" >= 0
    AND "edition" IN ('default', 'theatrical_cut', 'directors_cut', 'extended_cut', 'final_cut', 'unrated_cut', 'uncut_version')
    AND jsonb_typeof(authority) = 'object'
    AND authority ?& ARRAY['schemaVersion','mode','actorVersion','subjectVersion','mappingVersion','serverMachineId','homeUserId','serverAccountId']
    AND authority - ARRAY['schemaVersion','mode','actorVersion','subjectVersion','mappingVersion','serverMachineId','homeUserId','serverAccountId'] = '{}'::jsonb
    AND authority->'schemaVersion' = '1'::jsonb
    AND authority->>'mode' IN ('self','managed_owner')
    AND jsonb_typeof(authority->'actorVersion') = 'number' AND authority->>'actorVersion' ~ '^[0-9]+$'
    AND jsonb_typeof(authority->'subjectVersion') = 'number' AND authority->>'subjectVersion' ~ '^[0-9]+$'
    AND jsonb_typeof(authority->'mappingVersion') = 'number' AND authority->>'mappingVersion' ~ '^[0-9]+$'
    AND jsonb_typeof(authority->'serverMachineId') = 'string' AND length(authority->>'serverMachineId') > 0
    AND jsonb_typeof(authority->'homeUserId') IN ('string','null')
    AND jsonb_typeof(authority->'serverAccountId') IN ('string','null')
    AND ((authority->>'mode' = 'self' AND "actorId" = "subjectUserId")
      OR (authority->>'mode' = 'managed_owner' AND "actorId" <> "subjectUserId" AND jsonb_typeof(authority->'homeUserId') = 'string')),
    false))
);
CREATE UNIQUE INDEX "movie_choice_revision_key" ON "MovieEditionChoice"("requestId", "choiceRevision");
CREATE UNIQUE INDEX "movie_choice_live_key" ON "MovieEditionChoice"("requestId", "id", "choiceRevision");
CREATE UNIQUE INDEX "movie_choice_attempt_key" ON "MovieEditionChoice"("id", "choiceRevision");
CREATE INDEX "movie_choice_scope_idx" ON "MovieEditionChoice"("rootMediaId", "edition");
ALTER TABLE "MovieEditionChoice" ADD CONSTRAINT "MovieEditionChoice_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "MediaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovieEditionChoice" ADD CONSTRAINT "movie_choice_request_fk" FOREIGN KEY ("requestId", "subjectUserId", "rootMediaId", "edition") REFERENCES "MediaRequest"("id", "userId", "mediaId", "edition") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "MovieEditionChoice" ADD CONSTRAINT "movie_choice_definition_fk" FOREIGN KEY ("rootMediaId", "edition", "definitionVersion") REFERENCES "MediaEditionDefinition"("rootMediaId", "key", "definitionVersion") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "MediaRequest" ADD CONSTRAINT "movie_request_live_choice_fk" FOREIGN KEY ("id", "movieEditionChoiceId", "movieEditionChoiceRevision") REFERENCES "MovieEditionChoice"("requestId", "id", "choiceRevision") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AcquisitionAttempt" ADD CONSTRAINT "movie_attempt_choice_fk" FOREIGN KEY ("movieEditionChoiceId", "movieEditionChoiceRevision") REFERENCES "MovieEditionChoice"("id", "choiceRevision") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "MediaRequest" ADD CONSTRAINT "movie_request_choice_state" CHECK (
  "movieEditionChoiceRevision" >= 0 AND ("movieEditionChoiceId" IS NULL OR (active AND direct AND NOT excluded AND "movieEditionChoiceRevision" > 0))
);
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
);

CREATE FUNCTION media_movie_choice_birth() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request "MediaRequest"; target "MediaIntent"; kind "MediaKind";
BEGIN
  NEW."createdAt" := clock_timestamp();
  SELECT * INTO STRICT request FROM "MediaRequest" WHERE id = NEW."requestId" FOR UPDATE;
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId" = NEW."rootMediaId" AND edition = NEW.edition;
  SELECT "MediaItem".kind INTO STRICT kind FROM "MediaItem" WHERE id = NEW."rootMediaId";
  IF kind <> 'movie' OR target."editionRootId" IS DISTINCT FROM NEW."rootMediaId"
    OR request."userId" <> NEW."subjectUserId" OR request."mediaId" <> NEW."rootMediaId" OR request.edition <> NEW.edition
    OR NEW."choiceRevision" <> request."movieEditionChoiceRevision" + 1
    OR NEW."requestVersionAtChoice" <> request.version + 1 THEN
    RAISE EXCEPTION 'Movie choice must be born for the exact next request revision';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_choice_birth BEFORE INSERT ON "MovieEditionChoice" FOR EACH ROW EXECUTE FUNCTION media_movie_choice_birth();
CREATE FUNCTION media_movie_choice_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Movie choice history is immutable'; END;
$$;
CREATE TRIGGER movie_choice_immutable BEFORE UPDATE OR DELETE ON "MovieEditionChoice" FOR EACH ROW EXECUTE FUNCTION media_movie_choice_immutable();

CREATE FUNCTION media_movie_request_choice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "MediaKind"; choice "MovieEditionChoice"; birth_xid BIGINT;
BEGIN
  SELECT "MediaItem".kind INTO STRICT kind FROM "MediaItem" WHERE id = NEW."mediaId";
  IF kind <> 'movie' THEN
    IF NEW."movieEditionChoiceId" IS NOT NULL OR NEW."movieEditionChoiceRevision" <> 0 THEN
      RAISE EXCEPTION 'Non-movie request cannot carry a movie choice';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."movieEditionChoiceId" IS NOT NULL OR NEW."movieEditionChoiceRevision" <> 0 THEN
      RAISE EXCEPTION 'A request starts without a movie choice';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."movieEditionChoiceRevision" < OLD."movieEditionChoiceRevision"
    OR NEW."movieEditionChoiceRevision" > OLD."movieEditionChoiceRevision" + 1 THEN
    RAISE EXCEPTION 'Movie choice revision must advance monotonically by one';
  END IF;
  IF (OLD.active AND NOT NEW.active) OR (OLD.direct AND NOT NEW.direct) OR (NOT OLD.excluded AND NEW.excluded)
    OR NEW."movieEditionChoiceId" IS DISTINCT FROM OLD."movieEditionChoiceId" THEN
    IF NEW."movieEditionChoiceRevision" <> OLD."movieEditionChoiceRevision" + 1 OR NEW.version <= OLD.version THEN
      RAISE EXCEPTION 'Movie choice changes require a fresh request and choice revision';
    END IF;
  END IF;
  IF NEW."movieEditionChoiceId" IS NOT NULL AND (NEW."movieEditionChoiceId" IS DISTINCT FROM OLD."movieEditionChoiceId"
    OR NEW."movieEditionChoiceRevision" IS DISTINCT FROM OLD."movieEditionChoiceRevision") THEN
    SELECT c.* INTO choice FROM "MovieEditionChoice" c WHERE c.id = NEW."movieEditionChoiceId";
    SELECT c.xmin::text::bigint INTO birth_xid FROM "MovieEditionChoice" c WHERE c.id = NEW."movieEditionChoiceId";
    IF NOT FOUND OR birth_xid <> txid_current() % 4294967296
      OR choice."choiceRevision" <> NEW."movieEditionChoiceRevision" OR choice."requestId" <> NEW.id
      OR choice."requestVersionAtChoice" <> NEW.version THEN
      RAISE EXCEPTION 'Historical movie choice cannot be reattached';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_request_choice BEFORE INSERT OR UPDATE ON "MediaRequest" FOR EACH ROW EXECUTE FUNCTION media_movie_request_choice();

CREATE FUNCTION media_movie_attempt_choice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request "MediaRequest"; choice "MovieEditionChoice"; target "MediaIntent"; definition "MediaEditionDefinition"; movie_count INTEGER; item_count INTEGER; proof JSONB; definition_digest TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."movieEditionChoiceId" IS DISTINCT FROM OLD."movieEditionChoiceId"
      OR NEW."movieEditionChoiceRevision" IS DISTINCT FROM OLD."movieEditionChoiceRevision"
      OR NEW."movieEditionAuthority" IS DISTINCT FROM OLD."movieEditionAuthority"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW."releaseId" IS DISTINCT FROM OLD."releaseId"
      OR NEW."sponsorRequestId" IS DISTINCT FROM OLD."sponsorRequestId"
      OR NEW."mediaIds" IS DISTINCT FROM OLD."mediaIds" OR NEW.edition IS DISTINCT FROM OLD.edition
      OR NEW."operationId" IS DISTINCT FROM OLD."operationId" THEN
      RAISE EXCEPTION 'Acquisition birth identity and movie choice are immutable';
    END IF;
    RETURN NEW;
  END IF;
  NEW."createdAt" := clock_timestamp();
  SELECT count(*), count(*) FILTER (WHERE kind = 'movie') INTO item_count, movie_count FROM "MediaItem" WHERE id = ANY(NEW."mediaIds");
  IF item_count <> cardinality(NEW."mediaIds") OR item_count = 0 THEN RAISE EXCEPTION 'Acquisition coverage is incomplete'; END IF;
  IF movie_count = 0 THEN
    IF NEW."movieEditionChoiceId" IS NOT NULL OR NEW."movieEditionChoiceRevision" IS NOT NULL OR NEW."movieEditionAuthority" IS NOT NULL THEN
      RAISE EXCEPTION 'TV acquisition cannot carry a movie choice';
    END IF;
    RETURN NEW;
  END IF;
  IF movie_count <> 1 OR item_count <> 1 OR NEW."movieEditionChoiceId" IS NULL OR NEW."movieEditionChoiceRevision" IS NULL OR NEW."movieEditionAuthority" IS NULL THEN
    RAISE EXCEPTION 'New movie acquisition requires exact birth choice authority';
  END IF;
  SELECT * INTO STRICT request FROM "MediaRequest" WHERE id = NEW."sponsorRequestId" FOR UPDATE;
  SELECT * INTO STRICT choice FROM "MovieEditionChoice" WHERE id = NEW."movieEditionChoiceId" FOR SHARE;
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId" = request."mediaId" AND edition = NEW.edition;
  SELECT * INTO STRICT definition FROM "MediaEditionDefinition" WHERE "rootMediaId" = choice."rootMediaId" AND key = choice.edition;
  definition_digest := encode(sha256(convert_to(
    '{"definitionVersion":' || definition."definitionVersion"::text
    || ',"key":' || to_json(definition.key)::text
    || ',"pathLabel":' || to_json(definition."pathLabel")::text
    || ',"plexLabel":' || to_json(definition."plexLabel")::text
    || ',"policy":' || to_json(definition.policy)::text
    || ',"rootMediaId":' || to_json(definition."rootMediaId")::text || '}', 'UTF8')), 'hex');
  proof := NEW."movieEditionAuthority";
  IF NOT COALESCE(request.active AND NOT request.excluded AND request.direct
    AND request."movieEditionChoiceId" = choice.id AND request."movieEditionChoiceRevision" = choice."choiceRevision"
    AND choice."choiceRevision" = NEW."movieEditionChoiceRevision" AND choice."requestId" = request.id
    AND choice."subjectUserId" = request."userId" AND choice.edition = NEW.edition AND request.edition = NEW.edition
    AND choice."rootMediaId" = NEW."mediaIds"[1] AND target."editionRootId" = choice."rootMediaId"
    AND choice."createdAt" <= NEW."createdAt"
    AND proof->>'choiceId' = choice.id AND proof->'choiceRevision' = to_jsonb(choice."choiceRevision")
    AND proof->>'sponsorRequestId' = request.id AND proof->'requestVersionAtCapture' = to_jsonb(request.version)
    AND proof->>'rootMediaId' = choice."rootMediaId" AND proof->>'mediaId' = request."mediaId"
    AND proof->>'edition' = NEW.edition AND proof->'definitionVersion' = to_jsonb(choice."definitionVersion")
    AND definition."definitionVersion" = choice."definitionVersion" AND proof->>'definitionDigest' = definition_digest
    AND proof->'targetGenerationAtCapture' = to_jsonb(target.generation)
    AND NEW.generations->request."mediaId" = to_jsonb(target.generation)
    AND proof->>'actorId' = choice."actorId" AND proof->>'subjectUserId' = choice."subjectUserId", false) THEN
    RAISE EXCEPTION 'Movie acquisition birth choice does not match current authority';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_attempt_choice BEFORE INSERT OR UPDATE ON "AcquisitionAttempt" FOR EACH ROW EXECUTE FUNCTION media_movie_attempt_choice();
