import { z } from "zod";
import { MovieOperationV4Schema } from "./automation-v4.ts";
import { MovieRestoreReferenceV1Schema } from "./publication-v2.ts";
import { MovieServingPlexV2Schema } from "./plex-v2.ts";
import { MovieEditionHashSchema as Hash } from "./registry.ts";
import {
  PlexBindingSnapshotSchema,
  PlexPartIdentitySchema,
} from "#shared/plex-binding/contract.ts";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";
import {
  PlexBindingExpectedSchema,
  expectedCoverageMatches,
} from "#shared/plex-binding/expected.ts";

/** Restore is a distinct parent protocol; ordinary restore/acquisition expected bodies remain literal. */
export const MovieRestorePlexExpectedV1Schema = z
  .strictObject({
    ...PlexBindingExpectedSchema.shape,
    schemaVersion: z.literal(3),
    originalItem: z.strictObject({
      binding: PlexBindingSnapshotSchema,
      ratingKey: PlexDecimalIdSchema,
      part: PlexPartIdentitySchema.pick({ id: true, file: true }),
    }),
    targets: z.tuple([PlexBindingExpectedSchema.shape.targets.element]),
    previous: z.tuple([PlexBindingExpectedSchema.shape.previous.element]),
    oldGroups: PlexBindingExpectedSchema.shape.oldGroups.max(1),
    newGroups: z.tuple([PlexBindingExpectedSchema.shape.newGroups.element]),
    parents: z.tuple([
      z.strictObject({
        kind: z.literal("movie_restore_publication_v1"),
        recoveryEpoch: z.int().nonnegative(),
        reference: MovieRestoreReferenceV1Schema,
      }),
    ]),
  })
  .refine(
    expectedCoverageMatches,
    "Movie restore Plex binding needs its exact physical scope",
  )
  .refine(
    (value) =>
      value.oldGroups.length === 0 ||
      JSON.stringify(value.oldGroups[0]) === JSON.stringify(value.newGroups[0]),
    "Restored serving may retain only its same exact physical group",
  );

export const MovieRestorePlexReceiptV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  input: MovieOperationV4Schema,
  command: z.strictObject({
    kind: z.literal("restore_movie_edition_v4"),
    targetId: z.uuid(),
    userId: z.uuid().nullable(),
    payloadHash: Hash,
  }),
  publication: MovieRestoreReferenceV1Schema,
  expected: MovieRestorePlexExpectedV1Schema,
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
export const MovieRestorePlexReceiptEnvelopeV1Schema = z.strictObject({
  receipt: MovieRestorePlexReceiptV1Schema,
  receiptHash: Hash,
});
export type MovieRestorePlexExpectedV1 = z.infer<
  typeof MovieRestorePlexExpectedV1Schema
>;
export type MovieRestorePlexReceiptV1 = z.infer<
  typeof MovieRestorePlexReceiptV1Schema
>;
