import { NativeArchiveScopeProtection } from "./errors.ts";
import type { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveScopeSchema,
  type NativeArchiveFile,
  type NativeArchiveEdge,
  type PrepareNativeArchiveSchema,
} from "#shared/native-recovery/archive.ts";
import { assertNativeRestore } from "#infrastructure/native-recovery/scope.ts";
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { snapshotNativeSubtitlePolicies } from "#automation/native-subtitles/policies.ts";
import {
  nativeHousehold,
  nativeLifecycle,
} from "#infrastructure/native-recovery/snapshots.ts";
import { resolveNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { archiveClosure, archiveEdge } from "./closure.ts";
import { archiveMedia, archiveTorrents } from "./snapshots.ts";
import { snapshotArchiveFile } from "./file-snapshot.ts";
import { archiveTerminalDependency } from "./terminal.ts";
import { assertArchiveOrigin } from "./origin.ts";
import { deriveArchiveSupersessions } from "./supersession.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { archiveCompensationSettlements } from "./compensation-settlement.ts";

export async function buildNativeArchiveScope(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof PrepareNativeArchiveSchema>,
) {
  const budget = new PublicationAuthorityReadBudget();
  await assertNativeRestore(tx, { ...input, assetIds: [] });
  const closure = await archiveClosure(tx, input.cleanupIds);
  const assetIds = closure.assets.map((row) => row.id);
  await assertNoSubtitleReplacement(tx, assetIds);
  const ids = [
    ...new Set(
      closure.assets.flatMap((asset) =>
        asset.coverage.map((row) => row.mediaId),
      ),
    ),
  ].sort();
  if (ids.length === 0 || ids.length > 100)
    throw new NativeArchiveScopeProtection(
      "Archive coverage exceeds supported complete leaf bound",
    );
  const media = await archiveMedia(tx, ids);
  const current = await currentServingClosure(tx, closure, ids);
  const files = [];
  const terminalDependencies = [];
  const edges = [];
  for (const asset of closure.assets) {
    await assertDefaultPhysicalAsset(tx, asset.id);
    if (
      !asset.owned ||
      asset.checksum === null ||
      asset.ownershipEpoch < 0 ||
      asset.ownershipEpoch > input.recoveryEpoch ||
      asset.coverage.length === 0
    )
      throw new NativeArchiveScopeProtection("Archive ownership is unproven");
    if (asset.state === "purged") {
      const pair = closure.cleanups.find((row) => row.assetId === asset.id);
      if (pair === undefined)
        throw new NativeArchiveScopeProtection(
          "Absent archive lacks terminal cleanup",
        );
      terminalDependencies.push(
        await archiveTerminalDependency(tx, pair, closure.assets, budget),
      );
      continue;
    }
    const file = await snapshotArchiveFile(
      tx,
      asset,
      {
        cleanups: closure.cleanups,
        cleanupIds: input.cleanupIds,
        epoch: input.recoveryEpoch,
      },
      budget,
    );
    files.push(file);
  }
  for (const cleanup of closure.cleanups) {
    const asset = closure.assets.find((row) => row.id === cleanup.assetId);
    if (asset?.state !== "purged")
      edges.push(
        await archiveEdge(
          tx,
          cleanup,
          closure.assets,
          input.cleanupIds.includes(cleanup.id),
        ),
      );
  }
  if (edges.filter((edge) => edge.selected).length !== input.cleanupIds.length)
    throw new NativeArchiveScopeProtection(
      "Selected archive cleanup already completed",
    );
  await assertOriginalFiles(tx, files, edges, budget);
  const supersessions = await deriveArchiveSupersessions(
    tx,
    { request: input, files },
    budget,
  );
  const ancestors = media.flatMap((row) =>
    [row.parent?.id, row.parent?.parent?.id].filter((id) => id !== undefined),
  );
  return NativeArchiveScopeSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "superseded_archive",
    request: { ...input, cleanupIds: [...input.cleanupIds].sort() },
    media,
    files,
    edges,
    terminalDependencies,
    currentPlayback: current.map((asset) => ({
      assetId: asset.id,
      mediaIds: asset.coverage.map((row) => row.mediaId),
    })),
    ...(supersessions.length === 0 ? {} : { supersessions }),
    storageRoots: await resolveNativeStorageRoots(tx, budget),
    subtitlePolicies: await snapshotNativeSubtitlePolicies(tx, ids),
    household: await nativeHousehold(tx, ids, ancestors),
    lifecycle: await nativeLifecycle(tx, ids, assetIds, {
      attemptIds: await archiveCompensationSettlements(tx, files, budget),
    }),
    torrents: await archiveTorrents(tx, assetIds),
  });
}

async function assertOriginalFiles(
  tx: Prisma.TransactionClient,
  files: NativeArchiveFile[],
  edges: NativeArchiveEdge[],
  budget: PublicationAuthorityReadBudget,
) {
  for (const edge of edges) {
    const file = files.find((item) => item.assetId === edge.assetId);
    if (file === undefined) throw new Error("Archive original file missing");
    await assertArchiveOrigin(tx, file, edge, budget);
  }
}

async function currentServingClosure(
  tx: Prisma.TransactionClient,
  closure: Awaited<ReturnType<typeof archiveClosure>>,
  ids: string[],
) {
  const current = closure.assets.filter((asset) => asset.state === "published");
  const currentIds = current.map((asset) => asset.id);
  if (
    current.length === 0 ||
    (await tx.assetCoverage.count({
      where: {
        edition: "default",
        mediaId: { in: ids },
        current: true,
        assetId: { notIn: currentIds },
      },
    }))
  )
    throw new NativeArchiveScopeProtection(
      "Archive closure omits current serving physical coverage",
    );
  for (const id of ids)
    if (
      current.filter((asset) =>
        asset.coverage.some((row) => row.mediaId === id && row.current),
      ).length !== 1
    )
      throw new NativeArchiveScopeProtection(
        "Archive requires one current serving asset per covered leaf",
      );
  return current;
}
