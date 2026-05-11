-- eval_findings — per-finding TP/FP/FN detail for one eval_run.
-- Used to drill from a precision regression into the specific clusters
-- that flipped.

BEGIN;

DO $$ BEGIN
  CREATE TYPE eval_finding_outcome AS ENUM ('tp', 'fp', 'fn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS eval_findings (
  id                   BIGSERIAL PRIMARY KEY,
  eval_run_id          BIGINT NOT NULL
                          REFERENCES eval_runs(id) ON DELETE CASCADE,
  outcome              eval_finding_outcome NOT NULL,

  -- Cluster key (matches `clusterKey(file, lineStart)` from the shared lib).
  cluster_key          TEXT NOT NULL,

  -- Finding identity. Nullable for FN (no posted finding to record).
  file                 TEXT,
  line_start           INT,
  line_end             INT,
  kind                 finding_kind,
  severity             finding_severity,
  verifier             finding_verifier,
  claim                TEXT,

  -- For FP: which forbidden pattern matched ("substring \"X\"" or
  -- "regex /Y/" or "unexpected finding beyond maxComments=N").
  matched_pattern      TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_findings_run
  ON eval_findings (eval_run_id);

CREATE INDEX IF NOT EXISTS idx_eval_findings_cluster
  ON eval_findings (cluster_key);

COMMIT;
