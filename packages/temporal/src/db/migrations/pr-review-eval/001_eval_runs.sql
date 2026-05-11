-- eval_runs — one row per (fixture, bot-run). Used by the nightly cron to
-- record aggregate scoring and by the regression alert to compute the
-- trailing-7-day mean precision.

BEGIN;

CREATE TABLE IF NOT EXISTS eval_runs (
  id                     BIGSERIAL PRIMARY KEY,
  fixture_id             TEXT NOT NULL,
  fixture_commit_sha     TEXT NOT NULL,
  fixture_category       fixture_category NOT NULL,

  bot_run_id             TEXT NOT NULL,
  bot_commit_sha         TEXT NOT NULL,

  experiment_id          TEXT,
  variant                TEXT,

  tp                     INT NOT NULL CHECK (tp >= 0),
  fp                     INT NOT NULL CHECK (fp >= 0),
  fn                     INT NOT NULL CHECK (fn >= 0),
  precision_value        DOUBLE PRECISION NOT NULL,
  recall_value           DOUBLE PRECISION NOT NULL,

  latency_seconds        DOUBLE PRECISION NOT NULL,
  cost_usd               DOUBLE PRECISION NOT NULL,
  posted_findings        INT NOT NULL CHECK (posted_findings >= 0),

  started_at             TIMESTAMPTZ NOT NULL,
  finished_at            TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_fixture_time
  ON eval_runs (fixture_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_runs_finished_at
  ON eval_runs (finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_runs_experiment
  ON eval_runs (experiment_id, variant)
  WHERE experiment_id IS NOT NULL;

COMMIT;
