-- AlterTable
-- Every existing pairing and device keeps ingest only; Explore needs a new
-- pairings/v2 approval.
ALTER TABLE "ScoutClientPairing" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['ingest']::TEXT[];

-- AlterTable
ALTER TABLE "ScoutClientDevice" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['ingest']::TEXT[];

-- A credential always holds at least one scope, and only scopes the desktop
-- contract (data/src/scout-client/desktop-api.contract.json) defines.
ALTER TABLE "ScoutClientPairing" ADD CONSTRAINT "ScoutClientPairing_scopes_check"
  CHECK ("scopes" IS NOT NULL AND cardinality("scopes") > 0 AND "scopes" <@ ARRAY['ingest', 'explore']::TEXT[]);

ALTER TABLE "ScoutClientDevice" ADD CONSTRAINT "ScoutClientDevice_scopes_check"
  CHECK ("scopes" IS NOT NULL AND cardinality("scopes") > 0 AND "scopes" <@ ARRAY['ingest', 'explore']::TEXT[]);
