-- Keep literal v1 transitions and outcomes; new movie transitions carry a distinct v2 scope.
ALTER TABLE "MediaPublicationTransition" DROP CONSTRAINT "media_pub_transition_valid";
ALTER TABLE "MediaPublicationTransition" ADD CONSTRAINT "media_pub_transition_valid" CHECK (
  "birthEpoch" >= 0 AND "filePlanHash" ~ '^[a-f0-9]{64}$' AND "intentHash" ~ '^[a-f0-9]{64}$'
  AND COALESCE("intent"->'schemaVersion' IN ('1'::jsonb, '2'::jsonb) AND "intent"->>'transitionId' = "id"
    AND "intent"->>'attemptId' = "attemptId" AND "intent"->'birthEpoch' = to_jsonb("birthEpoch")
    AND "intent"->>'filePlanHash' = "filePlanHash", FALSE)
  AND (("outcome" IS NULL AND "outcomeHash" IS NULL) OR
    ("outcome" IS NOT NULL AND "outcomeHash" IS NOT NULL AND "outcomeHash" ~ '^[a-f0-9]{64}$'
     AND COALESCE("outcome"->'schemaVersion' = "intent"->'schemaVersion' AND "outcome"->>'transitionId' = "id"
       AND "outcome"->>'intentHash' = "intentHash" AND "outcome"->>'kind' IN ('published','compensated'), FALSE)))
);
CREATE FUNCTION media_movie_publication_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt "AcquisitionAttempt"%ROWTYPE;
BEGIN
  IF NEW.intent->>'schemaVersion' = '2' THEN
    SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id = NEW."attemptId" FOR SHARE;
    IF (attempt."identityEvidence"->>'schemaVersion' = '2' AND attempt."filePlan"->>'schemaVersion' = '2'
      AND NEW.intent->'scope' = attempt."identityEvidence"->'scope'
      AND NEW.intent->'scope' = attempt."filePlan"->'scope'
      AND NEW.intent->>'operationId' = attempt."operationId"
      AND NEW."birthEpoch" = attempt."recoveryEpoch" AND cardinality(attempt."mediaIds") = 1
      AND NEW.intent->'mediaIds' = jsonb_build_array(attempt."mediaIds"[1])
      AND jsonb_array_length(NEW.intent->'entries') = 1
      AND NEW.intent#>'{entries,0,entry}' = attempt."filePlan"#>'{entries,0}'
      AND (NEW.outcome IS NULL OR NEW.outcome->'scope' = NEW.intent->'scope')) IS NOT TRUE
    THEN RAISE EXCEPTION 'Movie publication scope or immutable plan mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_publication_scope BEFORE INSERT OR UPDATE ON "MediaPublicationTransition" FOR EACH ROW EXECUTE FUNCTION media_movie_publication_scope();
