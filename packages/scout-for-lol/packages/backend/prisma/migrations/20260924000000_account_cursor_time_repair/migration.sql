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
--
-- The write is a compare-and-set. The CTEs read a statement-start snapshot, so
-- a cursor writer that commits after that read and before this UPDATE reaches
-- the row would otherwise be overwritten with a value derived from the older
-- row, rewinding an active cursor. The UPDATE therefore also requires the row
-- to still hold the exact cursor the repair was computed from; under READ
-- COMMITTED Postgres re-evaluates that predicate against the newer committed
-- version and skips the row. A row skipped this way was just advanced by a
-- cursor writer, which is the correct owner of it.
WITH drifted AS (
  SELECT a."id", a."puuid", a."lastProcessedMatchId", a."lastMatchTime",
         o."gameCreatedAt" AS "cursorAt"
  FROM "Account" a
  JOIN "MatchObservation" o ON o."riotMatchId" = a."lastProcessedMatchId"
  WHERE a."lastMatchTime" > o."gameCreatedAt"
),
repaired AS (
  SELECT DISTINCT ON (d."id") d."id", c."riotMatchId", c."gameCreatedAt",
         d."lastProcessedMatchId" AS "readMatchId",
         d."lastMatchTime" AS "readMatchTime"
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
WHERE a."id" = r."id"
  AND a."lastProcessedMatchId" = r."readMatchId"
  AND a."lastMatchTime" = r."readMatchTime";
