-- Actual availability observations are independent of immutable assessed source identity.
ALTER TABLE "ReleaseCandidate" ADD COLUMN availability JSONB;
