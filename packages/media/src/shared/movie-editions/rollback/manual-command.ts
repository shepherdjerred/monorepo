import { z } from "zod";
import {
  MovieEditionScopeSchema,
  MovieEditionHashSchema,
} from "#shared/movie-editions/registry.ts";
import { PlexBindingSnapshotSchema } from "#shared/plex-binding/contract.ts";
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { MovieRollbackOperationV1Schema } from "./operation.ts";

const Version = z.int().nonnegative();
const Asset = z.strictObject({
  id: z.uuid(),
  version: Version,
  checksum: MovieEditionHashSchema,
});

/** Public compare-and-swap facts contain no file paths or private source bodies. */
export const MovieRollbackExpectedV1Schema = z.strictObject({
  mediaVersion: Version,
  targetVersion: Version,
  generation: Version,
  recoveryEpoch: Version,
  predecessor: Asset,
  successor: Asset.extend({ publicationHash: MovieEditionHashSchema }),
  binding: PlexBindingSnapshotSchema,
  cleanup: z.strictObject({
    id: z.uuid(),
    version: Version,
    expiresAt: z.iso.datetime(),
  }),
});
export const RequestMovieRollbackV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: MovieEditionScopeSchema,
  sourceAttemptId: z.uuid(),
  expected: MovieRollbackExpectedV1Schema,
  reason: z.string().trim().min(10).max(2000),
  confirmRestorePredecessor: z.literal(true),
  confirmRetainRejectedSuccessor: z.literal(true),
});
export const MovieRollbackContextV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: MovieEditionScopeSchema,
  sourceAttemptId: z.uuid(),
  expected: MovieRollbackExpectedV1Schema,
});

/** Only the actual owner command producer writes this private admission payload.
 * Outbox dispatch projects the four public operation fields into history. */
export const RequestedMovieRollbackPayloadV1Schema =
  MovieRollbackOperationV1Schema.extend({
    kind: z.literal("rollback_movie_edition_v1"),
    mediaId: z.uuid(),
    generation: Version,
    recoveryEpoch: Version,
    actorId: z.uuid(),
    source: MovieAttemptOperationV4Schema,
    request: RequestMovieRollbackV1Schema,
  });
export const RequestMovieRollbackResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.uuid(),
  scope: MovieEditionScopeSchema,
  sourceAttemptId: z.uuid(),
  status: z.literal("queued"),
  expiresAt: z.iso.datetime(),
});

export type MovieRollbackExpectedV1 = z.infer<
  typeof MovieRollbackExpectedV1Schema
>;
export type RequestMovieRollbackV1 = z.infer<
  typeof RequestMovieRollbackV1Schema
>;
