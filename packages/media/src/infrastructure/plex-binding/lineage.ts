import path from "node:path";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import type { PlexPhysicalGroup } from "#shared/plex-binding/contract.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadPublicationIntentRecord } from "#infrastructure/publication-proof/store.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PlexBindingProtection } from "./errors.ts";
import type {
  PublicationAssetSnapshot,
  PublicationEntryIntent,
} from "#shared/publication-proof/intent.ts";
import {
  readPlexRollbackAttempt,
  PlexRollbackReceiptSchema,
} from "./rollback.ts";

export const OrdinaryRestoreReceiptSchema = z.object({
  restoreReceipt: z.object({
    decisionId: z.string(),
    mediaIds: z.array(z.string()).min(1),
    recoveryEpoch: z.int(),
    assets: z
      .array(
        z.object({
          assetId: z.string(),
          assetVersion: z.int(),
          checksum: z.string(),
        }),
      )
      .min(1),
  }),
});

/** Validate the whole recorded restoration without requiring unrelated assets to remain current. */
export async function readOrdinaryPlexRestoration(
  tx: Prisma.TransactionClient,
  raw: unknown,
) {
  const receipt = OrdinaryRestoreReceiptSchema.parse(raw).restoreReceipt;
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: receipt.decisionId },
  });
  const manifest = RemovalPlanSchema.parse(decision.manifest);
  const epoch = z
    .object({ recoveryEpoch: z.int().nonnegative() })
    .parse(decision.evidence).recoveryEpoch;
  const ids = receipt.assets.map((asset) => asset.assetId);
  const mediaIds = [
    ...new Set(manifest.assets.flatMap((asset) => asset.mediaIds)),
  ].sort();
  if (
    decision.state !== "restored" ||
    decision.edition !== "default" ||
    epoch !== receipt.recoveryEpoch ||
    new Set(ids).size !== ids.length ||
    identityHash([...ids].sort()) !==
      identityHash(manifest.assets.map((asset) => asset.assetId).sort()) ||
    new Set(receipt.mediaIds).size !== receipt.mediaIds.length ||
    identityHash([...receipt.mediaIds].sort()) !== identityHash(mediaIds)
  )
    throw new Error(
      "Original Plex restoration receipt lost its complete manifest",
    );
  for (const asset of receipt.assets) {
    const entry = manifest.assets.find(
      (value) => value.assetId === asset.assetId,
    );
    if (
      entry?.checksum !== asset.checksum ||
      ![entry.assetVersion + 1, entry.assetVersion + 2].includes(
        asset.assetVersion,
      )
    )
      throw new Error("Original Plex restoration receipt asset changed");
  }
  return { receipt, manifest };
}

/** A source FilePlan proves bytes, never current request, choice, or generation consent. */
export async function assertOrdinaryPlexLineage(
  tx: Prisma.TransactionClient,
  group: PlexPhysicalGroup,
  purpose: "cold_ordinary" | "current_acquisition" = "cold_ordinary",
): Promise<void> {
  const reader = await ordinaryPlexLineageReader(tx, [group]);
  await reader.assert(group, purpose);
}

/** Exact parent indexing lives only in this capture/assert call, never across a transaction or write. */
export async function ordinaryPlexLineageReader(
  tx: Prisma.TransactionClient,
  groups: readonly PlexPhysicalGroup[],
  budget?: PublicationAuthorityReadBudget,
) {
  if (
    groups.length === 0 ||
    groups.length > 100 ||
    new Set(groups.map((group) => group.assetId)).size !== groups.length
  )
    throw new Error(
      "Ordinary Plex lineage requires a bounded distinct physical cohort",
    );
  const attempts = await tx.acquisitionAttempt.findMany({
    where: {
      edition: "default",
      state: { in: ["imported", "completed"] },
      OR: groups.map((group) => ({
        recoveryEpoch: group.ownershipEpoch,
        filePlan: { array_contains: [{ assetId: group.assetId }] },
      })),
    },
    take: 201,
  });
  if (attempts.length > 200)
    throw new PlexBindingProtection("ownership_changed");
  const assets = await tx.libraryAsset.findMany({
    where: { id: { in: groups.map((group) => group.assetId) } },
    select: { id: true, torrentId: true },
  });
  const operations = await tx.operation.findMany({
    where: {
      id: { in: [...new Set(attempts.map((attempt) => attempt.operationId))] },
    },
    select: { id: true, targetId: true },
  });
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const operationsById = new Map(
    operations.map((operation) => [operation.id, operation]),
  );
  const capturedGroups = new Map(
    groups.map((group) => [group.assetId, identityHash(group)]),
  );
  const parents = [];
  for (const attempt of attempts) {
    const plan = z
      .array(FilePlanEntrySchema)
      .min(1)
      .max(100)
      .parse(attempt.filePlan);
    const original = await loadPublicationIntentRecord(tx, attempt.id, budget);
    const entries = new Map(plan.map((entry) => [entry.assetId, entry]));
    if (entries.size !== plan.length)
      throw new Error("Original publication FilePlan repeats an asset");
    const intentEntries = new Map(
      original?.reference.intent.entries.map((entry) => [
        entry.entry.assetId,
        entry,
      ]),
    );
    const successors = new Map(
      original?.outcome?.entries.flatMap((entry) =>
        entry.successor === null
          ? []
          : [[entry.successor.id, entry.successor] as const],
      ),
    );
    if (
      original !== null &&
      (intentEntries.size !== original.reference.intent.entries.length ||
        successors.size !==
          (original.outcome?.entries.filter((entry) => entry.successor !== null)
            .length ?? 0))
    )
      throw new Error("Original publication parent repeats an asset");
    parents.push({ attempt, entries, original, intentEntries, successors });
  }
  const parentsByAsset = new Map<string, typeof parents>();
  for (const parent of parents)
    for (const assetId of parent.entries.keys()) {
      const key = `${assetId}/${String(parent.attempt.recoveryEpoch)}`;
      const values = parentsByAsset.get(key) ?? [];
      values.push(parent);
      parentsByAsset.set(key, values);
    }
  function parentFor(group: PlexPhysicalGroup) {
    if (capturedGroups.get(group.assetId) !== identityHash(group))
      throw new Error(
        "Plex lineage reader used outside its exact captured cohort",
      );
    const matches =
      parentsByAsset.get(`${group.assetId}/${String(group.ownershipEpoch)}`) ??
      [];
    if (matches.length > 1)
      throw new PlexBindingProtection("ownership_changed");
    return matches[0];
  }
  return {
    hasNativePredecessor(group: PlexPhysicalGroup): boolean {
      const parent = parentFor(group);
      if (parent === undefined)
        throw new PlexBindingProtection("ownership_changed");
      if (parent.original === null) return false;
      const entry = parent.intentEntries.get(group.assetId);
      if (entry === undefined)
        throw new Error("Plex original transition omitted its queried entry");
      return entry.originalGrant !== null;
    },
    async assert(
      group: PlexPhysicalGroup,
      purpose: "cold_ordinary" | "current_acquisition" = "cold_ordinary",
    ): Promise<void> {
      const parent = parentFor(group);
      if (parent === undefined)
        throw new PlexBindingProtection("ownership_changed");
      const { attempt, original } = parent;
      const entry = parent.entries.get(group.assetId);
      const asset = assetsById.get(group.assetId);
      if (entry === undefined)
        throw new PlexBindingProtection("ownership_changed");
      if (
        asset?.torrentId !== attempt.torrentId ||
        attempt.torrentId === null ||
        entry.checksum !== group.checksum ||
        entry.sizeBytes !== group.sizeBytes ||
        path.posix.join(
          CAPACITY_ROOTS[entry.libraryKind],
          entry.libraryPath,
        ) !== group.canonicalPath ||
        identityHash([...entry.mediaIds].sort()) !==
          identityHash(group.coverage.map((scope) => scope.mediaId)) ||
        !entry.mediaIds.every((id) => attempt.mediaIds.includes(id))
      )
        throw new PlexBindingProtection("ownership_changed");
      const operation = operationsById.get(attempt.operationId);
      if (
        operation?.targetId == null ||
        !attempt.mediaIds.includes(operation.targetId)
      )
        throw new Error(
          "Original publication operation lost its captured target",
        );
      if (original !== null) {
        if (original.outcome === null)
          throw new PlexBindingProtection("ownership_changed");
        assertOrdinaryOutcome(
          group,
          parent.successors.get(group.assetId),
          parent.intentEntries.get(group.assetId),
          purpose,
        );
      }
      if (group.assetVersion !== 0)
        await assertOrdinaryRestorationChain(tx, group);
    },
  };
}

function assertOrdinaryOutcome(
  group: PlexPhysicalGroup,
  successor: PublicationAssetSnapshot | undefined,
  intentEntry: PublicationEntryIntent | undefined,
  purpose: "cold_ordinary" | "current_acquisition",
) {
  if (
    successor?.version !== 0 ||
    successor.ownershipEpoch !== group.ownershipEpoch ||
    successor.path !== group.canonicalPath ||
    successor.checksum !== group.checksum ||
    successor.sizeBytes !== group.sizeBytes
  )
    throw new Error("Original ordinary publication outcome changed");
  if (
    intentEntry === undefined ||
    (purpose === "cold_ordinary" && intentEntry.originalGrant !== null)
  )
    throw new PlexBindingProtection("ownership_changed");
}

async function assertOrdinaryRestorationChain(
  tx: Prisma.TransactionClient,
  group: PlexPhysicalGroup,
) {
  const operations = await tx.operation.findMany({
    where: {
      kind: "restore_media",
      result: {
        path: ["restoreReceipt", "assets"],
        array_contains: [{ assetId: group.assetId }],
      },
    },
    take: 101,
  });
  if (operations.length > 100)
    throw new PlexBindingProtection("ownership_changed");
  const rollbacks = await tx.acquisitionAttempt.findMany({
    where: {
      state: "rolled_back",
      edition: "default",
      recoveryEpoch: group.ownershipEpoch,
      failure: {
        path: ["rollbackReceipt", "assets"],
        array_contains: [{ assetId: group.assetId }],
      },
    },
    take: 101,
  });
  if (operations.length + rollbacks.length > 100)
    throw new PlexBindingProtection("ownership_changed");
  let version = group.assetVersion;
  const seen = new Set<string>();
  while (version > 0) {
    const matches = operations.filter((operation) => {
      const receipt = OrdinaryRestoreReceiptSchema.parse(
        operation.result,
      ).restoreReceipt;
      return (
        receipt.recoveryEpoch === group.ownershipEpoch &&
        receipt.assets.some(
          (asset) =>
            asset.assetId === group.assetId && asset.assetVersion === version,
        )
      );
    });
    const operation = matches[0];
    const rolled = rollbacks.filter((attempt) =>
      PlexRollbackReceiptSchema.parse(
        attempt.failure,
      ).rollbackReceipt.assets.some(
        (asset) =>
          asset.assetId === group.assetId && asset.assetVersion === version,
      ),
    );
    const rolledAttempt = rolled[0];
    if (
      rolledAttempt !== undefined &&
      matches.length === 0 &&
      rolled.length === 1
    ) {
      version = await rollbackRestorationVersion(
        tx,
        group,
        rolledAttempt.id,
        seen,
      );
      continue;
    }
    if (rolled.length > 0) throw new PlexBindingProtection("ownership_changed");
    if (
      operation === undefined ||
      matches.length !== 1 ||
      seen.has(operation.id)
    )
      throw new PlexBindingProtection("ownership_changed");
    seen.add(operation.id);
    version = await restoredOperationVersion(
      tx,
      group,
      operation.result,
      version,
    );
  }
}

async function restoredOperationVersion(
  tx: Prisma.TransactionClient,
  group: PlexPhysicalGroup,
  result: unknown,
  version: number,
) {
  const receipt = OrdinaryRestoreReceiptSchema.parse(result).restoreReceipt;
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: receipt.decisionId },
  });
  const manifest = RemovalPlanSchema.parse(decision.manifest);
  const entries = manifest.assets.filter(
    (entry) => entry.assetId === group.assetId,
  );
  const entry = entries[0];
  if (
    entry === undefined ||
    decision.state !== "restored" ||
    decision.edition !== "default" ||
    entries.length !== 1 ||
    receipt.assets.find((asset) => asset.assetId === group.assetId)
      ?.checksum !== group.checksum ||
    entry.checksum !== group.checksum ||
    path.posix.join(CAPACITY_ROOTS[entry.libraryKind], entry.libraryPath) !==
      group.canonicalPath ||
    identityHash([...entry.mediaIds].sort()) !==
      identityHash(group.coverage.map((scope) => scope.mediaId)) ||
    ![entry.assetVersion + 1, entry.assetVersion + 2].includes(version)
  )
    throw new PlexBindingProtection("ownership_changed");
  return entry.assetVersion;
}

async function rollbackRestorationVersion(
  tx: Prisma.TransactionClient,
  group: PlexPhysicalGroup,
  attemptId: string,
  seen: Set<string>,
) {
  const rollback = await readPlexRollbackAttempt(tx, attemptId);
  const key = `rollback:${rollback.attempt.id}`;
  const entry = rollback.plan.find(
    (value) => value.previousAssetId === group.assetId,
  );
  if (
    entry?.previousVersion == null ||
    seen.has(key) ||
    entry.previousChecksum !== group.checksum ||
    path.posix.join(CAPACITY_ROOTS[entry.libraryKind], entry.libraryPath) !==
      group.canonicalPath ||
    identityHash([...entry.mediaIds].sort()) !==
      identityHash(group.coverage.map((scope) => scope.mediaId))
  )
    throw new PlexBindingProtection("ownership_changed");
  seen.add(key);
  return entry.previousVersion;
}
