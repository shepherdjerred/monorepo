CREATE TABLE "MovieReleaseAssessment" (
  id TEXT PRIMARY KEY,
  "releaseId" TEXT NOT NULL REFERENCES "ReleaseCandidate"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "mediaId" TEXT NOT NULL,
  edition TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL CHECK ("sourceHash" ~ '^[a-f0-9]{64}$'),
  "canonicalHash" TEXT NOT NULL CHECK ("canonicalHash" ~ '^[a-f0-9]{64}$'),
  "profileId" TEXT NOT NULL,
  "profileVersion" INTEGER NOT NULL CHECK ("profileVersion" >= 0),
  "profileHash" TEXT NOT NULL CHECK ("profileHash" ~ '^[a-f0-9]{64}$'),
  "parserVersion" TEXT NOT NULL CHECK ("parserVersion" = 'movie-release-v4'),
  raw TEXT NOT NULL CHECK (octet_length(raw) <= 131072),
  assessment JSONB NOT NULL,
  "assessmentHash" TEXT NOT NULL CHECK ("assessmentHash" ~ '^[a-f0-9]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT movie_assessment_target_fk FOREIGN KEY ("mediaId", edition) REFERENCES "MediaIntent"("mediaId", edition) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_assessment_profile_fk FOREIGN KEY ("profileId", "profileVersion") REFERENCES "QualityProfileVersion"("profileId", version) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_assessment_raw CHECK (raw::jsonb = assessment AND encode(sha256(convert_to(raw, 'UTF8')), 'hex') = "assessmentHash"),
  CONSTRAINT movie_assessment_header CHECK (
    (assessment->>'schemaVersion' = '1'
      AND assessment->>'parserVersion' = "parserVersion"
      AND assessment->>'releaseId' = "releaseId"
      AND assessment->>'sourceHash' = "sourceHash"
      AND assessment->>'canonicalHash' = "canonicalHash"
      AND assessment#>>'{scope,mediaId}' = "mediaId"
      AND assessment#>>'{scope,rootMediaId}' = "mediaId"
      AND assessment#>>'{scope,edition}' = edition
      AND assessment#>>'{canonical,kind}' = 'movie'
      AND assessment#>>'{canonical,mediaId}' = "mediaId"
      AND assessment#>>'{profile,id}' = "profileId"
      AND assessment#>>'{profile,version}' = "profileVersion"::text
      AND assessment#>>'{profile,hash}' = "profileHash"
      AND assessment#>>'{cut,schemaVersion}' = '2'
      AND assessment#>>'{cut,parserVersion}' = 'cut-markers-v2'
      AND assessment#>>'{cut,source,kind}' = 'provider') IS TRUE
  )
);
CREATE UNIQUE INDEX movie_assessment_lookup ON "MovieReleaseAssessment"("releaseId", "mediaId", edition, "sourceHash", "canonicalHash", "profileId", "profileVersion", "profileHash", "parserVersion");
CREATE UNIQUE INDEX movie_assessment_identity ON "MovieReleaseAssessment"(id, "assessmentHash");
CREATE INDEX movie_assessment_target ON "MovieReleaseAssessment"("mediaId", edition, "createdAt");

CREATE FUNCTION media_movie_assessment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate "ReleaseCandidate"%ROWTYPE;
BEGIN
  -- Same row lock as the provider snapshot producer, before establishing the immutable reference.
  SELECT * INTO STRICT candidate FROM "ReleaseCandidate" WHERE id = NEW."releaseId" FOR UPDATE;
  IF candidate."sourceEvidence" IS NULL OR candidate."encryptedSource" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "MediaIntent" t JOIN "MediaItem" m ON m.id = t."mediaId"
      WHERE t."mediaId" = NEW."mediaId" AND t.edition = NEW.edition
        AND t."editionRootId" = m.id AND m.kind = 'movie'
    )
    OR (NEW.assessment#>>'{cut,source,providerId}' = candidate."providerId"
      AND NEW.assessment#>>'{cut,source,providerReleaseId}' = candidate."providerReleaseId"
      AND NEW.assessment#>>'{cut,texts,0,text}' = candidate.title) IS NOT TRUE
  THEN RAISE EXCEPTION 'Movie assessment source or target scope mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_assessment_scope BEFORE INSERT ON "MovieReleaseAssessment" FOR EACH ROW EXECUTE FUNCTION media_movie_assessment_scope();
CREATE FUNCTION media_movie_assessment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Movie release assessment is immutable'; END;
$$;
CREATE TRIGGER movie_assessment_immutable BEFORE UPDATE OR DELETE ON "MovieReleaseAssessment" FOR EACH ROW EXECUTE FUNCTION media_movie_assessment_immutable();
CREATE FUNCTION media_assessed_candidate_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MovieReleaseAssessment" WHERE "releaseId" = OLD.id)
    AND (NEW.id IS DISTINCT FROM OLD.id
      OR NEW."providerId" IS DISTINCT FROM OLD."providerId"
      OR NEW."providerReleaseId" IS DISTINCT FROM OLD."providerReleaseId"
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.attributes IS DISTINCT FROM OLD.attributes
      OR NEW."encryptedSource" IS DISTINCT FROM OLD."encryptedSource"
      OR NEW."mediaIds" IS DISTINCT FROM OLD."mediaIds"
      OR NEW."sourceEvidence" IS DISTINCT FROM OLD."sourceEvidence"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt")
  THEN RAISE EXCEPTION 'Assessed provider snapshot is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assessed_candidate_immutable BEFORE UPDATE ON "ReleaseCandidate" FOR EACH ROW EXECUTE FUNCTION media_assessed_candidate_immutable();

CREATE FUNCTION media_movie_attempt_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessed "MovieReleaseAssessment"%ROWTYPE; coordinator_kind TEXT; proof JSONB;
BEGIN
  proof := NEW."identityEvidence";
  SELECT kind INTO coordinator_kind FROM "Operation" WHERE id = COALESCE(NEW."coordinatorOperationId", NEW."operationId");
  IF coordinator_kind IN ('reconcile_movie_edition_v4', 'acquire_movie_edition_v4') OR proof->>'schemaVersion' = '2' THEN
    IF (proof->>'schemaVersion' = '2' AND coordinator_kind IN ('reconcile_movie_edition_v4', 'acquire_movie_edition_v4')) IS NOT TRUE THEN
      RAISE EXCEPTION 'V4 movie attempt requires versioned assessment identity';
    END IF;
    SELECT * INTO STRICT assessed FROM "MovieReleaseAssessment" WHERE id = proof#>>'{assessment,id}';
    IF (cardinality(NEW."mediaIds") = 1
      AND assessed."releaseId" = NEW."releaseId" AND assessed."mediaId" = NEW."mediaIds"[1] AND assessed.edition = NEW.edition
      AND assessed."assessmentHash" = proof#>>'{assessment,hash}'
      AND proof->'scope' = assessed.assessment->'scope' AND proof->'canonical' = assessed.assessment->'canonical'
      AND proof#>>'{source,releaseId}' = NEW."releaseId" AND proof#>>'{source,candidateDigest}' = assessed."sourceHash"
      AND proof->'coverage' = jsonb_build_array(assessed."mediaId")
      AND proof->>'sponsorRequestId' = NEW."sponsorRequestId" AND proof->'birthEpoch' = to_jsonb(NEW."recoveryEpoch")
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
CREATE TRIGGER movie_attempt_assessment BEFORE INSERT ON "AcquisitionAttempt" FOR EACH ROW EXECUTE FUNCTION media_movie_attempt_assessment();
