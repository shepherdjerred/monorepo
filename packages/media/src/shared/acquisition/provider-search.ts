import { z } from "zod";
import { TrackerProviderIdSchema } from "#shared/admin.ts";

export const PROVIDER_SEARCH_MAX_LISTINGS = 1000;
export const PROVIDER_SEARCH_MAX_PAGES = 20;
export const PROVIDER_SEARCH_WINDOW_MS = 30 * 60_000;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const ProviderIdsSchema = z
  .array(TrackerProviderIdSchema)
  .max(TrackerProviderIdSchema.options.length);

export const RankedProviderCandidateSchema = z.strictObject({
  releaseId: z.uuid(),
  rank: z.number(),
  score: z.number(),
  priority: z.number(),
  seeders: z.int().nonnegative().nullable().optional(),
  fallbackDistanceBytes: z.int().nonnegative().optional(),
});

export function providerSearchProgressSchema<
  Candidate extends z.ZodType<z.output<typeof RankedProviderCandidateSchema>>,
>(candidate: Candidate) {
  return z.strictObject({
    criteriaDigest: DigestSchema,
    completedProviderIds: ProviderIdsSchema,
    paging: z
      .strictObject({
        schemaVersion: z.literal(1),
        round: z.int().min(1).max(PROVIDER_SEARCH_MAX_PAGES),
        exhaustedProviderIds: ProviderIdsSchema,
        pages: z
          .array(
            z.strictObject({
              providerId: TrackerProviderIdSchema,
              digest: DigestSchema,
            }),
          )
          .max(PROVIDER_SEARCH_MAX_PAGES),
        listings: z
          .array(
            z.strictObject({
              digest: DigestSchema,
              sourceDigest: DigestSchema.nullable().optional(),
              seeders: z.int().nonnegative().nullable().optional(),
              candidate: candidate.optional(),
              eligibleAt: z.int().nonnegative().optional(),
              observedAt: z.int().nonnegative().optional(),
            }),
          )
          .max(PROVIDER_SEARCH_MAX_LISTINGS),
        startedAt: z.int().nonnegative().optional(),
        retries: z
          .array(
            z.strictObject({
              providerId: TrackerProviderIdSchema,
              retryAt: z.int().nonnegative(),
            }),
          )
          .max(TrackerProviderIdSchema.options.length)
          .optional(),
      })
      .optional(),
  });
}

export const EpisodeProviderSearchProgressSchema = providerSearchProgressSchema(
  RankedProviderCandidateSchema,
);
export type EpisodeProviderSearchProgress = z.output<
  typeof EpisodeProviderSearchProgressSchema
>;
