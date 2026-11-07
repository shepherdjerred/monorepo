import { z } from "zod";
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";

/** A new manual decision is a real command, distinct from the old acquisition. */
export const MovieRollbackOperationV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.uuid(),
  sourceAttemptId: z.uuid(),
  scope: MovieEditionScopeSchema,
});
export const MovieRollbackInvocationV1Schema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("automatic_failed_plex"),
    source: MovieAttemptOperationV4Schema,
  }),
  z.strictObject({
    mode: z.literal("manual_verified"),
    command: MovieRollbackOperationV1Schema,
    source: MovieAttemptOperationV4Schema,
  }),
]);
export type MovieRollbackOperationV1 = z.infer<
  typeof MovieRollbackOperationV1Schema
>;
export type MovieRollbackInvocationV1 = z.infer<
  typeof MovieRollbackInvocationV1Schema
>;
