-- MatchObservation.deliveryMode: whether the match was discovered live or as a
-- silent backfill.
--
-- v1 had a silent-backfill delivery mode (its ingest source label
-- `postmatch_silent_backfill` vs `postmatch_live`). V2 restarts a stalled
-- match from the match id alone, via this row, and live-vs-backfill is a
-- discovery-time decision that cannot be re-derived from the durable facts —
-- so the mode has to live on the observation. NOT NULL with no default: a
-- producer that does not know the mode is refused rather than defaulted.
ALTER TABLE "MatchObservation" ADD COLUMN "deliveryMode" TEXT;

-- Backfill for rows that predate the column. The observation row never
-- persisted v1's source label, so the stored mode cannot be derived from the
-- row; every pre-feature row was already delivered (or deliberately not
-- delivered) under v1 semantics by the time this migration runs, and 'live'
-- is the mode under which nothing further will be re-decided for them.
UPDATE "MatchObservation" SET "deliveryMode" = 'live' WHERE "deliveryMode" IS NULL;

ALTER TABLE "MatchObservation" ALTER COLUMN "deliveryMode" SET NOT NULL;

-- Mirrors the domain's MatchDeliveryMode enum (match-processing/states).
ALTER TABLE "MatchObservation"
  ADD CONSTRAINT "MatchObservation_delivery_mode_check"
  CHECK ("deliveryMode" IN ('live', 'silent-backfill'));
