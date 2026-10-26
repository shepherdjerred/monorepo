import { z } from "zod";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { MovieEditionFulfillmentSchema } from "#shared/movie-editions/fulfillment.ts";
import { CleanupReasonSchema, RecordedSeedingPolicySchema } from "./seeding.ts";

export const ObservationFreshnessSchema = z.enum([
  "fresh",
  "stale",
  "missing",
  "future",
  "old_epoch",
]);
export const MediaVisibilitySchema = z.strictObject({
  movieRequests: z
    .array(
      z.strictObject({
        requestId: z.uuid(),
        edition: MovieEditionKeySchema,
        fulfillment: MovieEditionFulfillmentSchema,
      }),
    )
    .max(7),
  playback: z
    .strictObject({
      scope: z.enum(["title", "collection"]),
      playable: z.boolean(),
      playableItems: z.int().nonnegative(),
      visibleItems: z.int().nonnegative(),
      association: z.strictObject({
        legacyUnverifiedItems: z.int().nonnegative(),
        reconciliationRequiredItems: z.int().nonnegative(),
      }),
      currentAssetId: z.uuid().nullable(),
      currentVersion: z.int().nullable(),
      upgradeInProgress: z.boolean(),
    })
    .refine(
      (playback) =>
        playback.association.legacyUnverifiedItems +
          playback.association.reconciliationRequiredItems <=
        playback.visibleItems,
      "Association counts exceed visible items",
    ),
  attempts: z
    .array(
      z.strictObject({
        id: z.uuid(),
        state: z.string(),
        torrentId: z.uuid().nullable(),
        createdAt: z.iso.datetime(),
        currentEpoch: z.boolean(),
      }),
    )
    .max(20),
  torrents: z
    .array(
      z.strictObject({
        id: z.uuid(),
        state: z.string(),
        observedAt: z.iso.datetime().nullable(),
        freshness: ObservationFreshnessSchema,
        progress: z.number().min(0).max(1).nullable(),
        ratio: z
          .discriminatedUnion("kind", [
            z.strictObject({
              kind: z.literal("finite"),
              value: z.number().nonnegative(),
            }),
            z.strictObject({ kind: z.literal("infinite") }),
          ])
          .nullable(),
        seededSeconds: z.number().nonnegative().nullable(),
        diagnostics: z
          .strictObject({
            providerId: z.string(),
            policy: RecordedSeedingPolicySchema,
            protections: z.array(
              z.enum([
                "unowned_torrent",
                "old_epoch",
                "missing_observation",
                "stale_observation",
                "future_observation",
                "source_in_use",
                "torrent_policy_drift",
                "submission_outcome_unknown",
                "removal_outcome_unknown",
              ]),
            ),
            obligation: z
              .strictObject({
                satisfied: z.boolean(),
                reason: CleanupReasonSchema,
                requiredSeconds: z.number().nonnegative().nullable(),
              })
              .nullable(),
            cleanup: z
              .strictObject({
                status: z.enum([
                  "removed",
                  "protected",
                  "seeding",
                  "removable",
                ]),
                reason: CleanupReasonSchema.nullable(),
                evaluatedAt: z.iso.datetime(),
                freshness: z.enum(["current", "stale"]),
                phase: z.enum(["evaluation", "removal"]),
              })
              .nullable(),
          })
          .nullable(),
      }),
    )
    .max(20),
  historyTruncated: z.boolean(),
});
export type MediaVisibility = z.infer<typeof MediaVisibilitySchema>;
