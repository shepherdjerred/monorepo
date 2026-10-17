import nodePath from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { z } from "zod";
import { sha256File } from "#filesystem/operations-io.ts";
import { fileOperations } from "./file-operations.ts";
import { assertRuntime } from "./guards.ts";
import {
  FileGuardError,
  type FileContext,
  type FilePlanEntry,
  type Transaction,
} from "./types.ts";

/** With every covered media row locked, undo only effects whose DB commit never happened. */
export async function recoverObsoletePublication(input: {
  context: FileContext;
  tx: Transaction;
  attemptId: string;
  plan: readonly FilePlanEntry[];
}): Promise<void> {
  const { context, tx, attemptId, plan } = input;
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const epoch = z
    .object({ recoveryEpoch: z.number().int() })
    .parse(attempt).recoveryEpoch;
  await assertRuntime(tx, epoch);
  for (const entry of plan) {
    if (
      (await tx.libraryAsset.findUnique({ where: { id: entry.assetId } })) !==
      null
    )
      continue;
    const roots = context.roots[entry.libraryKind];
    const authorize = async () => {
      await context.checkpoint("obsolete-publication-recovery");
      await assertRuntime(tx, epoch);
      const coverage = await tx.assetCoverage.findMany({
        where: { mediaId: { in: entry.mediaIds }, current: true },
      });
      if (coverage.some((item) => item.assetId !== entry.previousAssetId))
        throw new FileGuardError("recovery_asset_changed");
    };
    await authorize();
    const operations = fileOperations(context, roots, authorize);
    const journal = await operations.readManifest(entry.operationId);
    if (journal === null) continue;
    const target = nodePath.join(roots.library, entry.libraryPath);
    const digest = await existingDigest(target);
    await compensateVideo(operations, entry, digest);
    for (const sidecar of entry.previousSidecars) {
      const sidecarJournal = await operations.readManifest(sidecar.operationId);
      if (sidecarJournal !== null)
        await operations.restore({
          operationId: `recover-${sidecar.quarantineId}`,
          quarantineId: sidecar.quarantineId,
          libraryPath: sidecar.libraryPath,
          sha256: sidecar.checksum,
        });
    }
  }
  await tx.acquisitionAttempt.update({
    where: { id: attemptId },
    data: { state: "obsolete", failure: { reason: "publication_compensated" } },
  });
  await tx.acquisitionReservation.deleteMany({ where: { attemptId } });
}

async function compensateVideo(
  operations: ReturnType<typeof fileOperations>,
  entry: FilePlanEntry,
  digest: string | null,
): Promise<void> {
  if (digest === entry.checksum) {
    if (entry.previousChecksum === null) {
      await operations.quarantine({
        operationId: `recover-${entry.assetId}`,
        quarantineId: entry.assetId,
        libraryPath: entry.libraryPath,
        sha256: entry.checksum,
      });
    } else {
      await operations.rollbackImport({
        operationId: entry.operationId,
        rollbackOperationId: `recover-${entry.assetId}`,
        libraryPath: entry.libraryPath,
        sha256: entry.checksum,
        previousSha256: entry.previousChecksum,
      });
    }
  } else if (digest !== null && digest !== entry.previousChecksum)
    throw new FileGuardError("recovery_content_changed");
}

async function existingDigest(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || (await realpath(path)) !== path)
      throw new FileGuardError("recovery_path_unsafe");
  } catch (error) {
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      return null;
    throw error;
  }
  return await sha256File(path);
}
