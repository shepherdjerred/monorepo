-- Bootstrap the `_migrations` ledger and Finding-mirror enums.
-- Idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS _migrations (
  filename     TEXT PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum     TEXT NOT NULL
);

-- Mirror Finding.kind / Finding.severity / Finding.verifier so the eval
-- store can store typed findings without a denormalized JSON copy. Kept
-- in lockstep with packages/temporal/src/shared/pr-review/finding.ts —
-- when the Zod enum changes, a new migration ADDs the value (Postgres
-- enums can't drop values without recreating the type).

DO $$ BEGIN
  CREATE TYPE finding_kind AS ENUM (
    'correctness',
    'security',
    'performance',
    'convention',
    'deps'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finding_severity AS ENUM (
    'critical',
    'warning',
    'nit'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finding_verifier AS ENUM (
    'typecheck',
    'eslint',
    'grep',
    'test',
    'none'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fixture_category AS ENUM (
    'real-bug',
    'hallucination-target',
    'refactor',
    'convention-drift',
    'cross-file'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
