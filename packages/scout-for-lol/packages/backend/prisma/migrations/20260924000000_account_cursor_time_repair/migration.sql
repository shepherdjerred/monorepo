-- Repair post-match cursors whose ordering instant ran ahead of their match.
--
-- `Account.lastMatchTime` is the creation time of `lastProcessedMatchId`, and
-- V2's `advanceAccountCursor` guards on it: a match advances the cursor only
-- when it was created strictly after that instant. The stale-account refresh
-- (`match-time-rebuild`) used to overwrite `lastMatchTime` with the newest
-- match in Riot's history without moving `lastProcessedMatchId`. From then on
-- every processed match older than that instant answered `already-applied`,
-- the cursor id froze, and discovery returned the same processed matches on
-- every poll. The writer is fixed in the same change; this repairs the rows it
-- already moved.
--
-- A row is drifted when its cursor match is observed and `lastMatchTime` is
-- later than that match's creation. The repaired cursor is the one the
-- monotonic guard would have produced without the drift: the newest match, by
-- creation, among the standing cursor and every match whose V2 cursor stage
-- already ran for this PUUID (`MatchTrackedAccount.cursorAdvancedAt`). Rows
-- whose cursor match was never observed carry no creation to compare against
-- and are left alone, as is every row that is not drifted, so re-running this
-- statement changes nothing.
WITH drifted AS (
  SELECT a."id", a."puuid", a."lastProcessedMatchId", o."gameCreatedAt" AS "cursorAt"
  FROM "Account" a
  JOIN "MatchObservation" o ON o."riotMatchId" = a."lastProcessedMatchId"
  WHERE a."lastMatchTime" > o."gameCreatedAt"
),
repaired AS (
  SELECT DISTINCT ON (d."id") d."id", c."riotMatchId", c."gameCreatedAt"
  FROM drifted d
  CROSS JOIN LATERAL (
    SELECT o."riotMatchId", o."gameCreatedAt"
    FROM "MatchTrackedAccount" t
    JOIN "MatchObservation" o ON o."riotMatchId" = t."riotMatchId"
    WHERE t."puuid" = d."puuid"
      AND t."cursorAdvancedAt" IS NOT NULL
      AND o."gameCreatedAt" > d."cursorAt"
    UNION ALL
    SELECT d."lastProcessedMatchId", d."cursorAt"
  ) c
  ORDER BY d."id", c."gameCreatedAt" DESC, c."riotMatchId" DESC
)
UPDATE "Account" a
SET "lastProcessedMatchId" = r."riotMatchId",
    "lastMatchTime" = r."gameCreatedAt"
FROM repaired r
WHERE a."id" = r."id";
