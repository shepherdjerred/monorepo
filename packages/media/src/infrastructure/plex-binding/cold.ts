import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  PlexPublicationParentSchema,
  type PlexPublicationParent,
} from "#shared/plex-binding/expected.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import type { PlexPhysicalGroup } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { findPublicationOriginalGrant } from "#infrastructure/publication-proof/grants.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { ordinaryPlexLineageReader } from "./lineage.ts";
import {
  assertPlexRestorationParent,
  readPlexRestorationParent,
} from "./restoration.ts";
import { readPlexPhysicalGroup } from "./read.ts";
import { capturePlexBindingExpected } from "./authority.ts";
import { PlexBindingProtection } from "./errors.ts";
import { readPlexGroupUnion } from "./groups.ts";
import { findPlexRollbackParent } from "./rollback.ts";
import { readPlexRollbackAttempt } from "./rollback.ts";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import { compensationRecord } from "#infrastructure/native-compensation/records.ts";
import {
  assertCompensationPublicationPhase,
  type CompensationPublicationPhase,
} from "#infrastructure/native-compensation/publication/phase.ts";

/** Trusted inventory capture, with no request creation, sponsor selection, or download consent. */
export async function captureExistingPlexBindingExpected(
  tx: Prisma.TransactionClient,
  input: {
    assetIds: readonly string[];
    access: readonly PlexAccess[];
  },
  budget = new PublicationAuthorityReadBudget(),
) {
  if (
    input.assetIds.length === 0 ||
    input.assetIds.length > 100 ||
    new Set(input.assetIds).size !== input.assetIds.length
  )
    throw new PlexBindingProtection("scope_changed");
  const selected = await tx.assetCoverage.findMany({
    where: {
      assetId: { in: [...input.assetIds] },
      current: true,
      edition: "default",
    },
    select: { mediaId: true },
  });
  const union = await readPlexGroupUnion(
    tx,
    [...new Set(selected.map((row) => row.mediaId))].sort(),
  );
  if (
    input.assetIds.some(
      (id) => !union.newGroups.some((group) => group.assetId === id),
    )
  )
    throw new PlexBindingProtection("scope_changed");
  return captureUnionParents(tx, { union, access: input.access }, budget);
}

/** The active publication owns its exact groups; overlapping retained groups use cold authority. */
export async function capturePublicationPlexBindingExpected(
  tx: Prisma.TransactionClient,
  input: {
    mediaIds: readonly string[];
    parent: PlexPublicationParent;
    access: readonly PlexAccess[];
  },
  budget = new PublicationAuthorityReadBudget(),
  compensationPhase?: CompensationPublicationPhase,
) {
  const parent = PlexPublicationParentSchema.parse(input.parent);
  if (compensationPhase !== undefined) {
    assertCompensationPublicationPhase(tx, compensationPhase, budget);
    if (
      identityHash(parent) !== identityHash(compensationPhase.parent) ||
      identityHash([...new Set(input.mediaIds)].sort()) !==
        identityHash(compensationPhase.mediaIds)
    )
      throw new PlexBindingProtection("scope_changed");
  }
  const union = await readPlexGroupUnion(tx, input.mediaIds);
  if (
    compensationPhase !== undefined &&
    identityHash(union.mediaIds) !== identityHash(compensationPhase.mediaIds)
  )
    throw new PlexBindingProtection("scope_changed");
  return captureUnionParents(
    tx,
    { union, access: input.access, parent, compensationPhase },
    budget,
  );
}

async function captureUnionParents(
  tx: Prisma.TransactionClient,
  input: {
    union: Awaited<ReturnType<typeof readPlexGroupUnion>>;
    access: readonly PlexAccess[];
    parent?: PlexPublicationParent;
    compensationPhase?: CompensationPublicationPhase | undefined;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { union } = input;
  let cachedLineage: ReturnType<typeof ordinaryPlexLineageReader> | undefined;
  const lineage = () =>
    (cachedLineage ??= ordinaryPlexLineageReader(tx, union.newGroups, budget));
  const parents: PlexPublicationParent[] =
    input.parent === undefined ? [] : [input.parent];
  const coveredAssets =
    input.parent === undefined
      ? new Set<string>()
      : await publicationParentAssets(
          tx,
          input.parent,
          budget,
          input.compensationPhase,
        );
  const selectedCovered = union.newGroups.filter((group) =>
    coveredAssets.has(group.assetId),
  );
  if (
    input.parent !== undefined &&
    (selectedCovered.length === 0 ||
      ((input.parent.kind === "acquisition" ||
        input.parent.kind === "compensation") &&
        selectedCovered.length !== coveredAssets.size))
  )
    throw new PlexBindingProtection("scope_changed");
  const mediaIds = new Set<string>();
  const pending = union.newGroups.map((group) => group.assetId);
  for (const assetId of pending) {
    if (pending.length > 100) throw new PlexBindingProtection("scope_changed");
    const { asset, group } = await readPlexPhysicalGroup(tx, assetId);
    if (asset.state !== "published")
      throw new PlexBindingProtection("ownership_changed");
    for (const scope of group.coverage) mediaIds.add(scope.mediaId);
    if (coveredAssets.has(assetId)) continue;
    const parent = await coldAssetParent(tx, { asset, group, lineage, budget });
    appendColdParent(parents, parent);
    coveredAssets.add(assetId);
  }
  return capturePlexBindingExpected(tx, {
    mediaIds: [...mediaIds].sort(),
    parents,
    access: input.access,
  });
}

function appendColdParent(
  parents: PlexPublicationParent[],
  parent: PlexPublicationParent,
) {
  if (parent.kind === "rollback") {
    if (
      !parents.some(
        (value) =>
          value.kind === "rollback" && value.attemptId === parent.attemptId,
      )
    )
      parents.push(parent);
  } else if (parent.kind === "restore") {
    if (
      !parents.some(
        (value) =>
          value.kind === "restore" && value.operationId === parent.operationId,
      )
    )
      parents.push(parent);
  } else parents.push(parent);
}

async function coldAssetParent(
  tx: Prisma.TransactionClient,
  input: {
    asset: { id: string; version: number };
    group: PlexPhysicalGroup;
    lineage: () => ReturnType<typeof ordinaryPlexLineageReader>;
    budget: PublicationAuthorityReadBudget;
  },
): Promise<PlexPublicationParent> {
  const { asset, group, lineage, budget } = input;
  const assetId = asset.id;
  const rolled = await findPlexRollbackParent(tx, group);
  if (rolled !== null) {
    return rolled;
  }
  const restored = await findRestorationParent(tx, group, budget);
  if (restored !== null) {
    return restored;
  }
  let physicalGrant = null;
  // Original births have version zero; rebaseline versions require an exact native grant.
  let nativeDerived = asset.version !== 0;
  if (asset.version === 0) {
    const reader = await lineage();
    nativeDerived = reader.hasNativePredecessor(group);
  }
  if (nativeDerived) {
    const root = await tx.mediaItem.findUniqueOrThrow({
      where: { id: group.canonicalRootId },
      select: { kind: true },
    });
    physicalGrant = await findPublicationOriginalGrant(
      tx,
      {
        asset: await snapshotPublicationAsset(tx, assetId),
        libraryKind: root.kind === "movie" ? "movies" : "tv",
      },
      budget,
    );
    if (physicalGrant === null)
      throw new PlexBindingProtection("ownership_changed");
  } else {
    const reader = await lineage();
    await reader.assert(group);
  }
  return PlexPublicationParentSchema.parse({
    kind: "existing_asset",
    assetId,
    assetVersion: group.assetVersion,
    recoveryEpoch: group.ownershipEpoch,
    physicalGrant,
  });
}

async function publicationParentAssets(
  tx: Prisma.TransactionClient,
  parent: PlexPublicationParent,
  budget: PublicationAuthorityReadBudget,
  compensationPhase?: CompensationPublicationPhase,
): Promise<Set<string>> {
  if (parent.kind === "existing_asset") return new Set([parent.assetId]);
  if (parent.kind === "compensation") {
    const phase =
      compensationPhase === undefined
        ? undefined
        : assertCompensationPublicationPhase(tx, compensationPhase, budget);
    if (
      phase !== undefined &&
      identityHash(phase.parent) !== identityHash(parent)
    )
      throw new PlexBindingProtection("ownership_changed");
    const record =
      phase?.record ??
      (await compensationRecord(tx, parent.continuationId, budget));
    if (
      record.completion === null ||
      record.row.descriptorHash !== parent.descriptorHash ||
      identityHash(record.completion) !== parent.completionHash
    )
      throw new PlexBindingProtection("ownership_changed");
    return new Set(
      record.completion.predecessorBindings.map((binding) => binding.after.id),
    );
  }
  if (parent.kind === "acquisition") {
    const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: parent.attemptId },
    });
    if (
      identityHash(attempt.filePlan) !== parent.planHash ||
      attempt.operationId !== parent.operationId ||
      attempt.recoveryEpoch !== parent.recoveryEpoch
    )
      throw new PlexBindingProtection("ownership_changed");
    return new Set(
      z
        .array(FilePlanEntrySchema)
        .min(1)
        .max(100)
        .parse(attempt.filePlan)
        .map((entry) => entry.assetId),
    );
  }
  if (parent.kind === "rollback") {
    const record = await readPlexRollbackAttempt(tx, parent.attemptId);
    if (
      record.attempt.operationId !== parent.operationId ||
      identityHash(record.attempt.failure) !== parent.failureHash ||
      identityHash(record.attempt.filePlan) !== parent.planHash
    )
      throw new PlexBindingProtection("ownership_changed");
    return new Set(record.receipt.assets.map((asset) => asset.assetId));
  }
  const { receipt } = await assertPlexRestorationParent(tx, parent, budget);
  return new Set(receipt.assets.map((asset) => asset.assetId));
}

async function findRestorationParent(
  tx: Prisma.TransactionClient,
  group: Awaited<ReturnType<typeof readPlexPhysicalGroup>>["group"],
  budget: PublicationAuthorityReadBudget,
) {
  if (group.assetVersion === 0) return null;
  const operations = await tx.operation.findMany({
    where: {
      kind: { in: ["restore_media", "restore_native_quarantine"] },
      result: {
        path: ["restoreReceipt", "assets"],
        array_contains: [
          {
            assetId: group.assetId,
            assetVersion: group.assetVersion,
            checksum: group.checksum,
          },
        ],
      },
    },
    orderBy: { id: "asc" },
    take: 2,
  });
  budget.consume(operations.length);
  if (operations.length > 1)
    throw new PlexBindingProtection("ownership_changed");
  const operation = operations[0];
  if (operation === undefined) return null;
  const { receipt, parent } = await readPlexRestorationParent(
    tx,
    operation.id,
    budget,
  );
  if (receipt.recoveryEpoch !== group.ownershipEpoch)
    throw new PlexBindingProtection("ownership_changed");
  return parent;
}
