import { z } from "zod";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import {
  PlexBindingScopeSchema,
  PlexBindingSnapshotSchema,
  PlexPhysicalGroupSchema,
  plexSortedUnique,
  plexScopeKey,
} from "./contract.ts";

export const CommittedQuarantinePlexReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    operationId: z.uuid(),
    decisionId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
    manifestHash: Hash,
    decisions: z
      .array(
        z.strictObject({
          decisionId: z.uuid(),
          mediaId: z.uuid(),
          beforeVersion: z.int().nonnegative(),
          quarantinedVersion: z.int().nonnegative(),
          projectionHash: Hash,
        }),
      )
      .min(1)
      .max(10_000),
    groups: z.array(PlexPhysicalGroupSchema).min(1).max(100),
    bindings: z.array(PlexBindingSnapshotSchema).min(1).max(10_000),
    committedAt: z.iso.datetime(),
  })
  .refine((value) => {
    const scopes = value.groups
      .flatMap((group) => group.coverage.map((scope) => plexScopeKey(scope)))
      .sort();
    return (
      plexSortedUnique(value.groups.map((group) => group.assetId)) &&
      plexSortedUnique(
        value.decisions.map((decision) => decision.decisionId),
      ) &&
      plexSortedUnique(
        value.bindings.map((binding) => plexScopeKey(binding.scope)),
      ) &&
      plexSortedUnique(scopes) &&
      scopes.length === value.bindings.length &&
      scopes.every(
        (scope, index) =>
          scope ===
          plexScopeKey(
            value.bindings[index]?.scope ?? { mediaId: "", edition: "" },
          ),
      ) &&
      value.decisions.some(
        (decision) => decision.decisionId === value.decisionId,
      ) &&
      new Set(value.decisions.map((decision) => decision.mediaId)).size ===
        value.decisions.length &&
      value.decisions.length === scopes.length &&
      value.decisions.every(
        (decision) =>
          decision.quarantinedVersion === decision.beforeVersion + 1 &&
          scopes.includes(`${decision.mediaId}/default`),
      )
    );
  }, "Committed quarantine requires every original group, binding and decision exactly once");
export type CommittedQuarantinePlexReceipt = z.infer<
  typeof CommittedQuarantinePlexReceiptSchema
>;

export const QuarantinePlexRefSchema = z.strictObject({
  decisionId: z.uuid(),
  decisionVersion: z.int().nonnegative(),
  manifestHash: Hash,
  operationId: z.uuid(),
  operationResultHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  group: PlexPhysicalGroupSchema,
  assets: z
    .array(
      z.strictObject({
        assetId: z.uuid(),
        planAssetVersion: z.int().nonnegative(),
        quarantinedAssetVersion: z.int().nonnegative(),
        checksum: Hash,
        coverageHash: Hash,
      }),
    )
    .min(1)
    .max(100),
  nativeReceipts: z
    .array(
      z.strictObject({
        receiptId: z.uuid(),
        planHash: Hash,
        selectionHash: Hash,
        continuationId: z.uuid(),
        descriptorHash: Hash,
        bindingHash: Hash,
      }),
    )
    .max(100),
});
/** Explicit scoped authority; the historical unversioned reference remains literal. */
export const QuarantinePlexRefV2Schema = QuarantinePlexRefSchema.extend({
  schemaVersion: z.literal(2),
  scope: MovieEditionScopeSchema,
}).refine(
  (value) =>
    value.nativeReceipts.length === 0 &&
    value.group.canonicalRootId === value.scope.rootMediaId &&
    value.group.edition === value.scope.edition &&
    value.group.coverage.length === 1 &&
    value.group.coverage[0]?.mediaId === value.scope.mediaId &&
    value.group.coverage[0].edition === value.scope.edition,
  "Scoped quarantine watch requires its exact movie group without native rebinding",
);
export const BoundWatchAuthoritySchema = z.discriminatedUnion("purpose", [
  z.strictObject({
    purpose: z.literal("current_serving"),
    binding: PlexBindingSnapshotSchema,
  }),
  z.strictObject({
    purpose: z.literal("quarantined"),
    binding: PlexBindingSnapshotSchema,
    quarantine: z.union([QuarantinePlexRefSchema, QuarantinePlexRefV2Schema]),
    quarantineHash: Hash,
  }),
]);
export const PlexWatchProjectionV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    userId: z.uuid(),
    scope: PlexBindingScopeSchema,
    authority: BoundWatchAuthoritySchema,
    watchBatchRevision: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n),
    observedAt: z.iso.datetime(),
    watched: z.boolean(),
    source: z.literal("plex"),
  })
  .refine(
    (value) =>
      plexScopeKey(value.scope) === plexScopeKey(value.authority.binding.scope),
    "Watch projection differs from its binding scope",
  );
export const RetentionPlexProjectionV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    decisionId: z.uuid(),
    groupHashes: z.array(Hash).min(1).refine(plexSortedUnique),
    bindings: z.array(PlexBindingSnapshotSchema).min(1).max(10_000),
  })
  .refine(
    (value) =>
      plexSortedUnique(value.bindings.map((row) => plexScopeKey(row.scope))),
    "Retention Plex projection requires every distinct covered binding",
  );
export type QuarantinePlexRef = z.infer<typeof QuarantinePlexRefSchema>;
export type QuarantinePlexRefV2 = z.infer<typeof QuarantinePlexRefV2Schema>;
export type BoundWatchAuthority = z.infer<typeof BoundWatchAuthoritySchema>;
export type PlexWatchProjectionV1 = z.infer<typeof PlexWatchProjectionV1Schema>;
export type RetentionPlexProjectionV1 = z.infer<
  typeof RetentionPlexProjectionV1Schema
>;
export type BoundWatchRead =
  | { status: "known"; projection: PlexWatchProjectionV1 }
  | {
      status: "unknown";
      reason: "missing" | "stale" | "authority_changed" | "value_changed";
    };
