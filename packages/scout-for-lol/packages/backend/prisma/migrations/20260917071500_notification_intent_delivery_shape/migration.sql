-- The V2 notification lane delivers the artifact its render receipt attests
-- to, and an artifact that is missing or hashes differently is a terminal
-- failure about the CONTENT rather than the target. The failure vocabulary
-- CHECK mirrors the domain's closed enum, so the new reason is added here.
ALTER TABLE "MatchNotificationIntent"
  DROP CONSTRAINT "MatchNotificationIntent_failure_vocab_check";
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_failure_vocab_check"
    CHECK (
      "lastFailureClassification" IS NULL OR
      ("lastFailureClassification" = 'retryable' AND "lastFailureReason" IN (
        'network', 'rate-limited', 'service-unavailable', 'timeout'
      )) OR
      ("lastFailureClassification" = 'terminal' AND "lastFailureReason" IN (
        'permission-denied', 'dm-disabled', 'budget-exhausted', 'target-not-found',
        'content-unavailable'
      ))
    );

-- An intent now says what it announces (`kind`) and where the decision came
-- from (`originKind`, with the recovery batch it was born of). Both are
-- mirrored from the notificationIntentCodec's version-2 payload, whose
-- migration derives the kind of a version-1 row from its key prefix — the
-- same rule this backfill applies, so the columns and the migrated payload
-- agree on every existing row. A row under a prefix neither producer ever
-- minted leaves `kind` NULL and the NOT NULL step below refuses the
-- migration, which is the honest outcome: nothing here guesses.
ALTER TABLE "MatchNotificationIntent" ADD COLUMN "kind" TEXT;
ALTER TABLE "MatchNotificationIntent" ADD COLUMN "originKind" TEXT;
ALTER TABLE "MatchNotificationIntent" ADD COLUMN "recoveryBatchId" TEXT;

UPDATE "MatchNotificationIntent"
   SET "kind" = CASE
         WHEN "intentKey" LIKE 'postmatch-discord:%' THEN 'postmatch'
         WHEN "intentKey" LIKE 'prematch-discord:%' THEN 'prematch'
       END,
       "originKind" = 'live';

ALTER TABLE "MatchNotificationIntent" ALTER COLUMN "kind" SET NOT NULL;
ALTER TABLE "MatchNotificationIntent" ALTER COLUMN "originKind" SET NOT NULL;

ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_kind_check"
    CHECK ("kind" IN ('postmatch', 'prematch'));
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_origin_kind_check"
    CHECK ("originKind" IN ('live', 'recovery'));
-- The batch reference is present exactly for a recovery-born intent.
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_origin_batch_check"
    CHECK (("originKind" = 'recovery') = ("recoveryBatchId" IS NOT NULL));

CREATE INDEX "MatchNotificationIntent_recoveryBatchId_idx"
ON "MatchNotificationIntent"("recoveryBatchId");
