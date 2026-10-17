import nodePath from "node:path";
import { z } from "zod";
import { FileGuardError, FilePlanSchema, type FileContext } from "./types.ts";
import { assertRuntime, lockMedia } from "./guards.ts";
import { fileOperations } from "./file-operations.ts";
import { quarantineInitialPublication } from "./rollback-initial.ts";

/** Failed Plex verification restores the last playable version, preserving both files. */
export async function rollbackPromotion(
  context: FileContext,
  attemptId: string,
  operationId: string,
): Promise<void> {
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
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
            asset.checksum !== entry.checksum ||
            asset.state !== "published" ||
            asset.coverage.length !== entry.mediaIds.length ||
            !previous.owned ||
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
            version: { increment: 1 },
          },
        });
        await tx.assetCoverage.updateMany({
          where: { assetId: previousAssetId, mediaId: { in: entry.mediaIds } },
          data: { current: true },
        });
        await tx.mediaItem.updateMany({
          where: { id: { in: entry.mediaIds } },
          data: { availability: "available", version: { increment: 1 } },
        });
      }
      await tx.acquisitionAttempt.update({
        where: { id: attemptId },
        data: { state: "rolled_back" },
      });
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
  if (plan.some((entry) => entry.previousAssetId === null))
    throw new FileGuardError("new_publications_quarantined");
}
