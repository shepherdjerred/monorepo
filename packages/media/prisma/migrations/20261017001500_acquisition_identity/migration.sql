ALTER TABLE "ReleaseCandidate" ADD COLUMN "searchedForMediaIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "sourceEvidence" JSONB;
ALTER TABLE "AcquisitionAttempt" ADD COLUMN "identityEvidence" JSONB;
CREATE FUNCTION media_acquisition_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."identityEvidence" IS DISTINCT FROM OLD."identityEvidence" THEN
    RAISE EXCEPTION 'Acquisition identity evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_acquisition_identity_immutable BEFORE UPDATE ON "AcquisitionAttempt" FOR EACH ROW EXECUTE FUNCTION media_acquisition_identity_immutable();
CREATE FUNCTION media_identity_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.payload ? 'identityDecision' OR NEW.payload ? 'identityDecision') AND (NEW.payload IS DISTINCT FROM OLD.payload OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."targetId" IS DISTINCT FROM OLD."targetId") THEN
    RAISE EXCEPTION 'Acquisition identity decision is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_identity_decision_immutable BEFORE UPDATE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_identity_decision_immutable();
