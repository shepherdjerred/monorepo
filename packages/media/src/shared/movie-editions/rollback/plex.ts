import { z } from "zod";
import {
  PlexBindingExpectedSchema,
  expectedCoverageMatches,
} from "#shared/plex-binding/expected.ts";
import { PlexBindingSnapshotSchema } from "#shared/plex-binding/contract.ts";
import { MovieServingPlexV2Schema } from "#shared/movie-editions/plex-v2.ts";
import { MovieEditionHashSchema as Hash } from "#shared/movie-editions/registry.ts";
import { MovieRollbackReferenceV1Schema } from "./reference.ts";
import { MovieRollbackInvocationV1Schema } from "./operation.ts";
import { MovieRollbackOriginalItemV1Schema } from "./physical.ts";

export const MovieRollbackPlexExpectedV1Schema = z
  .strictObject({
    ...PlexBindingExpectedSchema.shape,
    schemaVersion: z.literal(4),
    originalItem: MovieRollbackOriginalItemV1Schema,
    targets: z.tuple([PlexBindingExpectedSchema.shape.targets.element]),
    previous: z.tuple([PlexBindingExpectedSchema.shape.previous.element]),
    oldGroups: PlexBindingExpectedSchema.shape.oldGroups.max(1),
    newGroups: z.tuple([PlexBindingExpectedSchema.shape.newGroups.element]),
    parents: z.tuple([
      z.strictObject({
        kind: z.literal("movie_rollback_publication_v1"),
        recoveryEpoch: z.int().nonnegative(),
        reference: MovieRollbackReferenceV1Schema,
      }),
    ]),
  })
  .refine(
    expectedCoverageMatches,
    "Movie rollback serving needs its exact restored group",
  )
  .refine(
    (expected) =>
      expected.oldGroups.length === 0 ||
      JSON.stringify(expected.oldGroups[0]) ===
        JSON.stringify(expected.newGroups[0]),
    "Movie rollback serving may retain only its exact restored group",
  );
export const MovieRollbackPlexV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  transactionId: z.string().regex(/^[1-9]\d*$/u),
  operationId: z.uuid(),
  invocation: MovieRollbackInvocationV1Schema,
  intentId: z.uuid(),
  intentHash: Hash,
  physicalHash: Hash,
  publication: MovieRollbackReferenceV1Schema,
  expected: MovieRollbackPlexExpectedV1Schema,
  observation: MovieServingPlexV2Schema,
  binding: PlexBindingSnapshotSchema,
  sdk: z.strictObject({
    observedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
  writerExpiresAt: z.iso.datetime(),
  assetPlexPublishedAt: z.iso.datetime().nullable(),
  reboundAt: z.iso.datetime(),
  committedAt: z.iso.datetime(),
});
export const MovieRollbackPlexEnvelopeV1Schema = z.strictObject({
  receipt: MovieRollbackPlexV1Schema,
  receiptHash: Hash,
  raw: z.string().min(1),
});
export type MovieRollbackPlexExpectedV1 = z.infer<
  typeof MovieRollbackPlexExpectedV1Schema
>;
export type MovieRollbackPlexV1 = z.infer<typeof MovieRollbackPlexV1Schema>;
