-- Repair post-match cursors left with NULL lastProcessedMatchId after seed backfill.
--
-- Onboarding (`backfillLastMatchTime`) and `refreshMatchTimes` call
-- `updateLastMatchTime`, which stamps `Account.lastMatchTime` while leaving
-- `Account.lastProcessedMatchId` NULL. Before AI-764, `advanceAccountCursor`
-- required `lastMatchTime IS NULL OR lastMatchTime < matchTime`, so when V2
-- finished that exact seed match (`matchTime = lastMatchTime`) it recorded
-- `MatchTrackedAccount.cursorAdvancedAt` without setting `lastProcessedMatchId`.
--
-- Populate `lastProcessedMatchId` (and align `lastMatchTime`) from the newest
-- observed match whose V2 cursor stage already completed for that PUUID, using
-- compare-and-set predicates so a concurrent cursor writer is never overwritten.
WITH repaired AS (
  SELECT DISTINCT ON (a."id")
    a."id",
    a."lastMatchTime" AS "readMatchTime",
    o."riotMatchId",
    o."gameCreatedAt"
  FROM "Account" a
  JOIN "MatchTrackedAccount" t ON t."puuid" = a."puuid"
  JOIN "MatchObservation" o ON o."riotMatchId" = t."riotMatchId"
  WHERE a."lastProcessedMatchId" IS NULL
    AND t."cursorAdvancedAt" IS NOT NULL
  ORDER BY a."id", o."gameCreatedAt" DESC, o."riotMatchId" DESC
)
UPDATE "Account" a
SET "lastProcessedMatchId" = r."riotMatchId",
    "lastMatchTime" = r."gameCreatedAt"
FROM repaired r
WHERE a."id" = r."id"
  AND a."lastProcessedMatchId" IS NULL
  AND a."lastMatchTime" IS NOT DISTINCT FROM r."readMatchTime";
