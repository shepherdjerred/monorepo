-- MatchSettlementAnnouncement: what one completed settlement produced, kept so
-- a takeover can mint the announcements without re-running settlement.
--
-- Settlement's steps are one-shot: each returns summaries only for the
-- transition that committed them, so a retry after a partial failure settles
-- nothing and returns nothing. Before this table, a death between the
-- settlement commit and the settlement receipt lost the announcements with no
-- record that anything was missing.
--
-- Insert-only by design: there is no updatedAt, and a differing payload for a
-- standing row is surfaced as a durable-write conflict by the repository
-- rather than overwriting what the first settlement recorded.
--
-- No backfill. The table starts empty and nothing needs one: the row exists
-- only to be consumed by the next attempt of an Activity that has not run yet,
-- and V2 has no production executions, so every match that exists today
-- predates any settlement this checkpoint would protect.
CREATE TABLE "MatchSettlementAnnouncement" (
    "riotMatchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchSettlementAnnouncement_pkey" PRIMARY KEY ("riotMatchId")
);

-- The envelope is versioned; version 0 or negative is not a version this
-- codec can have produced.
ALTER TABLE "MatchSettlementAnnouncement"
  ADD CONSTRAINT "MatchSettlementAnnouncement_version_check"
  CHECK ("version" >= 1);
