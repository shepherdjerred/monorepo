-- The durable observer polls this row to reconstruct a run's progress for a
-- client whose SSE request did not land on the process that owns the run.
-- Without somewhere to mirror them, it had to fabricate the status line
-- ("Thinking…") and could not restore the result table at all — so the same
-- run showed different progress depending on which subscribe path won.
--
-- Both are nullable with no default, which is a metadata-only change in
-- PostgreSQL 16: rows written before this migration simply fall back to the
-- old fabricated values.
ALTER TABLE "ScoutInteractiveRun"
  ADD COLUMN "activity" TEXT,
  ADD COLUMN "preview" TEXT;
