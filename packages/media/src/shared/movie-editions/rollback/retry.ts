import { z } from "zod";
import {
  MovieEditionHashSchema,
  MovieEditionScopeSchema,
} from "#shared/movie-editions/registry.ts";
import { PlexPointerExpectedSchema } from "#shared/plex-binding/contract.ts";
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MovieRollbackOperationV1Schema,
  MovieRollbackInvocationV1Schema,
} from "./operation.ts";
import { MovieRollbackHandoffRefV1Schema } from "./handoff-reference.ts";

export const MovieRollbackResumeRefV1Schema = z.strictObject({
  operationId: z.uuid(),
  intentHash: MovieEditionHashSchema,
});
/** Explicit new Workflow variant. Original four-field input remains literal. */
export const MovieRollbackRetryOperationV1Schema =
  MovieRollbackOperationV1Schema.extend({
    resume: MovieRollbackResumeRefV1Schema,
  });
export const RequestedMovieRollbackInputV1Schema = z.union([
  MovieRollbackOperationV1Schema,
  MovieRollbackRetryOperationV1Schema,
]);
const Asset = z.strictObject({
  id: z.uuid(),
  version: z.int().nonnegative(),
  checksum: MovieEditionHashSchema,
  snapshotHash: MovieEditionHashSchema,
});
export const MovieRollbackRetryExpectedV1Schema = z.strictObject({
  mediaVersion: z.int().nonnegative(),
  targetVersion: z.int().nonnegative(),
  generation: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
  predecessor: Asset,
  successor: Asset,
  pointer: PlexPointerExpectedSchema,
  physicalHash: MovieEditionHashSchema.nullable(),
  previousHandoff: MovieRollbackHandoffRefV1Schema.nullable(),
  originalCleanup: z
    .strictObject({
      id: z.uuid(),
      version: z.int().nonnegative(),
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
});
export const RequestMovieRollbackRetryV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: MovieEditionScopeSchema,
  sourceAttemptId: z.uuid(),
  resume: MovieRollbackResumeRefV1Schema,
  expected: MovieRollbackRetryExpectedV1Schema,
  reason: z.string().trim().min(10).max(2000),
  confirmResumeAdmittedRollback: z.literal(true),
});
export const RequestedMovieRollbackRetryPayloadV1Schema =
  MovieRollbackRetryOperationV1Schema.extend({
    kind: z.literal("rollback_movie_edition_v1"),
    mediaId: z.uuid(),
    generation: z.int().nonnegative(),
    recoveryEpoch: z.int().nonnegative(),
    actorId: z.uuid(),
    source: MovieAttemptOperationV4Schema,
    invocation: MovieRollbackInvocationV1Schema,
    retry: RequestMovieRollbackRetryV1Schema,
  });
export const RequestMovieRollbackRetryResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.uuid(),
  scope: MovieEditionScopeSchema,
  sourceAttemptId: z.uuid(),
  status: z.literal("queued"),
});
export type MovieRollbackRetryOperationV1 = z.infer<
  typeof MovieRollbackRetryOperationV1Schema
>;
export type RequestedMovieRollbackInputV1 = z.infer<
  typeof RequestedMovieRollbackInputV1Schema
>;
export type RequestMovieRollbackRetryV1 = z.infer<
  typeof RequestMovieRollbackRetryV1Schema
>;
export type MovieRollbackRetryExpectedV1 = z.infer<
  typeof MovieRollbackRetryExpectedV1Schema
>;
