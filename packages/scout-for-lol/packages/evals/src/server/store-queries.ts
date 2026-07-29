import { z } from "zod";

export const NextVersionRowSchema = z.strictObject({
  nextVersion: z.number().int().positive(),
});

export const NextOrdinalRowSchema = z.strictObject({
  nextOrdinal: z.number().int().nonnegative(),
});

export const CaseCountRowSchema = z.strictObject({
  caseCount: z.number().int().nonnegative(),
});

export const DATASET_SUMMARY_SQL = `
  SELECT
    d.id,
    d.dataset_key AS key,
    d.version,
    d.name,
    d.description,
    d.status,
    COUNT(c.id) AS caseCount,
    COUNT(CASE WHEN latest_rating.generation_id IS NOT NULL THEN 1 END) AS ratedCaseCount,
    d.created_at AS createdAt,
    d.finalized_at AS finalizedAt
  FROM datasets d
  LEFT JOIN dataset_cases c ON c.dataset_id = d.id
  LEFT JOIN generations latest_generation ON latest_generation.id = (
    SELECT generation.id
    FROM generations generation
    WHERE generation.case_id = c.id
    ORDER BY generation.sequence DESC
    LIMIT 1
  )
  LEFT JOIN human_ratings latest_rating
    ON latest_rating.generation_id = latest_generation.id
`;

export const CASE_SUMMARY_SQL = `
  SELECT
    c.id,
    c.dataset_id AS datasetId,
    c.ordinal,
    c.match_id AS matchId,
    c.target_player_name AS targetPlayerName,
    c.champion_name AS championName,
    c.performance_slice AS performanceSlice,
    c.style_key AS styleKey,
    latest_generation.id AS generationId,
    CASE WHEN latest_rating.generation_id IS NULL THEN 0 ELSE 1 END AS isRated
  FROM dataset_cases c
  LEFT JOIN generations latest_generation ON latest_generation.id = (
    SELECT generation.id
    FROM generations generation
    WHERE generation.case_id = c.id
    ORDER BY generation.sequence DESC
    LIMIT 1
  )
  LEFT JOIN human_ratings latest_rating
    ON latest_rating.generation_id = latest_generation.id
`;
