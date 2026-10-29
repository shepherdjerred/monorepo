import { z } from "zod";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";
import {
  PlexAssociationV1Schema,
  PlexBindingSnapshotSchema,
  PlexBindingReasonSchema,
  plexSortedUnique,
  plexScopeKey,
  type PlexBindingFreshness,
} from "./contract.ts";

const Pass = z.strictObject({
  itemCount: z.int().min(0).max(10_000),
  inventoryHash: Hash,
  selectedHash: Hash,
});
export const PlexVerificationFactsSchema = z
  .strictObject({
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    sections: z
      .array(
        z.strictObject({
          sectionId: PlexDecimalIdSchema,
          sectionType: z.enum(["movie", "show"]),
        }),
      )
      .min(1)
      .max(100),
    passes: z.tuple([Pass, Pass]),
  })
  .refine((value) => {
    const start = Date.parse(value.startedAt);
    const end = Date.parse(value.completedAt);
    const expiry = Date.parse(value.expiresAt);
    return (
      start <= end &&
      end < expiry &&
      expiry - start <= 60_000 &&
      plexSortedUnique(value.sections.map((row) => row.sectionId)) &&
      value.passes[0].itemCount === value.passes[1].itemCount &&
      value.passes[0].inventoryHash === value.passes[1].inventoryHash &&
      value.passes[0].selectedHash === value.passes[1].selectedHash
    );
  }, "Plex verification requires complete stable passes within its original deadline");

export const ServingPlexObservationSchema = z
  .strictObject({
    purpose: z.literal("current_serving"),
    associations: z.array(PlexAssociationV1Schema).min(1).max(10_000),
    verification: PlexVerificationFactsSchema,
  })
  .refine(
    (value) =>
      plexSortedUnique(
        value.associations.map((row) => plexScopeKey(row.scope)),
      ),
    "Plex serving associations require complete sorted distinct scopes",
  );
export const PlexVerificationProtectedSchema = z.strictObject({
  status: z.literal("protected"),
  reason: PlexBindingReasonSchema,
});
export const PlexBindingVerificationCompletionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    operationId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
    expectedHash: Hash,
    inputHash: Hash,
    verification: PlexVerificationFactsSchema,
    bindings: z.array(PlexBindingSnapshotSchema).min(1).max(10_000),
    bindingCount: z.int().min(1).max(10_000),
    committedAt: z.iso.datetime(),
  })
  .refine(
    (value) =>
      value.bindingCount === value.bindings.length &&
      plexSortedUnique(value.bindings.map((row) => plexScopeKey(row.scope))) &&
      Date.parse(value.committedAt) >=
        Date.parse(value.verification.completedAt) &&
      Date.parse(value.committedAt) < Date.parse(value.verification.expiresAt),
    "Plex completion must bind every committed scope within verification freshness",
  );
export type PlexVerificationFacts = z.infer<typeof PlexVerificationFactsSchema>;
export type ServingPlexObservation = z.infer<
  typeof ServingPlexObservationSchema
>;
export type VerifiedServingPlex = ServingPlexObservation & {
  freshness: PlexBindingFreshness;
};
export type PlexVerificationProtected = z.infer<
  typeof PlexVerificationProtectedSchema
>;
export type PlexBindingVerificationCompletion = z.infer<
  typeof PlexBindingVerificationCompletionSchema
>;
