import nodePath from "node:path";
import { z } from "zod";
import {
  FileGuardError,
  FilePlanSchema,
  type FileContext,
  type FilePlanEntry,
  type Transaction,
} from "./types.ts";
import { assertRuntime, lockMedia } from "./guards.ts";
import { fileOperations } from "./file-operations.ts";
import { quarantineInitialPublication } from "./rollback-initial.ts";
import { preparePublicationProof } from "./content-proof.ts";

/** Failed Plex verification restores the last playable version, preserving both files. */
export async function rollbackPromotion(
  initialContext: FileContext,
  attemptId: string,
  operationId: string,
): Promise<void> {
  const attempt = await initialContext.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const context = await preparePublicationProof(
    initialContext,
    plan,
    operationId,
  );
  await context.db.$transaction(
    async (tx) => {
      await lockMedia(tx, attempt.mediaIds);
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      if (current.state === "rolled_back") return;
      for (const entry of plan) {
        if (entry.previousAssetId === null) {
          await quarantineInitialPublication({
            context,
            tx,
            entry,
            operationId,
            recoveryEpoch: current.recoveryEpoch,
          });
          continue;
        }
        const previousAssetId = entry.previousAssetId;
        const previousChecksum = entry.previousChecksum;
        if (previousChecksum === null || entry.previousVersion === null)
          throw new FileGuardError("no_previous_version");
        const rollbackOperationId = `${operationId}-rollback-${entry.assetId}`;
        const roots = context.roots[entry.libraryKind];
        const authorize = async () => {
          await context.checkpoint("rollback-authorization");
          if (!(await context.enabled.acquisition()))
            throw new FileGuardError("acquisition_disabled");
          const epoch = z
            .object({ recoveryEpoch: z.number().int() })
            .parse(current).recoveryEpoch;
          await assertRuntime(tx, epoch);
          const intents = await tx.mediaIntent.findMany({
            where: { mediaId: { in: entry.mediaIds } },
          });
          if (
            intents.length !== entry.mediaIds.length ||
            intents.some(
              (intent) =>
                !intent.desiredPresence ||
                intent.automationEpoch !== epoch ||
                intent.generation !== entry.generations[intent.mediaId],
            )
          )
            throw new FileGuardError("intent_obsolete");
          const asset = await tx.libraryAsset.findUniqueOrThrow({
            where: { id: entry.assetId },
            include: { coverage: { where: { current: true } } },
          });
          const previous = await tx.libraryAsset.findUniqueOrThrow({
            where: { id: previousAssetId },
          });
          if (
            !asset.owned ||
            asset.ownershipEpoch !== epoch ||
            asset.checksum !== entry.checksum ||
            asset.state !== "published" ||
            asset.coverage.length !== entry.mediaIds.length ||
            !previous.owned ||
            previous.ownershipEpoch !== epoch ||
            previous.checksum !== previousChecksum ||
            previous.state !== "superseded" ||
            previous.path !==
              nodePath.join(roots.control, "rollback", entry.operationId)
          )
            throw new FileGuardError("rollback_asset_changed");
        };
        await authorize();
        const operations = fileOperations(context, roots, authorize);
        await operations.rollbackImport({
          operationId: entry.operationId,
          rollbackOperationId,
          libraryPath: entry.libraryPath,
          sha256: entry.checksum,
          previousSha256: previousChecksum,
        });
        for (const sidecar of entry.previousSidecars) {
          await operations.restore({
            operationId: `${operationId}-rollback-sidecar-${sidecar.quarantineId}`,
            quarantineId: sidecar.quarantineId,
            libraryPath: sidecar.libraryPath,
            sha256: sidecar.checksum,
          });
          await tx.subtitleAsset.update({
            where: { id: sidecar.subtitleId },
            data: {
              state: "installed",
              path: nodePath.join(roots.library, sidecar.libraryPath),
            },
          });
        }
        await tx.assetCoverage.updateMany({
          where: { assetId: entry.assetId },
          data: { current: false },
        });
        await tx.libraryAsset.update({
          where: { id: entry.assetId },
          data: {
            path: nodePath.join(roots.control, "rollback", rollbackOperationId),
            state: "rejected",
            version: { increment: 1 },
          },
        });
        await tx.libraryAsset.update({
          where: { id: previousAssetId },
          data: {
            path: nodePath.join(roots.library, entry.libraryPath),
            state: "published",
            supersededByAssetId: null,
            rollbackExpiresAt: null,
            version: { increment: 1 },
          },
        });
        await tx.upgradeCleanup.updateMany({
          where: {
            assetId: previousAssetId,
            successorAssetId: entry.assetId,
            state: "pending",
          },
          data: { state: "cancelled", version: { increment: 1 } },
        });
        await tx.assetCoverage.updateMany({
          where: { assetId: previousAssetId, mediaId: { in: entry.mediaIds } },
          data: { current: true },
        });
        await tx.mediaItem.updateMany({
          where: { id: { in: entry.mediaIds } },
          data: { availability: "importing", version: { increment: 1 } },
        });
      }
      await recordRollbackReceipt(tx, plan, {
        attemptId,
        recoveryEpoch: current.recoveryEpoch,
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  if (plan.some((entry) => entry.previousAssetId === null))
    throw new FileGuardError("new_publications_quarantined");
}

async function recordRollbackReceipt(
  tx: Transaction,
  plan: FilePlanEntry[],
  input: { attemptId: string; recoveryEpoch: number },
): Promise<void> {
  const restored = plan.filter((entry) => entry.previousAssetId !== null);
  const assets = await tx.libraryAsset.findMany({
    where: {
      id: {
        in: restored.flatMap((entry) =>
          entry.previousAssetId === null ? [] : [entry.previousAssetId],
        ),
      },
    },
    select: { id: true, version: true, checksum: true },
  });
  const receipt = {
    recoveryEpoch: input.recoveryEpoch,
    mediaIds: [...new Set(restored.flatMap((entry) => entry.mediaIds))],
    assets: assets.map((asset) => ({
      assetId: asset.id,
      assetVersion: asset.version,
      checksum: z.string().parse(asset.checksum),
    })),
  };
  await tx.$executeRaw`UPDATE "AcquisitionAttempt" SET state = 'rolled_back', failure = COALESCE(failure, '{}'::jsonb) || ${JSON.stringify({ rollbackReceipt: receipt })}::jsonb, "updatedAt" = NOW() WHERE id = ${input.attemptId}`;
  // Every first-publication effect is compensated in this same transaction.
  // Mixed batches retain all reservations until Plex verifies their predecessors.
  if (restored.length === 0)
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: input.attemptId },
    });
}
