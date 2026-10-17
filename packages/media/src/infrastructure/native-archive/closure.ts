import { NativeArchiveScopeProtection } from "./errors.ts";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { deriveUpgradeCleanupPlan } from "#automation/files/upgrade-cleanup-plan.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { NativeArchiveEdgeSchema } from "#shared/native-recovery/archive.ts";
import { UpgradeCleanupPlanSchema } from "#shared/native-recovery/archive-plan.ts";
import { snapshotHash } from "#migration/profile-import.ts";

export async function archiveClosure(
  tx: Prisma.TransactionClient,
  cleanupIds: string[],
) {
  const selected = await tx.upgradeCleanup.findMany({
    where: { id: { in: cleanupIds } },
    orderBy: { id: "asc" },
  });
  if (
    selected.length !== cleanupIds.length ||
    selected.some((row) => row.state !== "pending")
  )
    throw new NativeArchiveScopeProtection(
      "Select pending committed archive cleanup pairs",
    );
  const assets = new Map<string, Awaited<ReturnType<typeof loadAsset>>>();
  const cleanups = new Map(selected.map((row) => [row.id, row]));
  for (const start of selected)
    await followSuccessors(tx, start.assetId, assets, cleanups);
  return {
    assets: [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)),
    cleanups: [...cleanups.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
async function followSuccessors(
  tx: Prisma.TransactionClient,
  startId: string,
  assets: Map<string, Awaited<ReturnType<typeof loadAsset>>>,
  cleanups: Map<string, Prisma.UpgradeCleanupGetPayload<object>>,
) {
  const seen = new Set<string>();
  let id = startId;
  for (;;) {
    if (seen.has(id))
      throw new NativeArchiveScopeProtection(
        "Archive successor closure contains a cycle",
      );
    seen.add(id);
    const asset = assets.get(id) ?? (await loadAsset(tx, id));
    assets.set(id, asset);
    if (assets.size > 25)
      throw new NativeArchiveScopeProtection(
        "Archive closure exceeds 25 physical participants",
      );
    if (asset.state === "published" && asset.supersededByAssetId !== null)
      throw new NativeArchiveScopeProtection(
        "Current archive dependency has a successor",
      );
    if (asset.state === "published") break;
    if (
      !["superseded", "purged"].includes(asset.state) ||
      asset.supersededByAssetId === null
    )
      throw new NativeArchiveScopeProtection(
        "Archive successor requires separate reconciliation",
      );
    const pairs = await tx.upgradeCleanup.findMany({
      where: {
        assetId: asset.id,
        successorAssetId: asset.supersededByAssetId,
      },
      take: 2,
    });
    const pair = pairs[0];
    if (
      pair === undefined ||
      pairs.length !== 1 ||
      !["pending", "purged"].includes(pair.state)
    )
      throw new NativeArchiveScopeProtection(
        "Archive successor lacks an exact cleanup pair",
      );
    cleanups.set(pair.id, pair);
    id = asset.supersededByAssetId;
  }
}
function loadAsset(tx: Prisma.TransactionClient, id: string) {
  return tx.libraryAsset.findUniqueOrThrow({
    where: { id },
    include: {
      coverage: { orderBy: { mediaId: "asc" }, include: { media: true } },
      subtitles: { where: videoSubtitleWhere, orderBy: { id: "asc" } },
    },
  });
}

export async function archiveEdge(
  tx: Prisma.TransactionClient,
  cleanup: Prisma.UpgradeCleanupGetPayload<object>,
  assets: Awaited<ReturnType<typeof archiveClosure>>["assets"],
  selected: boolean,
) {
  const asset = assets.find((row) => row.id === cleanup.assetId);
  const successor = assets.find((row) => row.id === cleanup.successorAssetId);
  if (
    asset === undefined ||
    successor === undefined ||
    asset.state !== "superseded" ||
    successor.plexPublishedAt === null ||
    cleanup.expiresAt.getTime() !==
      successor.plexPublishedAt.getTime() + 7 * 86_400_000
  )
    throw new NativeArchiveScopeProtection(
      "Archive deadline or adjacent publication is unproven",
    );
  const attempts = await tx.acquisitionAttempt.findMany({
    where: {
      state: "completed",
      recoveryEpoch: cleanup.recoveryEpoch,
      filePlan: {
        array_contains: [{ assetId: successor.id, previousAssetId: asset.id }],
      },
    },
    take: 2,
  });
  const attempt = attempts[0];
  if (attempt === undefined || attempts.length !== 1)
    throw new NativeArchiveScopeProtection(
      "Archive requires unique completed adjacent publication",
    );
  const entries = FilePlanSchema.parse(attempt.filePlan).filter(
    (item) =>
      item.assetId === successor.id && item.previousAssetId === asset.id,
  );
  const entry = entries[0];
  if (
    entry === undefined ||
    entries.length !== 1 ||
    entry.previousVersion === null ||
    entry.previousChecksum !== asset.checksum ||
    entry.checksum !== successor.checksum ||
    snapshotHash([...entry.mediaIds].sort()) !==
      snapshotHash(asset.coverage.map((row) => row.mediaId).sort())
  )
    throw new NativeArchiveScopeProtection(
      "Archive publication coverage or checksum changed",
    );
  const controlRoot = `/data/${entry.libraryKind}/.media-control`;
  if (asset.path !== `${controlRoot}/rollback/${entry.operationId}`)
    throw new NativeArchiveScopeProtection(
      "Archive path does not match original import",
    );
  const derived = deriveUpgradeCleanupPlan({ asset, successor, controlRoot });
  const original = { ...derived, assetVersion: entry.previousVersion + 1 };
  const manifest =
    cleanup.manifest === null
      ? null
      : UpgradeCleanupPlanSchema.parse(cleanup.manifest);
  if (manifest !== null && snapshotHash(manifest) !== snapshotHash(original))
    throw new NativeArchiveScopeProtection(
      "Archive historical manifest changed",
    );
  return NativeArchiveEdgeSchema.parse({
    id: cleanup.id,
    assetId: asset.id,
    successorAssetId: successor.id,
    recoveryEpoch: cleanup.recoveryEpoch,
    expiresAt: cleanup.expiresAt.toISOString(),
    state: cleanup.state,
    version: cleanup.version,
    createdAt: cleanup.createdAt.toISOString(),
    updatedAt: cleanup.updatedAt.toISOString(),
    manifest,
    manifestHash:
      cleanup.manifest === null
        ? null
        : snapshotHash(z.json().parse(cleanup.manifest)),
    derivedPlan: original,
    selected,
    publicationAttempt: {
      id: attempt.id,
      operationId: attempt.operationId,
      recoveryEpoch: attempt.recoveryEpoch,
      state: attempt.state,
      filePlanHash: snapshotHash(z.json().parse(attempt.filePlan)),
      entry,
    },
    successorPublishedAt: successor.plexPublishedAt.toISOString(),
  });
}
