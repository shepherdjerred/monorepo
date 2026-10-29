import { storedFilePath } from "./paths/locations.ts";
import {
  FileGuardError,
  type FileContext,
  type FilePlanEntry,
  type Transaction,
} from "./types.ts";
import { assertRuntime, assertNoMediaSubtitleReplacement } from "./guards.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { fileOperations } from "./file-operations.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";

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
    await assertPublicationUnfenced(tx, entry.mediaIds, [entry.assetId]);
    await assertNoMediaSubtitleReplacement(tx, entry.mediaIds);
    const intents = await tx.mediaIntent.findMany({
      where: { mediaId: { in: entry.mediaIds }, edition: "default" },
    });
    if (
      intents.length !== entry.mediaIds.length ||
      intents.some(
        (intent) =>
          !intent.desiredPresence ||
          intent.automationEpoch !== recoveryEpoch ||
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
      asset.ownershipEpoch !== recoveryEpoch ||
      asset.checksum !== entry.checksum ||
      asset.state !== "published" ||
      asset.path !==
        storedFilePath(
          context,
          entry.libraryKind,
          "library",
          entry.libraryPath,
        ) ||
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
      path: storedFilePath(
        context,
        entry.libraryKind,
        "control",
        `quarantine/${entry.assetId}`,
      ),
      state: "rejected",
      version: { increment: 1 },
    },
  });
  await tx.mediaItem.updateMany({
    where: { id: { in: entry.mediaIds } },
    data: { availability: "wanted", version: { increment: 1 } },
  });
  await mirrorDefaultAvailability(tx, entry.mediaIds, "wanted");
}
