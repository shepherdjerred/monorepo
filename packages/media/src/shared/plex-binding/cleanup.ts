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
export const UpgradeCleanupPlexExpectedSchema = z.strictObject({
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
export const UpgradeCleanupPlexEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
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
