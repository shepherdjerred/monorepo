ALTER TABLE "Competition"
ADD COLUMN "gameVariant" TEXT NOT NULL DEFAULT 'MODERN';

ALTER TABLE "CurrentRankSnapshot"
ADD COLUMN "ranked5sRank" TEXT;

ALTER TABLE "Competition"
ALTER COLUMN "maxParticipants" SET DEFAULT 100;

UPDATE "Competition"
SET "gameVariant" = 'CLASSIC'
WHERE ("criteriaConfig"::jsonb ->> 'championId') ~ '^[0-9]+$'
  AND (("criteriaConfig"::jsonb ->> 'championId')::integer >= 60000);

UPDATE "Competition"
SET "criteriaConfig" = (
  ("criteriaConfig"::jsonb - 'queue') ||
  jsonb_build_object(
    'queues',
    CASE COALESCE("criteriaConfig"::jsonb ->> 'queue', 'ALL')
      WHEN 'SOLO' THEN '["solo"]'::jsonb
      WHEN 'FLEX' THEN '["flex"]'::jsonb
      WHEN 'RANKED_ANY' THEN '["solo", "flex"]'::jsonb
      WHEN 'ARENA' THEN '["arena"]'::jsonb
      WHEN 'ARAM' THEN '["aram"]'::jsonb
      WHEN 'URF' THEN '["urf"]'::jsonb
      WHEN 'ARURF' THEN '["arurf"]'::jsonb
      WHEN 'QUICKPLAY' THEN '["quickplay"]'::jsonb
      WHEN 'SWIFTPLAY' THEN '["swiftplay"]'::jsonb
      WHEN 'BRAWL' THEN '["brawl"]'::jsonb
      WHEN 'DRAFT_PICK' THEN '["draft pick"]'::jsonb
      WHEN 'CUSTOM' THEN '["custom"]'::jsonb
      WHEN 'ALL' THEN '["ALL"]'::jsonb
      ELSE jsonb_build_array("criteriaConfig"::jsonb ->> 'queue')
    END
  ) ||
  CASE
    WHEN "criteriaType" IN ('HIGHEST_RANK', 'MOST_RANK_CLIMB')
      THEN '{"aggregation":"MAX"}'::jsonb
    ELSE '{}'::jsonb
  END
)::text;
