import { z } from "zod";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { TrackerProviderIdSchema } from "#shared/admin.ts";

/** Identifiers and explicit scope only; provider URLs, paths and credentials stay in Activities. */
export const MovieOperationV4Schema = z
  .strictObject({
    schemaVersion: z.literal(4),
    operationId: z.uuid(),
    mediaId: z.uuid(),
    generation: z.int().nonnegative(),
    scope: MovieEditionScopeSchema,
  })
  .refine(
    (input) => input.mediaId === input.scope.mediaId,
    "Movie Workflow target differs from its edition scope",
  );
/** Discovery bookkeeping only; this never supplies acquisition authority. */
export const MovieProviderSearchProgressV4Schema = z.strictObject({
  criteriaDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  completedProviderIds: z
    .array(TrackerProviderIdSchema)
    .max(TrackerProviderIdSchema.options.length),
});
export const MovieReconcileOperationV4Schema =
  MovieOperationV4Schema.safeExtend({
    providerSearchProgress: MovieProviderSearchProgressV4Schema.optional(),
  });
export const MovieAttemptOperationV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  operationId: z.uuid(),
  attemptId: z.uuid(),
  scope: MovieEditionScopeSchema,
});
export const MovieDecisionOperationV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  operationId: z.uuid(),
  decisionId: z.uuid(),
  scope: MovieEditionScopeSchema,
});
export type MovieOperationV4 = z.infer<typeof MovieOperationV4Schema>;
export type MovieProviderSearchProgressV4 = z.infer<
  typeof MovieProviderSearchProgressV4Schema
>;
export type MovieReconcileOperationV4 = z.infer<
  typeof MovieReconcileOperationV4Schema
>;
export type MovieAttemptOperationV4 = z.infer<
  typeof MovieAttemptOperationV4Schema
>;
export type MovieDecisionOperationV4 = z.infer<
  typeof MovieDecisionOperationV4Schema
>;
