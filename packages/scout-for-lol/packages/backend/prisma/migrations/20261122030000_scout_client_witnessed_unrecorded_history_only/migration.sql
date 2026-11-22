-- Record witnessed client games that live processing never could, silently.
--
-- Every real ARAM: Mayhem capture names each player's lane NONE, which the
-- bundle converter refused until the lane fix, so a witnessed Mayhem game got
-- a live (FULL) admission but no canonical match, and history recovery
-- abandoned it as `riot_match_forbidden` once Riot refused it. Those bundles
-- now convert. Reopened as FULL, recovery would report the game as live and
-- post weeks-old games; the moment for that has passed. So each such game is
-- re-admitted history-only (`late-discovery`: a live game whose decision
-- comes after its window) and reopened, and history recovery records it like
-- any backfill: archived, observed silently, in the lake, with no post,
-- notification or review.
--
-- Only games no live effect ever touched: no observation, report snapshot,
-- notification intent or client selection, and no match-stage receipt
-- (prematch receipts are capture, not effects). Prod has no client evidence.
UPDATE "MatchEvidenceAdmission" a
SET policy = 'HISTORY_ONLY',
    reason = 'late-discovery',
    "recoveryAbandonedAt" = NULL,
    "recoveryAbandonedReason" = NULL,
    "recoveryNextAttemptAt" = a."createdAt"
WHERE a.policy = 'FULL'
  AND a."recoveryAbandonedReason" IN ('riot_match_forbidden', 'riot_match_not_found')
  AND EXISTS (
    SELECT 1 FROM "ScoutClientObservation" c
    WHERE c.kind = 'post_game' AND c.disposition = 'ACCEPTED'
      AND c."gameId" = substr(a."riotMatchId", strpos(a."riotMatchId", '_') + 1)
      AND lower(c."platformId") = lower(split_part(a."riotMatchId", '_', 1)))
  AND NOT EXISTS (SELECT 1 FROM "MatchObservation" o WHERE o."riotMatchId" = a."riotMatchId")
  AND NOT EXISTS (SELECT 1 FROM "MatchReportSnapshot" s WHERE s."riotMatchId" = a."riotMatchId")
  AND NOT EXISTS (SELECT 1 FROM "MatchNotificationIntent" i WHERE i."riotMatchId" = a."riotMatchId")
  AND NOT EXISTS (SELECT 1 FROM "ScoutClientCanonicalMatch" m WHERE m."riotMatchId" = a."riotMatchId")
  AND NOT EXISTS (
    SELECT 1 FROM "MatchProcessingReceipt" r
    WHERE r."riotMatchId" = a."riotMatchId" AND r.kind NOT LIKE '%prematch%');
