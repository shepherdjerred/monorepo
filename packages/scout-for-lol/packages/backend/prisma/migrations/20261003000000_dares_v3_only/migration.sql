-- Dares are v3 SQL contracts only.
--
-- The operator retires every v1 Dare and every pre-v3 v2 Dare (refunding any
-- open escrow through the shipped paths) before this deploys. These guards
-- refuse to drop money: a Dare still holding contributions in an open state
-- fails the migration instead of being deleted without its refund.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BucksDare"
    WHERE "dareState" IN ('proposed', 'pending_accept', 'active')
  ) THEN
    RAISE EXCEPTION 'Open v1 Dares remain; retire them before migrating';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "BucksDareV2" d
    JOIN "BucksDareV2Revision" r ON r."dareId" = d."id"
    WHERE r."compilerVersion" <> 'dare-scoutql-3'
      AND d."dareState" IN ('pending_accept', 'activating', 'active')
  ) THEN
    RAISE EXCEPTION 'Open pre-v3 Dares remain; retire them before migrating';
  END IF;
  -- A dare-summary result still owed to its channel is a committed public
  -- result that has not been posted. Its Dare is already terminal and will
  -- not settle again, so deleting the intent would lose the result for good;
  -- the operator drains delivery before migrating.
  IF EXISTS (
    SELECT 1 FROM "MatchNotificationIntent"
    WHERE "kind" = 'dare-summary'
      AND "state" IN ('pending', 'ready', 'sending')
  ) THEN
    RAISE EXCEPTION 'Undelivered dare-summary results remain; drain them before migrating';
  END IF;
END $$;

-- The v1 Dare result post is gone; a resolved Dare now posts its result as a
-- channel-targeted dare-status intent. Every dare-summary row left is
-- terminal (the guard above refuses owed ones).
DELETE FROM "MatchNotificationIntent" WHERE "kind" = 'dare-summary';
DELETE FROM "MatchSettlementAnnouncement" WHERE "family" = 'dare-summary';

ALTER TABLE "MatchNotificationIntent"
  DROP CONSTRAINT "MatchNotificationIntent_kind_check";
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_kind_check"
    CHECK ("kind" IN (
      'postmatch', 'prematch', 'settlement', 'hall-record-break',
      'duel-status', 'dare-status'
    ));

-- A resolved Dare posts its public result to its own channel as a
-- channel-targeted dare-status intent beside the participants' DMs.
ALTER TABLE "MatchNotificationIntent"
  DROP CONSTRAINT "MatchNotificationIntent_dare_status_subject_check";
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_dare_status_subject_check"
    CHECK (
      ("kind" = 'dare-status') = ("subjectKind" = 'dare')
      AND (
        "subjectKind" <> 'dare'
        OR (
          "originKind" = 'live'
          AND "targetKind" IN ('dm', 'channel')
          AND "subjectId" ~ '^[1-9][0-9]*$'
        )
      )
    );

-- The family list mirrors SETTLEMENT_ANNOUNCEMENT_FAMILIES, which already
-- includes late-binding earnings.
ALTER TABLE "MatchSettlementAnnouncement"
  DROP CONSTRAINT "MatchSettlementAnnouncement_family_check";
ALTER TABLE "MatchSettlementAnnouncement"
  ADD CONSTRAINT "MatchSettlementAnnouncement_family_check"
  CHECK ("family" IN (
    'closure', 'settlement', 'parlay', 'earnings', 'late-earnings'
  ));

-- Safety net after the operator purge: no pre-v3 contract survives.
DELETE FROM "BucksDareV2"
WHERE "id" IN (
  SELECT "dareId" FROM "BucksDareV2Revision"
  WHERE "compilerVersion" <> 'dare-scoutql-3'
);

-- v1 Dares. Ledger `dare_*` entries carry no foreign key and remain history.
ALTER TABLE "BucksDareContribution" DROP CONSTRAINT "BucksDareContribution_bucksAccountId_fkey";
ALTER TABLE "BucksDareContribution" DROP CONSTRAINT "BucksDareContribution_dareId_fkey";
ALTER TABLE "BucksDareGame" DROP CONSTRAINT "BucksDareGame_dareId_fkey";
ALTER TABLE "BucksDareTarget" DROP CONSTRAINT "BucksDareTarget_dareId_fkey";
DROP TABLE "BucksDareGame";
DROP TABLE "BucksDareContribution";
DROP TABLE "BucksDareTarget";
DROP TABLE "BucksDare";

-- The surviving Dare tables take the names the v1 tables just freed. Every
-- constraint, index, and sequence follows its table so Prisma sees no drift.
ALTER TABLE "BucksDareV2" RENAME TO "BucksDare";
ALTER TABLE "BucksDareV2Activation" RENAME TO "BucksDareActivation";
ALTER TABLE "BucksDareV2Revision" RENAME TO "BucksDareRevision";
ALTER TABLE "BucksDareV2Target" RENAME TO "BucksDareTarget";
ALTER TABLE "BucksDareV2Contribution" RENAME TO "BucksDareContribution";
ALTER TABLE "BucksDareV2Evidence" RENAME TO "BucksDareEvidence";
ALTER TABLE "BucksDare" RENAME CONSTRAINT "BucksDareV2_pkey" TO "BucksDare_pkey";
ALTER TABLE "BucksDareActivation" RENAME CONSTRAINT "BucksDareV2Activation_dareId_fkey" TO "BucksDareActivation_dareId_fkey";
ALTER TABLE "BucksDareActivation" RENAME CONSTRAINT "BucksDareV2Activation_pkey" TO "BucksDareActivation_pkey";
ALTER TABLE "BucksDareContribution" RENAME CONSTRAINT "BucksDareV2Contribution_bucksAccountId_fkey" TO "BucksDareContribution_bucksAccountId_fkey";
ALTER TABLE "BucksDareContribution" RENAME CONSTRAINT "BucksDareV2Contribution_dareId_fkey" TO "BucksDareContribution_dareId_fkey";
ALTER TABLE "BucksDareContribution" RENAME CONSTRAINT "BucksDareV2Contribution_pkey" TO "BucksDareContribution_pkey";
ALTER TABLE "BucksDareEvidence" RENAME CONSTRAINT "BucksDareV2Evidence_dareId_fkey" TO "BucksDareEvidence_dareId_fkey";
ALTER TABLE "BucksDareEvidence" RENAME CONSTRAINT "BucksDareV2Evidence_pkey" TO "BucksDareEvidence_pkey";
ALTER TABLE "BucksDareRevision" RENAME CONSTRAINT "BucksDareV2Revision_dareId_fkey" TO "BucksDareRevision_dareId_fkey";
ALTER TABLE "BucksDareRevision" RENAME CONSTRAINT "BucksDareV2Revision_pkey" TO "BucksDareRevision_pkey";
ALTER TABLE "BucksDareTarget" RENAME CONSTRAINT "BucksDareV2Target_dareId_fkey" TO "BucksDareTarget_dareId_fkey";
ALTER TABLE "BucksDareTarget" RENAME CONSTRAINT "BucksDareV2Target_pkey" TO "BucksDareTarget_pkey";
ALTER INDEX "BucksDareV2Activation_completedAt_nextAttemptAt_requestedAt_idx" RENAME TO "BucksDareActivation_completedAt_nextAttemptAt_requestedAt_idx";
ALTER INDEX "BucksDareV2Contribution_bucksAccountId_idx" RENAME TO "BucksDareContribution_bucksAccountId_idx";
ALTER INDEX "BucksDareV2Contribution_dareId_idx" RENAME TO "BucksDareContribution_dareId_idx";
ALTER INDEX "BucksDareV2Evidence_dareId_gameEndAt_matchId_idx" RENAME TO "BucksDareEvidence_dareId_gameEndAt_matchId_idx";
ALTER INDEX "BucksDareV2Evidence_dareId_matchId_key" RENAME TO "BucksDareEvidence_dareId_matchId_key";
ALTER INDEX "BucksDareV2Revision_dareId_revision_key" RENAME TO "BucksDareRevision_dareId_revision_key";
ALTER INDEX "BucksDareV2Target_dareId_discordId_key" RENAME TO "BucksDareTarget_dareId_discordId_key";
ALTER INDEX "BucksDareV2Target_dareId_targetKey_key" RENAME TO "BucksDareTarget_dareId_targetKey_key";
ALTER INDEX "BucksDareV2_calloutRefreshPending_updatedAt_idx" RENAME TO "BucksDare_calloutRefreshPending_updatedAt_idx";
ALTER INDEX "BucksDareV2_challengerDiscordId_dareState_updatedAt_idx" RENAME TO "BucksDare_challengerDiscordId_dareState_updatedAt_idx";
ALTER INDEX "BucksDareV2_dareState_acceptDeadline_idx" RENAME TO "BucksDare_dareState_acceptDeadline_idx";
ALTER INDEX "BucksDareV2_dareState_deadlineAt_idx" RENAME TO "BucksDare_dareState_deadlineAt_idx";
ALTER INDEX "BucksDareV2_serverId_dareState_updatedAt_idx" RENAME TO "BucksDare_serverId_dareState_updatedAt_idx";
ALTER SEQUENCE "BucksDareV2Contribution_id_seq" RENAME TO "BucksDareContribution_id_seq";
ALTER SEQUENCE "BucksDareV2Evidence_id_seq" RENAME TO "BucksDareEvidence_id_seq";
ALTER SEQUENCE "BucksDareV2Revision_id_seq" RENAME TO "BucksDareRevision_id_seq";
ALTER SEQUENCE "BucksDareV2Target_id_seq" RENAME TO "BucksDareTarget_id_seq";
ALTER SEQUENCE "BucksDareV2_id_seq" RENAME TO "BucksDare_id_seq";

-- The match whose settlement made a Dare terminal, so a retried settlement
-- receipt can name every Dare the match resolved.
ALTER TABLE "BucksDare" ADD COLUMN "settledMatchId" TEXT;
CREATE INDEX "BucksDare_settledMatchId_idx" ON "BucksDare"("settledMatchId");
