-- An intent whose audience was deleted before delivery (its subscription, its
-- channel, or Scout's membership of the guild) is retired into `suppressed`
-- with a reason naming what went. The suppression vocabulary CHECK mirrors the
-- domain's closed NotificationSuppressionReason enum, so the three retirement
-- reasons are added here.
ALTER TABLE "MatchNotificationIntent"
  DROP CONSTRAINT "MatchNotificationIntent_suppressed_reason_vocab_check";
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_suppressed_reason_vocab_check"
    CHECK (
      "suppressedReason" IS NULL OR
      "suppressedReason" IN (
        'stale', 'feature-disabled', 'recipient-preference',
        'subscription-deleted', 'channel-deleted', 'guild-left'
      )
    );
