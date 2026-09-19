-- MatchSettlementAnnouncement: one item a completed settlement produced, kept
-- so a takeover can announce it without re-running settlement.
--
-- Settlement's steps are one-shot: each returns a summary only for the
-- transition that committed it, so a retry after a partial failure settles
-- nothing and returns nothing. A row here is written inside the same
-- transaction that produces its item, so the two commit together.
--
-- One row per (match, family, item) rather than one per match, because the
-- steps commit separately: a match whose third Dare fails after two settled
-- must keep those two instructions, and a per-match row could not be written
-- until every step had finished.
--
-- Insert-only by design: there is no updatedAt, and a differing payload for a
-- standing row is surfaced as a durable-write conflict by the repository
-- rather than overwriting what the first transition recorded.
--
-- No backfill. The table starts empty and nothing needs one: a row exists only
-- to be consumed by the next attempt of an Activity that has not run yet, and
-- V2 has no production executions, so every match that exists today predates
-- any settlement this would protect.
CREATE TABLE "MatchSettlementAnnouncement" (
    "riotMatchId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchSettlementAnnouncement_pkey" PRIMARY KEY ("riotMatchId", "family", "itemKey")
);

CREATE INDEX "MatchSettlementAnnouncement_riotMatchId_idx"
  ON "MatchSettlementAnnouncement"("riotMatchId");

-- The envelope is versioned; version 0 or negative is not a version this codec
-- can have produced.
ALTER TABLE "MatchSettlementAnnouncement"
  ADD CONSTRAINT "MatchSettlementAnnouncement_version_check"
  CHECK ("version" >= 1);

-- Mirrors the families the announcement sink records.
ALTER TABLE "MatchSettlementAnnouncement"
  ADD CONSTRAINT "MatchSettlementAnnouncement_family_check"
  CHECK ("family" IN ('closure', 'settlement', 'parlay', 'earnings', 'dare-summary'));
