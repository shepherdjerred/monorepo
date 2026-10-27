import { z } from "zod";
import {
  PlexBindingExpectedSchema,
  expectedCoverageMatches,
} from "./expected.ts";
import { LibraryAssetReferenceV1Schema } from "#shared/handoff/library-ownership.ts";
import {
  PlexBindingSnapshotSchema,
  plexScopeKey,
  plexSortedUnique,
} from "./contract.ts";
import { LibraryPlexBindingInputV1Schema } from "./activities.ts";
import { ServingPlexObservationSchema } from "./observations.ts";
import { MovieServingPlexV2Schema } from "#shared/movie-editions/plex-v2.ts";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";

/** New source format; literal acquisition/native expected bodies remain version 1. */
export const LibraryPlexExpectedV2Schema = z
  .strictObject({
    ...PlexBindingExpectedSchema.shape,
    schemaVersion: z.literal(2),
    newGroups: z.tuple([PlexBindingExpectedSchema.shape.newGroups.element]),
    parents: z.tuple([
      z.strictObject({
        kind: z.literal("library_adoption"),
        recoveryEpoch: z.int().nonnegative(),
        reference: LibraryAssetReferenceV1Schema,
      }),
    ]),
  })
  .refine(
    expectedCoverageMatches,
    "Library serving verification needs complete physical coverage",
  );
export const PlexServingExpectedProtocolSchema = z.union([
  PlexBindingExpectedSchema,
  LibraryPlexExpectedV2Schema,
]);
export type PlexServingExpected = z.infer<
  typeof PlexServingExpectedProtocolSchema
>;
export type LibraryPlexExpectedV2 = z.infer<typeof LibraryPlexExpectedV2Schema>;

export const LibraryPlexReceiptV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    input: LibraryPlexBindingInputV1Schema,
    command: z.strictObject({
      kind: z.literal("verify_library_plex_binding"),
      targetId: z.uuid(),
      userId: z.uuid().nullable(),
      payloadHash: Hash,
    }),
    expected: LibraryPlexExpectedV2Schema,
    observation: z.union([
      MovieServingPlexV2Schema,
      ServingPlexObservationSchema,
    ]),
    bindings: z.array(PlexBindingSnapshotSchema).min(1).max(100),
    sdk: z.strictObject({
      observedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
    writerExpiresAt: z.iso.datetime(),
    committedAt: z.iso.datetime(),
  })
  .refine((proof) => {
    const source = proof.expected.parents[0];
    const verification = proof.observation.verification;
    return (
      source.reference.receiptId === proof.input.receiptId &&
      source.reference.assetId === proof.input.assetId &&
      source.recoveryEpoch === proof.input.recoveryEpoch &&
      proof.expected.recoveryEpoch === proof.input.recoveryEpoch &&
      proof.expected.newGroups[0].assetId === proof.input.assetId &&
      proof.command.targetId === proof.input.assetId &&
      proof.bindings.length === proof.observation.associations.length &&
      plexSortedUnique(
        proof.bindings.map((binding) => plexScopeKey(binding.scope)),
      ) &&
      Date.parse(proof.sdk.observedAt) <= Date.parse(verification.startedAt) &&
      Date.parse(verification.expiresAt) <= Date.parse(proof.sdk.expiresAt) &&
      Date.parse(verification.expiresAt) <= Date.parse(proof.writerExpiresAt) &&
      Date.parse(proof.committedAt) >= Date.parse(verification.completedAt) &&
      Date.parse(proof.committedAt) < Date.parse(verification.expiresAt)
    );
  }, "Library serving completion must retain its exact source and original verification bounds");
export const LibraryPlexReceiptEnvelopeV1Schema = z.strictObject({
  receipt: LibraryPlexReceiptV1Schema,
  receiptHash: Hash,
});
export type LibraryPlexReceiptV1 = z.infer<typeof LibraryPlexReceiptV1Schema>;
