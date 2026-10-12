-- Duel status is a text-only notification whose durable subject is a series,
-- not a Riot match. Widen the kind vocabulary before its producer mints rows.
ALTER TABLE "MatchNotificationIntent"
  DROP CONSTRAINT "MatchNotificationIntent_kind_check";
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_kind_check"
    CHECK ("kind" IN (
      'postmatch', 'prematch', 'settlement', 'dare-summary',
      'hall-record-break', 'duel-status'
    ));

ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_duel_status_subject_check"
    CHECK (
      ("kind" = 'duel-status') = ("subjectKind" = 'duel')
      AND ("subjectKind" <> 'duel' OR ("originKind" = 'live' AND "targetKind" = 'channel'))
    );
