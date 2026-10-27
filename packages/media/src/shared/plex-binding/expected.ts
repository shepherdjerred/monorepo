import { z } from "zod";
import { GenerationsSchema } from "#shared/file-plan.ts";
import { PublicationAuthorityReferenceSchema } from "#shared/publication-proof/references.ts";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import {
  PlexBindingScopeSchema,
  PlexAccessSchema,
  PlexDefinitionRefSchema,
  PlexPhysicalGroupSchema,
  PlexPointerExpectedSchema,
  plexScopeKey,
  plexSortedUnique,
} from "./contract.ts";

export const PlexTargetExpectedSchema = z.strictObject({
  scope: PlexBindingScopeSchema,
  editionRootId: z.uuid(),
  mediaVersion: z.int().nonnegative(),
  intentVersion: z.int().nonnegative(),
  generation: z.int().nonnegative(),
  automationEpoch: z.int().nonnegative(),
  definition: PlexDefinitionRefSchema,
  canonicalIdentityHash: Hash,
  numberingHash: Hash,
});
export const PlexPublicationParentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("acquisition"),
    operationId: z.uuid(),
    attemptId: z.uuid(),
    planHash: Hash,
    identityHash: Hash.nullable(),
    recoveryEpoch: z.int().nonnegative(),
    generations: GenerationsSchema,
  }),
  z.strictObject({
    kind: z.literal("existing_asset"),
    assetId: z.uuid(),
    assetVersion: z.int().nonnegative(),
    recoveryEpoch: z.int().nonnegative(),
    physicalGrant: PublicationAuthorityReferenceSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("restore"),
    operationId: z.uuid(),
    // Literal Operation.result.restoreReceipt hash; plexScan/reason are mutable siblings.
    resultHash: Hash,
    decisionId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("rollback"),
    attemptId: z.uuid(),
    operationId: z.uuid(),
    failureHash: Hash,
    planHash: Hash,
    recoveryEpoch: z.int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("compensation"),
    continuationId: z.uuid(),
    receiptId: z.uuid(),
    planHash: Hash,
    descriptorHash: Hash,
    completionHash: Hash,
    operationId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
  }),
]);
export const PlexBindingExpectedSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    recoveryEpoch: z.int().nonnegative(),
    access: z
      .array(PlexAccessSchema)
      .min(1)
      .max(2)
      .refine(
        (values) =>
          plexSortedUnique(values.map((value) => value.sectionType)) &&
          new Set(values.map((value) => value.sectionId)).size ===
            values.length &&
          new Set(values.map((value) => value.serverMachineId)).size === 1,
        "Plex access requires one server and distinct sorted configured section kinds",
      ),
    targets: z.array(PlexTargetExpectedSchema).min(1),
    previous: z.array(PlexPointerExpectedSchema).min(1),
    oldGroups: z.array(PlexPhysicalGroupSchema),
    newGroups: z.array(PlexPhysicalGroupSchema),
    parents: z.array(PlexPublicationParentSchema).min(1),
  })
  .refine(
    expectedCoverageMatches,
    "Plex expected authority omits group members",
  );

export function expectedCoverageMatches(value: {
  targets: { scope: { mediaId: string; edition: string } }[];
  previous: { scope: { mediaId: string; edition: string } }[];
  oldGroups: z.infer<typeof PlexPhysicalGroupSchema>[];
  newGroups: z.infer<typeof PlexPhysicalGroupSchema>[];
}) {
  const targets = value.targets.map((row) => plexScopeKey(row.scope));
  const previous = value.previous.map((row) => plexScopeKey(row.scope));
  const covered = new Set(
    [...value.oldGroups, ...value.newGroups].flatMap((row) =>
      row.coverage.map((scope) => plexScopeKey(scope)),
    ),
  );
  const oldCoverage = value.oldGroups.flatMap((group) =>
    group.coverage.map((scope) => plexScopeKey(scope)),
  );
  const newCoverage = value.newGroups.flatMap((group) =>
    group.coverage.map((scope) => plexScopeKey(scope)),
  );
  return (
    new Set(oldCoverage).size === oldCoverage.length &&
    new Set(newCoverage).size === newCoverage.length &&
    plexSortedUnique(targets) &&
    plexSortedUnique(previous) &&
    plexSortedUnique(value.oldGroups.map((row) => row.assetId)) &&
    plexSortedUnique(value.newGroups.map((row) => row.assetId)) &&
    targets.length === previous.length &&
    targets.length === covered.size &&
    targets.every((key, index) => key === previous[index] && covered.has(key))
  );
}

export type PlexTargetExpected = z.infer<typeof PlexTargetExpectedSchema>;
export type PlexPublicationParent = z.infer<typeof PlexPublicationParentSchema>;
export type PlexBindingExpected = z.infer<typeof PlexBindingExpectedSchema>;
export type PlexBindingLockScope = {
  expected: PlexBindingExpected;
  mediaIds: string[];
  canonicalRootIds: string[];
  assetIds: string[];
  userIds: string[];
  serverMachineId: string;
};
