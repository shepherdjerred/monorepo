import type { Database } from "bun:sqlite";
import { z } from "zod";

import { GenerationSetRevisionSchema } from "#shared/schema.ts";
import type {
  FreshnessRatingSchema,
  UpsertFreshnessRatingInputSchema,
} from "#shared/schema.ts";

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

type GenerationSetMember = { caseId: string; generationId: string };

export function generationSetRevision(
  reviews: readonly GenerationSetMember[],
): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const review of reviews) {
    hasher.update(review.caseId);
    hasher.update("\0");
    hasher.update(review.generationId);
    hasher.update("\0");
  }
  return GenerationSetRevisionSchema.parse(hasher.digest("hex"));
}

type ExportedStyleCase = {
  id: string;
  ordinal: number;
  artifact: { styleKey: string };
  generations: readonly { generation: { id: string } }[];
};

// Recompute a style's generation-set revision from exported/transferred cases,
// mirroring listStyleBatch: the style's cases in ordinal order, each keyed by
// its latest generation. Used to bind transferred freshness ratings to the
// generation set they evaluated.
export function styleGenerationSetRevision(
  cases: readonly ExportedStyleCase[],
  styleKey: string,
): string {
  const members = cases
    .filter(
      (evalCase) =>
        evalCase.artifact.styleKey === styleKey &&
        evalCase.generations.length > 0,
    )
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .map((evalCase) => {
      const latest = evalCase.generations.at(-1);
      if (latest === undefined) {
        throw new Error(
          `Case ${evalCase.id} has no generations for style ${styleKey}`,
        );
      }
      return { caseId: evalCase.id, generationId: latest.generation.id };
    });
  return generationSetRevision(members);
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
