-- An actual current derived interpretation of literal source bytes. No transfer,
-- requester or imported-history authority is manufactured by this parent.
CREATE INDEX series_pack_interpretation_release ON "Operation" ((payload#>>'{interpretation,releaseId}')) WHERE kind='assess_series_pack_v1';

CREATE FUNCTION media_series_pack_interpretation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE value JSONB; source "ReleaseCandidate"; series "MediaItem"; profile "QualityProfileVersion";
  seasons INTEGER[]; ids TEXT[]; captured JSONB; leaf "MediaItem"; previous INTEGER := 0; raw_range TEXT[];
BEGIN
  PERFORM media_plex_assert_deadline();
  value := NEW.payload->'interpretation';
  IF NOT COALESCE(NEW.kind='assess_series_pack_v1' AND NEW.status='completed' AND NEW."userId" IS NULL AND NEW.result IS NULL,false)
  THEN RAISE EXCEPTION 'Series pack interpretation requires an actual completed actorless assessment'; END IF;
  IF NOT COALESCE(NEW."createdAt">=transaction_timestamp()::timestamp(3)
    AND NEW."createdAt"<=clock_timestamp()::timestamp(3),false)
  THEN RAISE EXCEPTION 'Series pack interpretation creation must occur within its actual transaction'; END IF;
  IF NOT COALESCE(NEW.payload->>'schemaVersion'='1' AND NEW.payload->>'kind'=NEW.kind
    AND value->>'schemaVersion'='1' AND value->>'parserVersion'='series-season-range-v1'
    AND NEW.payload->>'interpretationHash' ~ '^[a-f0-9]{64}$'
    AND octet_length(NEW.payload->>'raw') BETWEEN 1 AND 131072
    AND octet_length(NEW.payload->>'sourceRaw') BETWEEN 1 AND 131072
    AND octet_length(NEW.payload->>'profileRaw') BETWEEN 1 AND 131072
    AND (NEW.payload->>'raw')::jsonb=value,false)
  THEN RAISE EXCEPTION 'Series pack interpretation requires actual bounded immutable source bytes'; END IF;
  IF NOT COALESCE(encode(sha256(convert_to(NEW.payload->>'raw','UTF8')),'hex')=NEW.payload->>'interpretationHash',false)
  THEN RAISE EXCEPTION 'Series pack interpretation literal assessment hash changed'; END IF;
  IF NOT COALESCE(encode(sha256(convert_to(NEW.payload->>'sourceRaw','UTF8')),'hex')=value->>'sourceHash',false)
  THEN RAISE EXCEPTION 'Series pack interpretation original source hash changed'; END IF;
  IF NOT COALESCE(encode(sha256(convert_to(NEW.payload->>'profileRaw','UTF8')),'hex')=value#>>'{profile,hash}',false)
  THEN RAISE EXCEPTION 'Series pack interpretation original profile hash changed'; END IF;
  SELECT * INTO STRICT source FROM "ReleaseCandidate" WHERE id=value->>'releaseId' FOR UPDATE;
  SELECT * INTO STRICT series FROM "MediaItem" WHERE id=value->>'seriesId';
  SELECT * INTO STRICT profile FROM "QualityProfileVersion" WHERE "profileId"=value#>>'{profile,id}' AND version=(value#>>'{profile,version}')::integer;
  IF NOT COALESCE(source."sourceEvidence" IS NOT NULL AND source."encryptedSource" IS NOT NULL
    AND (NEW.payload->>'sourceRaw')::jsonb=jsonb_build_object('providerId',source."providerId",'providerReleaseId',source."providerReleaseId",'title',source.title,'attributes',source.attributes,'source',source."sourceEvidence")
    AND (NEW.payload->>'profileRaw')::jsonb=profile.rules
    AND series.kind='series' AND series."catalogState"='ready' AND NEW."targetId"=series.id
    AND value#>>'{canonical,kind}'='series' AND value#>>'{canonical,coordinates,schemaVersion}'='1'
    AND value#>>'{canonical,coordinates,seriesId}'=series.id AND value#>>'{canonical,coordinates,catalogComplete}'='true'
    AND value#>>'{range,schemaVersion}'='1' AND value#>>'{range,kind}'='explicit_season_range'
    AND (value#>>'{range,start}')::integer>=1 AND (value#>>'{range,end}')::integer>(value#>>'{range,start}')::integer
    AND (value#>>'{range,end}')::integer<=999
    AND jsonb_array_length(value#>'{range,seasons}') BETWEEN 2 AND 100
    AND jsonb_array_length(value#>'{range,seasons}')=(value#>>'{range,end}')::integer-(value#>>'{range,start}')::integer+1
    AND position(value#>>'{range,raw}' IN source.title)>0
    AND value#>>'{attributes,identityConfidence}'='exact',false)
  THEN RAISE EXCEPTION 'Series pack source, catalog, range or profile parent changed'; END IF;
  raw_range := regexp_match(value#>>'{range,raw}', '^S([0-9]{1,3})[ ._]*-[ ._]*S([0-9]{1,3})$', 'i');
  IF NOT COALESCE(raw_range[1]::integer=(value#>>'{range,start}')::integer AND raw_range[2]::integer=(value#>>'{range,end}')::integer,false)
  THEN RAISE EXCEPTION 'Series pack range differs from its actual literal source token'; END IF;
  FOR captured IN SELECT item FROM jsonb_array_elements(value#>'{range,seasons}') item LOOP
    IF captured::text::integer<>(value#>>'{range,start}')::integer+previous THEN RAISE EXCEPTION 'Season set must be complete and ordered'; END IF;
    previous := previous+1;
  END LOOP;
  SELECT array_agg(item::text::integer ORDER BY ordinal) INTO seasons FROM jsonb_array_elements(value#>'{range,seasons}') WITH ORDINALITY e(item,ordinal);
  SELECT array_agg(e.id ORDER BY e.id) INTO ids FROM "MediaItem" e WHERE e.kind='episode' AND e."seasonNumber"=ANY(seasons)
    AND (e."parentId"=series.id OR EXISTS (SELECT 1 FROM "MediaItem" season WHERE season.id=e."parentId" AND season.kind='season' AND season."parentId"=series.id));
  IF NOT COALESCE(cardinality(ids) BETWEEN 1 AND 100
    AND value#>'{attributes,mediaIds}'=to_jsonb(ids)
    AND jsonb_array_length(value#>'{canonical,coordinates,episodes}')=cardinality(ids)
    AND (SELECT jsonb_agg(e->>'mediaId' ORDER BY e->>'mediaId') FROM jsonb_array_elements(value#>'{canonical,coordinates,episodes}') e)=to_jsonb(ids)
    AND NOT EXISTS (SELECT 1 FROM unnest(seasons) s WHERE NOT EXISTS (SELECT 1 FROM "MediaItem" e WHERE e.id=ANY(ids) AND e."seasonNumber"=s))
    AND NOT EXISTS (SELECT 1 FROM "MediaItem" e WHERE e.id=ANY(ids) AND (e."catalogState"<>'ready' OR e."airDate">clock_timestamp())),false)
  THEN RAISE EXCEPTION 'Series pack requires the complete bounded catalog of every named season'; END IF;
  FOR captured IN SELECT item FROM jsonb_array_elements(value#>'{canonical,coordinates,episodes}') item LOOP
    SELECT * INTO STRICT leaf FROM "MediaItem" WHERE id=captured->>'mediaId';
    IF NOT COALESCE(leaf.id=ANY(ids) AND leaf.kind='episode' AND captured->>'seriesId'=series.id
      AND captured->'seasonNumber'=to_jsonb(leaf."seasonNumber") AND captured->'episodeNumber'=to_jsonb(leaf."episodeNumber")
      AND captured->'mediaVersion'=to_jsonb(leaf.version),false)
    THEN RAISE EXCEPTION 'Series pack canonical leaf differs from actual current catalog'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "OutboxCommand" WHERE "operationId"=NEW.id) THEN RAISE EXCEPTION 'An interpretation parent cannot dispatch a Workflow'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_interpretation_birth BEFORE INSERT ON "Operation" FOR EACH ROW WHEN (NEW.kind='assess_series_pack_v1') EXECUTE FUNCTION media_series_pack_interpretation_v1();

CREATE FUNCTION media_series_pack_parent_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Series pack interpretation parent is immutable'; END;
$$;
CREATE TRIGGER series_pack_parent_immutable BEFORE UPDATE OR DELETE ON "Operation" FOR EACH ROW WHEN (OLD.kind='assess_series_pack_v1') EXECUTE FUNCTION media_series_pack_parent_immutable_v1();

CREATE FUNCTION media_series_pack_no_outbox_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Operation" WHERE id=NEW."operationId" AND kind='assess_series_pack_v1')
  THEN RAISE EXCEPTION 'An interpretation parent cannot dispatch a Workflow'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_no_outbox BEFORE INSERT OR UPDATE ON "OutboxCommand" FOR EACH ROW EXECUTE FUNCTION media_series_pack_no_outbox_v1();

CREATE FUNCTION media_series_pack_source_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Operation" p WHERE p.kind='assess_series_pack_v1' AND p.payload#>>'{interpretation,releaseId}'=OLD.id)
    AND (TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW."providerId" IS DISTINCT FROM OLD."providerId"
      OR NEW."providerReleaseId" IS DISTINCT FROM OLD."providerReleaseId" OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.attributes IS DISTINCT FROM OLD.attributes OR NEW."mediaIds" IS DISTINCT FROM OLD."mediaIds"
      OR NEW."sourceEvidence" IS DISTINCT FROM OLD."sourceEvidence" OR NEW."encryptedSource" IS DISTINCT FROM OLD."encryptedSource"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt")
  THEN RAISE EXCEPTION 'Series pack assessed provider snapshot is immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER series_pack_source_immutable BEFORE UPDATE OR DELETE ON "ReleaseCandidate" FOR EACH ROW EXECUTE FUNCTION media_series_pack_source_immutable_v1();

CREATE FUNCTION media_series_pack_selection_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected JSONB; parent "Operation"; value JSONB; target "MediaIntent";
BEGIN
  selected := NEW.result->'seriesPackSelectionV1';
  IF TG_OP='UPDATE' AND OLD.result ? 'seriesPackSelectionV1' THEN
    IF NEW.result->'seriesPackSelectionV1' IS DISTINCT FROM OLD.result->'seriesPackSelectionV1' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."targetId" IS DISTINCT FROM OLD."targetId" OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW."userId" IS DISTINCT FROM OLD."userId"
    THEN RAISE EXCEPTION 'Series pack selected interpretation is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF selected IS NULL THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT parent FROM "Operation" WHERE id=selected#>>'{selected,operationId}';
  value := parent.payload->'interpretation';
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=NEW."targetId" AND edition='default';
  IF NOT COALESCE(NEW.kind IN ('reconcile_media','acquire_release') AND parent.kind='assess_series_pack_v1' AND parent.status='completed'
    AND selected->>'schemaVersion'='1' AND selected->>'releaseId'=value->>'releaseId'
    AND selected->>'primaryMediaId'=NEW."targetId" AND NEW.payload->>'mediaId'=NEW."targetId" AND NEW.payload->>'operationId'=NEW.id
    AND selected->'generation'=NEW.payload->'generation' AND selected->'generation'=to_jsonb(target.generation)
    AND target."desiredPresence" AND target.monitoring AND target."intentionallyRemovedAt" IS NULL AND target."editionRootId"=value->>'seriesId'
    AND target."profileId"=value#>>'{profile,id}' AND value#>'{attributes,mediaIds}' @> to_jsonb(NEW."targetId")
    AND selected#>>'{selected,schemaVersion}'='1' AND selected#>>'{selected,interpretationHash}'=parent.payload->>'interpretationHash'
    AND selected#>'{selected,attributes}'=value->'attributes',false)
  THEN RAISE EXCEPTION 'Series pack selection must retain its actual current coordinator and complete parent'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_selection_insert BEFORE INSERT ON "Operation" FOR EACH ROW WHEN (NEW.result ? 'seriesPackSelectionV1') EXECUTE FUNCTION media_series_pack_selection_v1();
CREATE TRIGGER series_pack_selection_update BEFORE UPDATE ON "Operation" FOR EACH ROW WHEN (NEW.result ? 'seriesPackSelectionV1' OR OLD.result ? 'seriesPackSelectionV1') EXECUTE FUNCTION media_series_pack_selection_v1();

CREATE FUNCTION media_series_pack_attempt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured JSONB; parent "Operation"; coordinator "Operation"; value JSONB; leaf_id TEXT; target "MediaIntent"; coordinate JSONB; original JSONB; leaf "MediaItem";
BEGIN
  PERFORM media_plex_assert_deadline();
  captured := NEW."identityEvidence"#>'{source,seriesPackV1}';
  SELECT * INTO STRICT parent FROM "Operation" WHERE id=captured->>'operationId';
  SELECT * INTO STRICT coordinator FROM "Operation" WHERE id=NEW."operationId";
  value := parent.payload->'interpretation';
  IF NOT COALESCE(NEW.edition='default' AND NEW."identityEvidence"->>'schemaVersion' IN ('1','4') AND NEW."identityEvidence"#>>'{canonical,kind}'='series'
    AND NEW."movieEditionChoiceId" IS NULL AND NEW."movieEditionChoiceRevision" IS NULL AND NEW."movieEditionAuthority" IS NULL
    AND parent.kind='assess_series_pack_v1' AND parent.status='completed' AND parent."userId" IS NULL
    AND captured->>'schemaVersion'='1' AND captured->>'interpretationHash'=parent.payload->>'interpretationHash' AND captured->'attributes'=value->'attributes'
    AND NEW."releaseId"=value->>'releaseId' AND NEW."identityEvidence"#>>'{source,releaseId}'=NEW."releaseId" AND NEW."identityEvidence"#>>'{source,candidateDigest}'=value->>'sourceHash'
    AND NEW."identityEvidence"#>>'{canonical,coordinates,seriesId}'=value->>'seriesId' AND NEW."identityEvidence"->'coverage'=to_jsonb(NEW."mediaIds") AND value#>'{attributes,mediaIds}'=to_jsonb(NEW."mediaIds")
    AND NEW."identityEvidence"#>'{canonical,coordinates,fullSeriesNumberingDigest}'=value#>'{canonical,coordinates,fullSeriesNumberingDigest}'
    AND jsonb_array_length(NEW."identityEvidence"#>'{canonical,coordinates,episodes}')=cardinality(NEW."mediaIds")
    AND coordinator.kind IN ('reconcile_media','acquire_release') AND coordinator.result#>>'{seriesPackSelectionV1,releaseId}'=NEW."releaseId" AND coordinator.result#>'{seriesPackSelectionV1,selected}'=captured
    AND NEW.failure->>'profileId'=value#>>'{profile,id}' AND NEW.failure->'profileVersion'=value#>'{profile,version}'
    AND NEW."identityEvidence"->'birthEpoch'=to_jsonb(NEW."recoveryEpoch") AND coordinator.payload->'recoveryEpoch'=to_jsonb(NEW."recoveryEpoch")
    AND EXISTS (SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active' AND r."recoveryEpoch"=NEW."recoveryEpoch"),false)
  THEN RAISE EXCEPTION 'Series pack attempt requires its actual selected immutable source interpretation'; END IF;
  FOREACH leaf_id IN ARRAY NEW."mediaIds" LOOP
    SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=leaf_id AND edition='default';
    SELECT * INTO STRICT leaf FROM "MediaItem" WHERE id=leaf_id;
    SELECT e INTO STRICT coordinate FROM jsonb_array_elements(NEW."identityEvidence"#>'{canonical,coordinates,episodes}') e WHERE e->>'mediaId'=leaf_id;
    SELECT e INTO STRICT original FROM jsonb_array_elements(value#>'{canonical,coordinates,episodes}') e WHERE e->>'mediaId'=leaf_id;
    IF NOT COALESCE(target."editionRootId"=value->>'seriesId' AND target."desiredPresence" AND target.monitoring AND target."intentionallyRemovedAt" IS NULL
      AND target."profileId"=value#>>'{profile,id}' AND target."automationEpoch"=NEW."recoveryEpoch" AND NEW.generations->leaf_id=to_jsonb(target.generation)
      AND coordinate->'seasonNumber'=original->'seasonNumber' AND coordinate->'seasonNumber'=to_jsonb(leaf."seasonNumber")
      AND coordinate->'episodeNumber'=original->'episodeNumber' AND coordinate->'episodeNumber'=to_jsonb(leaf."episodeNumber")
      AND coordinate->'tmdbEpisodeId'=original->'tmdbEpisodeId' AND coordinate->'absoluteNumber'=original->'absoluteNumber'
      AND coordinate->>'seriesId'=value->>'seriesId'
      AND (CASE WHEN coordinate#>>'{numberingProvenance,kind}'='legacy_owner' THEN (coordinate->'numberingProvenance')-'version' ELSE coordinate->'numberingProvenance' END)
        =(CASE WHEN original#>>'{numberingProvenance,kind}'='legacy_owner' THEN (original->'numberingProvenance')-'version' ELSE original->'numberingProvenance' END),false)
    THEN RAISE EXCEPTION 'Series pack attempt lost current complete leaf authority'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_attempt BEFORE INSERT ON "AcquisitionAttempt" FOR EACH ROW WHEN (NEW."identityEvidence"->'source' ? 'seriesPackV1') EXECUTE FUNCTION media_series_pack_attempt_v1();

CREATE FUNCTION media_series_pack_attempt_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."identityEvidence" IS DISTINCT FROM OLD."identityEvidence" OR NEW."mediaIds" IS DISTINCT FROM OLD."mediaIds" OR NEW."releaseId" IS DISTINCT FROM OLD."releaseId"
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW."operationId" IS DISTINCT FROM OLD."operationId" OR NEW.edition IS DISTINCT FROM OLD.edition OR NEW."recoveryEpoch" IS DISTINCT FROM OLD."recoveryEpoch"
    OR NEW."sponsorRequestId" IS DISTINCT FROM OLD."sponsorRequestId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN RAISE EXCEPTION 'Series pack acquired identity is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_attempt_immutable BEFORE UPDATE ON "AcquisitionAttempt" FOR EACH ROW WHEN (OLD."identityEvidence"->'source' ? 'seriesPackV1') EXECUTE FUNCTION media_series_pack_attempt_immutable_v1();
