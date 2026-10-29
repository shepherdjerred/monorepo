import { z } from "zod";
import {
  PlexMovieAssociationV2Schema,
  PlexBindingSnapshotSchema,
  type PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import { PlexVerificationFactsSchema } from "#shared/plex-binding/observations.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { MovieAttemptOperationV4Schema } from "./automation-v4.ts";
import { MovieEditionHashSchema as Hash } from "./registry.ts";

export const MovieServingPlexV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  purpose: z.literal("current_serving"),
  associations: z.tuple([PlexMovieAssociationV2Schema]),
  verification: PlexVerificationFactsSchema,
});
export type VerifiedMovieServingPlexV2 = z.infer<
  typeof MovieServingPlexV2Schema
> & { freshness: PlexBindingFreshness };

/** A separate immutable completion; historical acquisitionPlexReceipt remains literal. */
export const MoviePlexReceiptV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  input: MovieAttemptOperationV4Schema,
  command: z.strictObject({
    kind: z.enum(["reconcile_movie_edition_v4", "acquire_movie_edition_v4"]),
    targetId: z.uuid(),
    userId: z.uuid().nullable(),
    payloadHash: Hash,
  }),
  attempt: z.strictObject({
    operationId: z.uuid(),
    coordinatorOperationId: z.uuid(),
    releaseId: z.uuid(),
    sponsorRequestId: z.uuid(),
    torrentId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
    identityHash: Hash,
    birthHash: Hash,
    generationsHash: Hash,
    filePlanHash: Hash,
  }),
  publication: z.strictObject({
    transitionId: z.uuid(),
    intentHash: Hash,
    outcomeHash: Hash,
  }),
  expected: PlexBindingExpectedSchema,
  observation: MovieServingPlexV2Schema,
  binding: PlexBindingSnapshotSchema,
  publishedAt: z.iso.datetime(),
  committedAt: z.iso.datetime(),
});
export const MoviePlexReceiptEnvelopeV2Schema = z.strictObject({
  receipt: MoviePlexReceiptV2Schema,
  receiptHash: Hash,
});
export type MoviePlexReceiptV2 = z.infer<typeof MoviePlexReceiptV2Schema>;
