-- Release Riot matches the shared match dispatcher wrongly refused as late
-- arrivals.
--
-- The dispatcher's late-arrival watermark was meant for native-client offline
-- history. It also judged Riot discoveries, and Riot discovery polls a
-- rotating subset of accounts with a cursor per account, so one account's
-- older match routinely arrived after another account's newer one. Each was
-- refused before any effect ran: the dispatcher wrote a
-- `v2-client-match-terminal` receipt and started no match Workflow, so the
-- match has no `MatchObservation`. That receipt makes the resume read answer
-- `terminal`, which blocks every later discovery of the match. The routing is
-- fixed in the same change; this deletes the receipts it already wrote.
--
-- The receipt's evidence names only the match, so the refusal reason cannot be
-- read back from the row. The rows are identified by what the refusal alone
-- leaves behind:
--
-- - kind `v2-client-match-terminal`;
-- - recorded at or after 2026-09-25T05:53Z, when the prod dispatcher first
--   started. Every terminal ack in its history is `ClientMatchLateArrival`, and
--   no environment holds a terminal receipt from before then;
-- - no `MatchObservation` for the match. A terminal that followed a match
--   Workflow's own failure after the observation commit keeps its receipt.
--
-- A terminal that a match Workflow reached before committing its observation
-- would also match. None exists in that window: every prod row these
-- predicates select was cross-checked against the dispatcher's history as a
-- `ClientMatchLateArrival` refusal, and beta holds no terminal receipt.
--
-- Deleting only rows these predicates select, a re-run deletes nothing new.
DELETE FROM "MatchProcessingReceipt" r
WHERE r."kind" = 'v2-client-match-terminal'
  AND r."recordedAt" >= TIMESTAMP '2026-09-25 05:53:00'
  AND NOT EXISTS (
    SELECT 1
    FROM "MatchObservation" o
    WHERE o."riotMatchId" = r."riotMatchId"
  );
