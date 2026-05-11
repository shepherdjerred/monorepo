-- real_pr_experiments — one row per (PR × experiment) — captures the
-- variant the bot used on that real PR, its outcome (cost/latency/posted
-- finding counts), and (when Phase 9's reaction listener lands) the
-- author's accept/dismiss signal. Used by the weekly significance
-- workflow to compute the Bayesian beta-binomial posterior over
-- acceptance rates per variant.
--
-- Distinct from `eval_runs` (which is per-fixture-on-cron) because real
-- PRs have no expectedFindings — quality is measured via author signals,
-- not against a labeled corpus.

BEGIN;

CREATE TABLE IF NOT EXISTS real_pr_experiments (
  id                     BIGSERIAL PRIMARY KEY,

  -- Sticky-hash inputs, kept for audit / re-derivation
  experiment_id          TEXT NOT NULL,
  variant                TEXT NOT NULL,
  repo_full              TEXT NOT NULL,
  pr_number              INT  NOT NULL,
  author                 TEXT NOT NULL,

  -- Run identity (links to Temporal workflow execution)
  bot_run_id             TEXT NOT NULL,
  bot_commit_sha         TEXT NOT NULL,
  assigned_at            TIMESTAMPTZ NOT NULL,

  -- Per-PR outcome
  posted_findings        INT NOT NULL CHECK (posted_findings >= 0),
  cost_usd               DOUBLE PRECISION NOT NULL,
  latency_seconds        DOUBLE PRECISION NOT NULL,
  finished_at            TIMESTAMPTZ NOT NULL,

  -- Author-acceptance signal — populated by Phase 9's reaction listener.
  -- NULL until the listener writes back; tristate avoids needing a
  -- separate "labeled" boolean.
  --   true  = author engaged positively (thumbs-up, applied suggestion,
  --           or merged PR within 48h with no thumbs-down)
  --   false = author dismissed (thumbs-down, "resolved without followup"
  --           heuristic, or explicit dismiss reaction)
  --   NULL  = no signal yet (PR still open, or listener hasn't backfilled)
  accepted               BOOLEAN,
  acceptance_recorded_at TIMESTAMPTZ,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One (experiment, PR) row per repo — re-runs of the same PR (force-
  -- push or sync) reuse the existing row, updating finished_at + cost
  -- in place rather than producing per-push duplicates that would skew
  -- the significance test.
  UNIQUE (experiment_id, repo_full, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_real_pr_experiments_lookup
  ON real_pr_experiments (experiment_id, variant);

CREATE INDEX IF NOT EXISTS idx_real_pr_experiments_finished_at
  ON real_pr_experiments (finished_at DESC);

-- Partial index over the acceptance-labeled subset — the significance
-- workflow queries WHERE accepted IS NOT NULL, so a partial index keeps
-- the working set tight as the corpus grows.
CREATE INDEX IF NOT EXISTS idx_real_pr_experiments_labeled
  ON real_pr_experiments (experiment_id, variant, accepted)
  WHERE accepted IS NOT NULL;

COMMIT;
