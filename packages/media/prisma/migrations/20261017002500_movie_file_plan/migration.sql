CREATE FUNCTION media_movie_file_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan JSONB; entry JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."filePlan"->>'schemaVersion' = '2' AND NEW."filePlan" IS DISTINCT FROM OLD."filePlan" THEN
    RAISE EXCEPTION 'Versioned movie file plan is immutable';
  END IF;
  plan := NEW."filePlan";
  IF plan->>'schemaVersion' = '2' THEN
    entry := plan#>'{entries,0}';
    IF (NEW."identityEvidence"->>'schemaVersion' = '2'
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
CREATE TRIGGER movie_file_plan BEFORE INSERT OR UPDATE ON "AcquisitionAttempt" FOR EACH ROW EXECUTE FUNCTION media_movie_file_plan();
