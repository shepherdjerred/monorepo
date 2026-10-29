import { z } from "zod";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import { UpgradeCleanupPlanSchema } from "#shared/native-recovery/archive-plan.ts";
import {
  PlexAccessSchema,
  PlexBindingSnapshotSchema,
  PlexBindingReasonSchema,
  PlexPhysicalGroupSchema,
  plexSortedUnique,
} from "./contract.ts";
import { PLEX_BINDING_RESULT_MAX_BYTES } from "./activities.ts";
import { PlexBindingExpectedSchema } from "./expected.ts";
import { PlexVerificationFactsSchema } from "./observations.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { MovieRestorePlexExpectedV1Schema } from "#shared/movie-editions/restore-plex-v1.ts";

const Ids = z.array(z.uuid()).min(1).max(10_000).refine(plexSortedUnique);
const Plan = UpgradeCleanupPlanSchema.strict().extend({
  files: z
    .array(UpgradeCleanupPlanSchema.shape.files.element.strict())
    .min(1)
    .max(101),
  mediaIds: Ids,
});
export const UpgradeCleanupPlexInputSchema = z.strictObject({
  operationId: z.uuid(),
  cleanupId: z.uuid(),
});
export const ObserveMediaUpgradeCleanupResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("observed") }),
    z.strictObject({ status: z.literal("complete") }),
    z.strictObject({
      status: z.literal("protected"),
      reason: PlexBindingReasonSchema,
    }),
  ])
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      PLEX_BINDING_RESULT_MAX_BYTES,
    "Cleanup observation result exceeds its fixed history envelope",
  );
export type ObserveMediaUpgradeCleanupResult = z.infer<
  typeof ObserveMediaUpgradeCleanupResultSchema
>;
export const UpgradeCleanupPlexExpectedV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.uuid(),
  cleanupId: z.uuid(),
  commandHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  cleanup: z.strictObject({
    version: z.int().nonnegative(),
    assetId: z.uuid(),
    successorAssetId: z.uuid(),
    expiresAt: z.iso.datetime(),
    manifestHash: Hash.nullable(),
  }),
  publication: z.strictObject({
    attemptId: z.uuid(),
    operationId: z.uuid(),
    filePlanHash: Hash,
  }),
  plan: Plan,
  descriptorHash: Hash,
  mediaIds: Ids,
  assetIds: z.array(z.uuid()).min(1).max(202).refine(plexSortedUnique),
  userIds: z.array(z.uuid()).max(10_000).refine(plexSortedUnique),
  targets: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        generation: z.int().nonnegative(),
        intentVersion: z.int().nonnegative(),
        automationEpoch: z.int().nonnegative(),
      }),
    )
    .min(1)
    .max(10_000),
  groups: z.array(PlexPhysicalGroupSchema).min(1).max(100),
  serving: PlexBindingExpectedSchema,
  bindings: z.array(PlexBindingSnapshotSchema).min(1).max(10_000),
  access: z.array(PlexAccessSchema).min(1).max(2),
  paths: z
    .array(z.string().min(1).max(4096))
    .min(1)
    .max(10_101)
    .refine(plexSortedUnique),
  pathsHash: Hash,
  authorityExpiresAt: z.iso.datetime(),
});
export const MovieUpgradeCleanupPlexExpectedV2Schema =
  UpgradeCleanupPlexExpectedV1Schema.extend({
    schemaVersion: z.literal(2),
    scope: MovieEditionScopeSchema,
  }).refine(
    (value) =>
      value.mediaIds.length === 1 &&
      value.mediaIds[0] === value.scope.mediaId &&
      value.scope.rootMediaId === value.scope.mediaId &&
      value.groups.length === 1 &&
      value.bindings.length === 1 &&
      value.targets.length === 1 &&
      value.targets[0]?.mediaId === value.scope.mediaId &&
      value.groups.every(
        (group) =>
          group.edition === value.scope.edition &&
          group.canonicalRootId === value.scope.rootMediaId &&
          group.coverage.length === 1 &&
          group.coverage[0]?.mediaId === value.scope.mediaId,
      ) &&
      value.bindings[0]?.scope.mediaId === value.scope.mediaId &&
      value.bindings[0].scope.edition === value.scope.edition,
    "Movie cleanup must retain one exact serving edition",
  );
/** Additive cleanup context for an actual restored serving successor; old expected bodies remain literal. */
export const MovieRestoredUpgradeCleanupPlexExpectedV3Schema =
  UpgradeCleanupPlexExpectedV1Schema.extend({
    schemaVersion: z.literal(3),
    scope: MovieEditionScopeSchema,
    serving: MovieRestorePlexExpectedV1Schema,
  }).refine(
    (value) =>
      value.mediaIds.length === 1 &&
      value.mediaIds[0] === value.scope.mediaId &&
      value.scope.rootMediaId === value.scope.mediaId &&
      value.groups.length === 1 &&
      value.bindings.length === 1 &&
      value.targets.length === 1 &&
      value.targets[0]?.mediaId === value.scope.mediaId &&
      value.groups.every(
        (group) =>
          group.edition === value.scope.edition &&
          group.canonicalRootId === value.scope.rootMediaId &&
          group.coverage.length === 1 &&
          group.coverage[0]?.mediaId === value.scope.mediaId,
      ) &&
      value.bindings[0]?.scope.mediaId === value.scope.mediaId &&
      value.bindings[0].scope.edition === value.scope.edition,
    "Restored movie cleanup must retain one exact serving edition",
  );
export const UpgradeCleanupPlexExpectedSchema = z.discriminatedUnion(
  "schemaVersion",
  [
    UpgradeCleanupPlexExpectedV1Schema,
    MovieUpgradeCleanupPlexExpectedV2Schema,
    MovieRestoredUpgradeCleanupPlexExpectedV3Schema,
  ],
);
export const UpgradeCleanupPlexEvidenceSchema = z
  .strictObject({
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    expected: UpgradeCleanupPlexExpectedSchema,
    expectedHash: Hash,
    sessions: z.strictObject({
      state: z.literal("clear"),
      pathsHash: Hash,
      checkedAt: z.iso.datetime(),
    }),
    verification: PlexVerificationFactsSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .refine((value) => {
    const start = Date.parse(value.startedAt),
      complete = Date.parse(value.completedAt),
      checked = Date.parse(value.sessions.checkedAt),
      expiry = Date.parse(value.expiresAt);
    return (
      value.schemaVersion === value.expected.schemaVersion &&
      start <= checked &&
      checked <= complete &&
      complete < expiry &&
      expiry - start <= 60_000 &&
      value.verification.startedAt === value.startedAt &&
      Date.parse(value.verification.completedAt) <= checked &&
      expiry <= Date.parse(value.verification.expiresAt) &&
      expiry <= Date.parse(value.expected.authorityExpiresAt) &&
      value.sessions.pathsHash === value.expected.pathsHash
    );
  }, "Cleanup observation must preserve original timing and complete clear-session paths");
export const UpgradeCleanupPlexStoredSchema = z.strictObject({
  evidenceHash: Hash,
  evidence: UpgradeCleanupPlexEvidenceSchema,
});
export type UpgradeCleanupPlexInput = z.infer<
  typeof UpgradeCleanupPlexInputSchema
>;
export type UpgradeCleanupPlexExpected = z.infer<
  typeof UpgradeCleanupPlexExpectedSchema
>;
export type UpgradeCleanupPlexEvidence = z.infer<
  typeof UpgradeCleanupPlexEvidenceSchema
>;
