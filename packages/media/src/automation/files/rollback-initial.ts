import nodePath from "node:path";
import {
  FileGuardError,
  type FileContext,
  type FilePlanEntry,
  type Transaction,
} from "./types.ts";
import { assertRuntime } from "./guards.ts";
import { fileOperations } from "./file-operations.ts";

/** A failed first publication has no playable predecessor; retain its bytes outside Plex. */
export async function quarantineInitialPublication(input: {
  context: FileContext;
  tx: Transaction;
  entry: FilePlanEntry;
  operationId: string;
  recoveryEpoch: number;
}): Promise<void> {
  const { context, tx, entry, operationId, recoveryEpoch } = input;
  const roots = context.roots[entry.libraryKind];
  const authorize = async () => {
    await context.checkpoint("rollback-authorization");
    if (!(await context.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    await assertRuntime(tx, recoveryEpoch);
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
    if (
      !asset.owned ||
      asset.checksum !== entry.checksum ||
      asset.state !== "published" ||
      asset.path !== nodePath.join(roots.library, entry.libraryPath) ||
      asset.coverage.length !== entry.mediaIds.length ||
      asset.coverage.some((item) => !entry.mediaIds.includes(item.mediaId))
    )
      throw new FileGuardError("rollback_asset_changed");
  };
  await authorize();
  await fileOperations(context, roots, authorize).quarantine({
    operationId: `${operationId}-rollback-new-${entry.assetId}`,
    quarantineId: entry.assetId,
    libraryPath: entry.libraryPath,
    sha256: entry.checksum,
  });
  await tx.assetCoverage.updateMany({
    where: { assetId: entry.assetId },
    data: { current: false },
  });
  await tx.libraryAsset.update({
    where: { id: entry.assetId },
    data: {
      path: nodePath.join(roots.control, "quarantine", entry.assetId),
      state: "rejected",
      version: { increment: 1 },
    },
  });
  await tx.mediaItem.updateMany({
    where: { id: { in: entry.mediaIds } },
    data: { availability: "wanted", version: { increment: 1 } },
  });
}
