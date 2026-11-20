-- Recompute auto-derived priorities under the progressive vote-boost curve
WITH recomputed AS (
  SELECT
    "id",
    CASE
      WHEN "impact" IS NULL AND "urgency" IS NULL AND "voteCount" < 3 THEN 0
      ELSE GREATEST(
        1,
        (
          CASE
            WHEN "impact" IS NULL AND "urgency" IS NULL THEN 4
            WHEN COALESCE("impact"::text, 'medium') = 'high' AND COALESCE("urgency"::text, 'medium') = 'high' THEN 1
            WHEN (COALESCE("impact"::text, 'medium') = 'high' AND COALESCE("urgency"::text, 'medium') = 'medium')
              OR (COALESCE("impact"::text, 'medium') = 'medium' AND COALESCE("urgency"::text, 'medium') = 'high') THEN 2
            WHEN (COALESCE("impact"::text, 'medium') = 'medium' AND COALESCE("urgency"::text, 'medium') = 'medium')
              OR (COALESCE("impact"::text, 'medium') = 'high' AND COALESCE("urgency"::text, 'medium') = 'low')
              OR (COALESCE("impact"::text, 'medium') = 'low' AND COALESCE("urgency"::text, 'medium') = 'high') THEN 3
            ELSE 4
          END
        ) - (
          CASE
            WHEN "voteCount" >= 20 THEN 3
            WHEN "voteCount" >= 8 THEN 2
            WHEN "voteCount" >= 3 THEN 1
            ELSE 0
          END
        )
      )
    END AS "nextPriority"
  FROM "Issue"
  WHERE "priorityManual" = false
)
UPDATE "Issue" AS i
SET "priority" = r."nextPriority"
FROM recomputed AS r
WHERE i."id" = r."id"
  AND i."priority" IS DISTINCT FROM r."nextPriority";
