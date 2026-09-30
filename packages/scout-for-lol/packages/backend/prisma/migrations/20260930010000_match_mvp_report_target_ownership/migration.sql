CREATE TABLE "MatchMvpReportTarget" (
  "matchId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MatchMvpReportTarget_pkey" PRIMARY KEY ("matchId", "channelId", "messageId")
);

CREATE INDEX "MatchMvpReportTarget_matchId_serverId_idx"
ON "MatchMvpReportTarget"("matchId", "serverId");

-- A prior successful edit already names the guild and exact message. Keep
-- those targets even if the contest's latest per-channel ref has moved on.
INSERT INTO "MatchMvpReportTarget" ("matchId", "channelId", "serverId", "messageId", "updatedAt")
SELECT r."matchId", split_part(progress.key, ':', 1), r."serverId",
       split_part(progress.key, ':', 2), CURRENT_TIMESTAMP
FROM "MatchMvpTallyRefresh" r
CROSS JOIN LATERAL jsonb_each(r."targetProgress") AS progress(key, value)
WHERE progress.key ~ '^[0-9]+:[0-9]+$'
ON CONFLICT DO NOTHING;

-- A subscription is durable channel-to-guild evidence. Only use channels
-- attributed to exactly one guild, and only for a guild that has a request.
WITH channel_owners AS (
  SELECT "channelId", min("serverId") AS "serverId"
  FROM "Subscription"
  GROUP BY "channelId"
  HAVING count(DISTINCT "serverId") = 1
), contest_refs AS (
  SELECT c."matchId", refs.key AS "channelId", refs.value AS "messageId"
  FROM "MatchMvpContest" c
  CROSS JOIN LATERAL jsonb_each_text(c."reportMessageIds") AS refs(key, value)
  WHERE jsonb_typeof(c."reportMessageIds") = 'object'
)
INSERT INTO "MatchMvpReportTarget" ("matchId", "channelId", "serverId", "messageId", "updatedAt")
SELECT refs."matchId", refs."channelId", owners."serverId", refs."messageId", CURRENT_TIMESTAMP
FROM contest_refs refs
JOIN channel_owners owners ON owners."channelId" = refs."channelId"
JOIN "MatchMvpTallyRefresh" r
  ON r."matchId" = refs."matchId" AND r."serverId" = owners."serverId"
ON CONFLICT DO NOTHING;

-- A pre-upgrade request with refs but no provable guild target cannot be
-- repaired by repeatedly asking Discord for an already missing channel.
-- Preserve its revision and make the uncertainty visible for operator review.
-- A newly observed owned target or report ref reopens it.
UPDATE "MatchMvpTallyRefresh" r
SET "pending" = false,
    "lastErrorCode" = 'legacy-target-ownership-unknown',
    "leaseToken" = NULL,
    "leaseUntil" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "MatchMvpContest" c
WHERE c."matchId" = r."matchId"
  AND r."pending" = true
  AND jsonb_typeof(c."reportMessageIds") = 'object'
  AND c."reportMessageIds" <> '{}'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM "MatchMvpReportTarget" target
    WHERE target."matchId" = r."matchId" AND target."serverId" = r."serverId"
  );
