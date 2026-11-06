import path from "node:path";
import type {
  FileContext,
  FilePlanEntry,
  Transaction,
} from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  workerFilePath,
  storedFilePath,
} from "#automation/files/paths/locations.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type {
  PublicationEntryIntent,
  PublicationAssetSnapshot,
} from "#shared/publication-proof/intent.ts";
import { assertSeriesPackLibraryPredecessorV1 } from "#infrastructure/acquisition-identity/series-pack/publication/rollback-origin.ts";
import type { SubtitleAsset } from "#generated/prisma/client.ts";
import type { PublicationOutcome } from "#shared/publication-proof/outcome.ts";

/** A bounded live CAS preflight under the already held whole-publication locks.
 * These scalar mutable versions are not historical grants or snapshot inputs. */
export async function assertSeriesPackRollbackVersionsV1(
  tx: Transaction,
  published: Pick<PublicationOutcome, "entries">,
) {
  const snapshots = published.entries.flatMap((row) =>
    [row.predecessor, row.successor].filter((asset) => asset !== null),
  );
  const expected = new Map(snapshots.map((asset) => [asset.id, asset.version]));
  if (
    expected.size !== snapshots.length ||
    expected.size > published.entries.length * 2
  )
    throw new FileGuardError("rollback_asset_changed");
  const current = await tx.libraryAsset.findMany({
    where: { id: { in: [...expected.keys()] } },
    select: { id: true, version: true },
    take: published.entries.length * 2 + 1,
  });
  if (
    current.length !== expected.size ||
    current.some((asset) => expected.get(asset.id) !== asset.version)
  )
    throw new FileGuardError("rollback_asset_changed");
}

/** Only held, paid immutable predecessors can choose stored after-image paths.
 * Native effects still use the original plan's exact physical destinations. */
export async function captureSeriesPackRollbackPathsV1(
  tx: Transaction,
  context: FileContext,
  input: {
    entries: readonly PublicationEntryIntent[];
    origins: ReadonlyMap<string, PublicationAssetSnapshot> | null;
    published: Pick<PublicationOutcome, "entries">;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { entries, origins } = input;
  const paths = new Map<
    string,
    {
      video: string;
      sidecars: ReadonlyMap<string, string>;
      previousVersion: number;
      successorVersion: number;
    }
  >();
  for (const { entry, predecessor, originalGrant } of entries) {
    if (entry.previousAssetId === null) continue;
    if (predecessor === null)
      throw new FileGuardError("rollback_asset_changed");
    const original = origins?.get(predecessor.id);
    if (originalGrant === null && original === undefined)
      throw new FileGuardError("rollback_asset_changed");
    if (original !== undefined)
      assertSeriesPackLibraryPredecessorV1(original, predecessor);
    const physical = (relative: string) =>
      path.join(context.roots[entry.libraryKind].library, relative);
    if (
      predecessor.id !== entry.previousAssetId ||
      predecessor.version !== entry.previousVersion ||
      predecessor.checksum !== entry.previousChecksum ||
      workerFilePath(context, predecessor.path) !== physical(entry.libraryPath)
    )
      throw new FileGuardError("rollback_asset_changed");
    const sidecars = await captureSidecarPaths(
      tx,
      context,
      { entry, predecessor },
      budget,
    );
    const versions = publishedVersions(input.published, { entry, predecessor });
    paths.set(entry.operationId, {
      video: predecessor.path,
      sidecars,
      ...versions,
    });
  }
  return (entry: FilePlanEntry) => {
    const captured = paths.get(entry.operationId);
    if (captured === undefined)
      throw new FileGuardError("rollback_asset_changed");
    return captured;
  };
}

function publishedVersions(
  published: Pick<PublicationOutcome, "entries">,
  input: { entry: FilePlanEntry; predecessor: PublicationAssetSnapshot },
) {
  const { entry, predecessor } = input;
  const recorded = published.entries.find(
    (row) => row.entryOperationId === entry.operationId,
  );
  if (
    recorded?.predecessor?.id !== predecessor.id ||
    recorded.predecessor.version !== predecessor.version + 1 ||
    recorded.successor?.id !== entry.assetId ||
    recorded.successor.checksum !== entry.checksum
  )
    throw new FileGuardError("rollback_asset_changed");
  return {
    previousVersion: recorded.predecessor.version,
    successorVersion: recorded.successor.version,
  };
}

async function captureSidecarPaths(
  tx: Transaction,
  context: FileContext,
  input: { entry: FilePlanEntry; predecessor: PublicationAssetSnapshot },
  budget: PublicationAuthorityReadBudget,
) {
  const { entry, predecessor } = input;
  const sidecars = new Map<string, string>();
  const currentSidecars = await tx.subtitleAsset.findMany({
    where: {
      id: { in: entry.previousSidecars.map((row) => row.subtitleId) },
    },
    take: budget.take,
  });
  budget.consume(currentSidecars.length);
  if (currentSidecars.length !== entry.previousSidecars.length)
    throw new FileGuardError("subtitle_manifest_changed");
  for (const sidecar of entry.previousSidecars) {
    const captured = predecessor.subtitles.find(
      (row) => row.id === sidecar.subtitleId,
    );
    const current = currentSidecars.find(
      (row) => row.id === sidecar.subtitleId,
    );
    if (captured?.state !== "installed" || captured.path === null)
      throw new FileGuardError("subtitle_manifest_changed");
    assertSidecarAfterImage({ current, captured, predecessor });
    if (
      captured.checksum !== sidecar.checksum ||
      captured.assetId !== predecessor.id ||
      current?.path !==
        storedFilePath(
          context,
          entry.libraryKind,
          "control",
          `quarantine/${sidecar.quarantineId}`,
        ) ||
      workerFilePath(context, captured.path) !==
        path.join(context.roots[entry.libraryKind].library, sidecar.libraryPath)
    )
      throw new FileGuardError("subtitle_manifest_changed");
    sidecars.set(captured.id, captured.path);
  }
  return sidecars;
}

function assertSidecarAfterImage(input: {
  current: SubtitleAsset | undefined;
  captured: PublicationAssetSnapshot["subtitles"][number];
  predecessor: PublicationAssetSnapshot;
}) {
  const { current, captured, predecessor } = input;
  if (
    current?.state !== "superseded" ||
    current.version !== captured.version + 1 ||
    current.checksum !== captured.checksum ||
    current.assetId !== captured.assetId ||
    current.videoChecksum !== predecessor.checksum ||
    current.videoVersion !== predecessor.version + 1 ||
    current.ownershipEpoch !== captured.ownershipEpoch
  )
    throw new FileGuardError("subtitle_manifest_changed");
}
