import type { z } from "zod";

import { GenerationSetRevisionSchema } from "#shared/schema.ts";
import type {
  FreshnessRatingSchema,
  StyleBatchSchema,
  UpsertFreshnessRatingInputSchema,
} from "#shared/schema.ts";

type StyleReviews = z.infer<typeof StyleBatchSchema>["reviews"];
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
