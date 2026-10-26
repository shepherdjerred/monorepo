import path from "node:path";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import type { PlexPhysicalGroup } from "#shared/plex-binding/contract.ts";
import type { PlexPublicationParent } from "#shared/plex-binding/expected.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadPublicationIntent } from "#infrastructure/publication-proof/store.ts";
import { assertRecordedPublicationGrant } from "#infrastructure/publication-proof/authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import { PlexBindingProtection } from "./errors.ts";

export const PlexRollbackReceiptSchema = z.object({
  rollbackReceipt: z.object({
    recoveryEpoch: z.int().nonnegative(),
    mediaIds: z.array(z.uuid()),
    assets: z.array(
      z.object({
        assetId: z.uuid(),
        assetVersion: z.int().nonnegative(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    ),
  }),
});

/** Complete literal rollback receipt validation does not consult today's sponsor or choice. */
export async function readPlexRollbackAttempt(
  tx: Prisma.TransactionClient,
  attemptId: string,
) {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const receipt = PlexRollbackReceiptSchema.parse(
    attempt.failure,
  ).rollbackReceipt;
  const plan = z
    .array(FilePlanEntrySchema)
    .min(1)
    .max(100)
    .parse(attempt.filePlan);
  const restored = plan.filter((entry) => entry.previousAssetId !== null);
  const assetIds = restored.flatMap((entry) =>
    entry.previousAssetId === null ? [] : [entry.previousAssetId],
  );
  const mediaIds = [
    ...new Set(restored.flatMap((entry) => entry.mediaIds)),
  ].sort();
  if (
    attempt.edition !== "default" ||
    attempt.state !== "rolled_back" ||
    receipt.recoveryEpoch !== attempt.recoveryEpoch ||
    new Set(assetIds).size !== assetIds.length ||
    new Set(receipt.assets.map((asset) => asset.assetId)).size !==
      receipt.assets.length ||
    identityHash([...assetIds].sort()) !==
      identityHash(receipt.assets.map((asset) => asset.assetId).sort()) ||
    new Set(receipt.mediaIds).size !== receipt.mediaIds.length ||
    identityHash(mediaIds) !== identityHash([...receipt.mediaIds].sort()) ||
    receipt.mediaIds.some((id) => !attempt.mediaIds.includes(id))
  )
    throw new Error("Plex rollback receipt lost its complete original plan");
  for (const entry of restored) {
    const asset = receipt.assets.find(
      (value) => value.assetId === entry.previousAssetId,
    );
    if (
      asset === undefined ||
      entry.previousChecksum === null ||
      entry.previousVersion === null ||
      asset.checksum !== entry.previousChecksum ||
      asset.assetVersion !== entry.previousVersion + 2
    )
      throw new Error("Plex rollback receipt predecessor changed");
  }
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: attempt.operationId },
  });
  if (
    operation.targetId === null ||
    !attempt.mediaIds.includes(operation.targetId)
  )
    throw new Error(
      "Plex rollback original operation lost its captured target",
    );
  return { attempt, receipt, plan };
}

export async function findPlexRollbackParent(
  tx: Prisma.TransactionClient,
  group: PlexPhysicalGroup,
) {
  if (group.assetVersion === 0) return null;
  const rows = await tx.acquisitionAttempt.findMany({
    where: {
      state: "rolled_back",
      edition: "default",
      recoveryEpoch: group.ownershipEpoch,
      failure: {
        path: ["rollbackReceipt", "assets"],
        array_contains: [
          {
            assetId: group.assetId,
            assetVersion: group.assetVersion,
            checksum: group.checksum,
          },
        ],
      },
    },
    select: { id: true },
    take: 2,
  });
  if (rows.length > 1) throw new PlexBindingProtection("ownership_changed");
  const row = rows[0];
  if (row === undefined) return null;
  const { attempt } = await readPlexRollbackAttempt(tx, row.id);
  return {
    kind: "rollback" as const,
    attemptId: attempt.id,
    operationId: attempt.operationId,
    failureHash: identityHash(attempt.failure),
    planHash: identityHash(attempt.filePlan),
    recoveryEpoch: attempt.recoveryEpoch,
  };
}

/** Returns the exact recorded native origin, or null for the ordinary historical version chain. */
export async function assertPlexRollbackParent(
  tx: Prisma.TransactionClient,
  input: {
    parent: Extract<PlexPublicationParent, { kind: "rollback" }>;
    groups: readonly PlexPhysicalGroup[];
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { parent } = input;
  const { attempt, receipt, plan } = await readPlexRollbackAttempt(
    tx,
    parent.attemptId,
  );
  if (
    attempt.operationId !== parent.operationId ||
    attempt.recoveryEpoch !== parent.recoveryEpoch ||
    identityHash(attempt.failure) !== parent.failureHash ||
    identityHash(attempt.filePlan) !== parent.planHash
  )
    throw new PlexBindingProtection("ownership_changed");
  const groups = input.groups.filter((group) =>
    receipt.assets.some(
      (asset) =>
        asset.assetId === group.assetId &&
        asset.assetVersion === group.assetVersion &&
        asset.checksum === group.checksum,
    ),
  );
  if (groups.length === 0) throw new PlexBindingProtection("ownership_changed");
  const original = await loadPublicationIntent(tx, attempt.id, budget);
  const ordinary = [];
  for (const group of groups) {
    const entry = plan.find((value) => value.previousAssetId === group.assetId);
    if (
      entry === undefined ||
      identityHash([...entry.mediaIds].sort()) !==
        identityHash(group.coverage.map((scope) => scope.mediaId)) ||
      path.posix.join(CAPACITY_ROOTS[entry.libraryKind], entry.libraryPath) !==
        group.canonicalPath
    )
      throw new PlexBindingProtection("scope_changed");
    const recorded = original?.intent.entries.find(
      (value) => value.entry.operationId === entry.operationId,
    );
    if (original !== null && recorded === undefined)
      throw new Error("Plex rollback intent omitted its entry");
    if (recorded?.originalGrant == null) ordinary.push(group);
    else {
      const predecessor = recorded.predecessor;
      if (predecessor === null)
        throw new Error("Plex rollback recorded native predecessor changed");
      assertRollbackPredecessor(predecessor, group, entry.previousVersion);
      await assertRecordedPublicationGrant(
        tx,
        {
          reference: recorded.originalGrant,
          snapshot: predecessor,
          libraryKind: entry.libraryKind,
        },
        budget,
      );
    }
  }
  return { groups, ordinary };
}

function assertRollbackPredecessor(
  predecessor: PublicationAssetSnapshot,
  group: PlexPhysicalGroup,
  previousVersion: number | null,
) {
  if (
    predecessor.id !== group.assetId ||
    predecessor.version !== previousVersion ||
    predecessor.checksum !== group.checksum ||
    predecessor.sizeBytes !== group.sizeBytes ||
    predecessor.path !== group.canonicalPath ||
    predecessor.ownershipEpoch !== group.ownershipEpoch ||
    predecessor.editionRootId !== group.canonicalRootId ||
    identityHash(
      predecessor.coverage
        .filter((value) => value.current)
        .map(({ mediaId, edition }) => ({ mediaId, edition })),
    ) !== identityHash(group.coverage)
  )
    throw new Error("Plex rollback recorded native predecessor changed");
}
