-- Durable Flex report message IDs for MVP tally refresh. ActiveGame rows
-- expire three hours after detection, so they cannot own live vote furniture.

ALTER TABLE "MatchMvpContest" ADD COLUMN "reportMessageIds" JSONB;
