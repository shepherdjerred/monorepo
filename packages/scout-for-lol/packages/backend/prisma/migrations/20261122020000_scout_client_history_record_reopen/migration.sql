-- Reopen history-only games Riot refused but a paired Scout Client uploaded.
--
-- A game the Scout Client did not witness end (an ARAM: Mayhem game played
-- before the client was installed) reaches the server only as a history
-- bundle. Riot answers 403 for such a game, and until the history record
-- (`local-history-1`) existed no client record could stand in either, so
-- history recovery abandoned it as `riot_match_forbidden`. An abandoned row
-- reopens only when client evidence newer than the decision arrives, and the
-- client never re-sends a bundle it already uploaded, so these rows are
-- reopened here once to be read again under the new record.
--
-- A game that still yields no record is abandoned again on its next attempt.
-- Live (FULL) admissions are left alone: a history record is history-only.
UPDATE "MatchEvidenceAdmission" a
SET "recoveryAbandonedAt" = NULL,
    "recoveryAbandonedReason" = NULL,
    -- Due at once: its own admission time is always in the past.
    "recoveryNextAttemptAt" = a."createdAt"
WHERE a.policy = 'HISTORY_ONLY'
  AND a."recoveryAbandonedReason" IN ('riot_match_forbidden', 'riot_match_not_found')
  AND EXISTS (
    SELECT 1 FROM "ScoutClientObservation" c
    WHERE c.kind = 'post_game' AND c.disposition = 'ACCEPTED'
      AND c."gameId" = substr(a."riotMatchId", strpos(a."riotMatchId", '_') + 1)
      AND lower(c."platformId") = lower(split_part(a."riotMatchId", '_', 1)));
