import { z } from "zod";
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MovieEditionHashSchema as Hash,
  MovieEditionScopeSchema,
} from "#shared/movie-editions/registry.ts";
import {
  MovieRetryClosedWorkflowV1Schema,
  MovieRetryRenewalV1Schema,
} from "#shared/movie-editions/retry/v1.ts";

/** Current permission to consume one actual registered source; never an add receipt. */
export const MovieTransferReuseGrantV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: MovieEditionScopeSchema,
  input: MovieAttemptOperationV4Schema,
  consumer: z.strictObject({
    attemptId: z.uuid(),
    birthOperationId: z.uuid(),
    birthHash: Hash,
    identityHash: Hash,
    generation: z.int().nonnegative(),
    assessmentId: z.uuid(),
    assessmentHash: Hash,
    profileId: z.uuid(),
    profileVersion: z.int().nonnegative(),
    access: z.strictObject({
      serverMachineId: z.string().min(1),
      movieSectionId: z.string().min(1),
    }),
  }),
  origin: z.strictObject({
    attemptId: z.uuid(),
    birthOperationId: z.uuid(),
    coordinatorOperationId: z.uuid(),
    birthHash: Hash,
    identityHash: Hash,
    sourceHash: Hash,
    releaseId: z.string().min(1),
  }),
  transfer: MovieRetryRenewalV1Schema.shape.torrent.unwrap(),
  root: MovieRetryClosedWorkflowV1Schema,
  child: MovieRetryClosedWorkflowV1Schema,
  observedAt: z.iso.datetime(),
  sdkExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  committedAt: z.iso.datetime(),
});
export type MovieTransferReuseGrantV1 = z.infer<
  typeof MovieTransferReuseGrantV1Schema
>;
export const MovieTransferReuseEnvelopeV1Schema = z.strictObject({
  grant: MovieTransferReuseGrantV1Schema,
  grantHash: Hash,
});
