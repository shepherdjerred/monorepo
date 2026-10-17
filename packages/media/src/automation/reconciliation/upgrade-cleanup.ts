import type { Prisma } from "#generated/prisma/client.ts";
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
import { queueOperation } from "#automation/store.ts";
import { serializable } from "#automation/store.ts";
import type { MediaAutomationContext } from "#automation/context.ts";

/** The rollback clock starts at verified Plex publication, never at filesystem promotion. */
export async function recordVerifiedPublication(
  tx: Prisma.TransactionClient,
  assetIds: readonly string[],
  recoveryEpoch: number,
): Promise<void> {
  const timestamp = new Date();
  for (const assetId of new Set(assetIds)) {
    await assertDefaultPhysicalAsset(tx, assetId);
    await tx.libraryAsset.updateMany({
      where: { id: assetId, plexPublishedAt: null },
      data: { plexPublishedAt: timestamp },
    });
    const successor = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: assetId },
    });
    if (successor.plexPublishedAt === null)
      throw new Error("Verified publication timestamp missing");
    const expiresAt = new Date(
      successor.plexPublishedAt.getTime() + 7 * 86_400_000,
    );
    const previous = await tx.libraryAsset.findMany({
      where: {
        supersededByAssetId: assetId,
        edition: "default",
        state: "superseded",
        owned: true,
      },
    });
    for (const asset of previous) {
      await tx.libraryAsset.update({
        where: { id: asset.id },
        data: { rollbackExpiresAt: expiresAt },
      });
      const cleanup = await tx.upgradeCleanup.upsert({
        where: {
          assetId_successorAssetId: {
            assetId: asset.id,
            successorAssetId: assetId,
          },
        },
        create: {
          assetId: asset.id,
          successorAssetId: assetId,
          recoveryEpoch,
          expiresAt,
        },
        update: {},
      });
      await queueOperation(tx, {
        key: `upgrade-cleanup:${cleanup.id}`,
        kind: "cleanup_upgrade",
        targetId: cleanup.id,
        payload: { cleanupId: cleanup.id },
      });
    }
  }
}

export async function queueUpgradeCleanupPage(
  context: MediaAutomationContext,
  input: {
    cursor: string | null;
    scanId: string;
  },
) {
  const runtime = await context.db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const records = await context.db.upgradeCleanup.findMany({
    where: {
      state: "pending",
      recoveryEpoch: runtime.recoveryEpoch,
      expiresAt: { lte: new Date() },
      ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
    },
    orderBy: { id: "asc" },
    take: 25,
  });
  for (const cleanup of records) {
    const previous = await context.db.operation.findFirst({
      where: { kind: "cleanup_upgrade", targetId: cleanup.id },
      orderBy: { createdAt: "desc" },
    });
    if (previous !== null) {
      const workflow = await context.describeWorkflow(
        `media-operation-${previous.id}`,
      );
      if (
        workflow === null ||
        ![
          "COMPLETED",
          "FAILED",
          "CANCELLED",
          "TERMINATED",
          "TIMED_OUT",
        ].includes(workflow.status)
      )
        continue;
    }
    await serializable(context.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR SHARE`;
      const current = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      if (current.recoveryEpoch !== cleanup.recoveryEpoch) return;
      await queueOperation(tx, {
        key: `upgrade-cleanup:${cleanup.id}:scan:${input.scanId}`,
        kind: "cleanup_upgrade",
        targetId: cleanup.id,
        payload: { cleanupId: cleanup.id },
      });
    });
  }
  return {
    processed: records.length,
    nextCursor: records.length === 25 ? (records.at(-1)?.id ?? null) : null,
  };
}
