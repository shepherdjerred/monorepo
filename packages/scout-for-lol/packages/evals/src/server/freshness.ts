import type { Database } from "bun:sqlite";
import { z } from "zod";

import { GenerationSetRevisionSchema } from "#shared/schema.ts";
import type {
  FreshnessRatingSchema,
  StyleBatchSchema,
  UpsertFreshnessRatingInputSchema,
} from "#shared/schema.ts";

type StyleReviews = z.infer<typeof StyleBatchSchema>["reviews"];
const FreshnessAccessRowSchema = z.strictObject({
  generatedCaseCount: z.number().int().nonnegative(),
  missingRatingCount: z.number().int().nonnegative(),
});
export type FreshnessRating = z.infer<typeof FreshnessRatingSchema>;
export type UpsertFreshnessRatingInput = z.input<
  typeof UpsertFreshnessRatingInputSchema
>;

export const UPSERT_FRESHNESS_RATING_SQL = `
  INSERT INTO freshness_ratings (
    dataset_id, style_key, score, note, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(dataset_id, style_key) DO UPDATE SET
    score = excluded.score,
    note = excluded.note,
    updated_at = excluded.updated_at
`;

export const SELECT_FRESHNESS_RATING_SQL = `
  SELECT score, note
  FROM freshness_ratings
  WHERE dataset_id = ? AND style_key = ?
`;

export function generationSetRevision(reviews: StyleReviews): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const review of reviews) {
    hasher.update(review.caseId);
    hasher.update("\0");
    hasher.update(review.generationId);
    hasher.update("\0");
  }
  return GenerationSetRevisionSchema.parse(hasher.digest("hex"));
}

export function requireCurrentGenerationSet(
  expected: z.infer<typeof GenerationSetRevisionSchema>,
  current: z.infer<typeof GenerationSetRevisionSchema>,
): void {
  if (expected !== current) {
    throw new Error(
      "Freshness generation set changed; reload the batch before rating",
    );
  }
}

export function requireFreshnessAvailable(
  database: Database,
  datasetId: string,
): void {
  const access = FreshnessAccessRowSchema.parse(
    database
      .query(
        `SELECT
           COUNT(*) AS generatedCaseCount,
           COUNT(CASE WHEN latest_rating.generation_id IS NULL THEN 1 END)
             AS missingRatingCount
         FROM dataset_cases c
         JOIN generations latest_generation ON latest_generation.id = (
           SELECT generation.id
           FROM generations generation
           WHERE generation.case_id = c.id
           ORDER BY generation.sequence DESC
           LIMIT 1
         )
         LEFT JOIN human_ratings latest_rating
           ON latest_rating.generation_id = latest_generation.id
         WHERE c.dataset_id = ?`,
      )
      .get(datasetId),
  );
  if (access.missingRatingCount > 0) {
    const noun = access.missingRatingCount === 1 ? "case" : "cases";
    const verb = access.missingRatingCount === 1 ? "receives" : "receive";
    throw new Error(
      `Freshness is locked until ${access.missingRatingCount.toString()} current generated ${noun} ${verb} individual ratings`,
    );
  }
}
