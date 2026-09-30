-- Dare lifecycle and progress DMs have a Dare subject and one frozen recipient.
ALTER TABLE "MatchNotificationIntent"
  DROP CONSTRAINT "MatchNotificationIntent_kind_check";
ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_kind_check"
    CHECK ("kind" IN (
      'postmatch', 'prematch', 'settlement', 'dare-summary',
      'hall-record-break', 'duel-status', 'dare-status'
    ));

ALTER TABLE "MatchNotificationIntent"
  ADD CONSTRAINT "MatchNotificationIntent_dare_status_subject_check"
    CHECK (
      ("kind" = 'dare-status') = ("subjectKind" = 'dare')
      AND (
        "subjectKind" <> 'dare'
        OR (
          "originKind" = 'live'
          AND "targetKind" = 'dm'
          AND "subjectId" ~ '^[1-9][0-9]*$'
        )
      )
    );
