-- A notification intent may now announce a Hall of Fame record break: one
-- guild's Hall channel told which records a match broke, keyed
-- `hall-record-break:<riotMatchId>:<guildId>`. The kind CHECK mirrors the
-- domain's closed `NotificationIntentKind` enum, so the new member is added
-- here. Widening only: every existing row already satisfies the new CHECK, so
-- nothing is backfilled, and no producer mints the kind until the progression
-- minting path ships behind its own flag.
ALTER TABLE "MatchNotificationIntent"
  DROP CONSTRAINT "MatchNotificationIntent_kind_check";
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_kind_check"
    CHECK ("kind" IN (
      'postmatch', 'prematch', 'settlement', 'dare-summary', 'hall-record-break'
    ));
