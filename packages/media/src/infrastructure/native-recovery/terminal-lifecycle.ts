import path from "node:path";
import { z } from "zod";
import type { Prisma, UpgradeCleanup } from "#generated/prisma/client.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { UpgradeCleanupPlanSchema } from "#automation/files/upgrade-cleanup-plan.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { nativeSubtitleSnapshot } from "#automation/native-subtitles/snapshot.ts";
import { nativeJson } from "./snapshots.ts";
import { terminalRebindingChain } from "./terminal-rebinding.ts";
import { terminalSubtitleChain } from "./terminal-subtitles.ts";
import {
  NativeTerminalDependencySchema,
  type NativeTerminalDescriptor,
} from "#shared/native-recovery/terminal.ts";

type Asset = Prisma.LibraryAssetGetPayload<{
  include: { coverage: true; subtitles: true };
}>;
type Journal = NativeTerminalDescriptor["journals"][number];
type Files = NativeTerminalDescriptor["files"];
const Receipt = z.object({
  rollbackReceipt: z.object({
    recoveryEpoch: z.int(),
    mediaIds: z.array(z.uuid()),
    assets: z.array(
      z.object({
        assetId: z.uuid(),
        assetVersion: z.int(),
        checksum: z.string(),
      }),
    ),
  }),
});

/** Terminal names alone never prove that a historical filesystem effect settled. */
export async function nativeTerminalDependencies(
  tx: Prisma.TransactionClient,
  cleanups: UpgradeCleanup[],
  selectedIds: string[],
) {
  const result: NativeTerminalDescriptor[] = [];
  for (const cleanup of cleanups) {
    const old = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: cleanup.assetId },
      include: {
        coverage: { orderBy: { mediaId: "asc" } },
        subtitles: { where: videoSubtitleWhere, orderBy: { id: "asc" } },
      },
    });
    const successor = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: cleanup.successorAssetId },
      include: {
        coverage: { orderBy: { mediaId: "asc" } },
        subtitles: { where: videoSubtitleWhere, orderBy: { id: "asc" } },
      },
    });
    if (
      !old.owned ||
      !successor.owned ||
      old.checksum === null ||
      successor.checksum === null ||
      old.ownershipEpoch < 0 ||
      successor.ownershipEpoch < 0
    )
      throw new Error("Native terminal cleanup ownership is unproven");
    const detail =
      cleanup.state === "purged"
        ? purged(cleanup, old, successor, selectedIds)
        : await cancelled(tx, {
            cleanup,
            old,
            successor,
            selected: selectedIds,
          });
    const rowDigest = snapshotHash(
      nativeJson({
        cleanup,
        old: assetSnapshot(old),
        successor: assetSnapshot(successor),
        attempt: detail.attempt,
      }),
    );
    result.push(
      NativeTerminalDependencySchema.parse({
        cleanupId: cleanup.id,
        kind: detail.kind,
        birthEpoch: cleanup.recoveryEpoch,
        assetIds: [old.id, successor.id],
        rowDigest,
        files: detail.files,
        journals: detail.journals,
      }),
    );
  }
  return result;
}

function assetSnapshot(asset: Asset) {
  return {
    ...asset,
    sizeBytes: asset.sizeBytes.toString(),
    subtitles: asset.subtitles.map((subtitle) =>
      nativeSubtitleSnapshot(subtitle),
    ),
  };
}

function purged(
  cleanup: UpgradeCleanup,
  old: Asset,
  successor: Asset,
  selected: string[],
) {
  const plan = UpgradeCleanupPlanSchema.parse(cleanup.manifest);
  const video = plan.files.filter((file) => file.subtitleId === null);
  if (
    cleanup.state !== "purged" ||
    old.state !== "purged" ||
    old.version !== plan.assetVersion + 1 ||
    old.coverage.some((row) => row.current) ||
    !selected.includes(successor.id) ||
    successor.state !== "published" ||
    old.supersededByAssetId !== successor.id ||
    successor.checksum !== plan.successorChecksum
  )
    throw new Error("Native purged cleanup graph is inconsistent");
  if (
    video.length !== 1 ||
    video[0]?.path !== old.path ||
    video[0].checksum !== old.checksum ||
    successor.plexPublishedAt === null ||
    cleanup.expiresAt.getTime() !==
      successor.plexPublishedAt.getTime() + 7 * 86_400_000
  )
    throw new Error("Native purged cleanup graph is inconsistent");
  sameIds(
    old.coverage.map((row) => row.mediaId),
    plan.mediaIds,
  );
  sameIds(
    successor.coverage.filter((row) => row.current).map((row) => row.mediaId),
    plan.mediaIds,
  );
  const sidecars = old.subtitles.filter(
    (row) => row.storageKind === "sidecar" && row.path !== null,
  );
  sameIds(
    sidecars.map((row) => row.id),
    plan.files.flatMap((file) =>
      file.subtitleId === null ? [] : [file.subtitleId],
    ),
  );
  const files: Files = [];
  const journals: Journal[] = [];
  for (const file of plan.files) {
    const expected = controlPath(plan.libraryKind, file.location, file.id);
    if (file.path !== expected)
      throw new Error("Native cleanup archive path is not canonical");
    if (file.subtitleId !== null) validatePurgedSubtitle(old, file);
    files.push({ canonicalPath: expected, expectedChecksum: null });
    journals.push({
      operationId: `upgrade-purge-${cleanup.id}-${file.id}`,
      kind: "purge",
      source: expected,
      target: expected,
      sha256: file.checksum,
      previousSha256: null,
    });
  }
  return { kind: "purged" as const, files, journals, attempt: null };
}

function validatePurgedSubtitle(
  old: Asset,
  file: z.infer<typeof UpgradeCleanupPlanSchema>["files"][number],
) {
  const subtitle = old.subtitles.find((row) => row.id === file.subtitleId);
  if (
    subtitle?.state !== "purged" ||
    subtitle.path !== file.path ||
    subtitle.checksum !== file.checksum ||
    subtitle.videoChecksum !== old.checksum ||
    subtitle.videoVersion !== old.version ||
    subtitle.ownershipEpoch !== old.ownershipEpoch
  )
    throw new Error("Native purged subtitle binding changed");
}

async function cancelled(
  tx: Prisma.TransactionClient,
  {
    cleanup,
    old,
    successor,
    selected,
  }: {
    cleanup: UpgradeCleanup;
    old: Asset;
    successor: Asset;
    selected: string[];
  },
) {
  if (
    cleanup.state !== "cancelled" ||
    old.state !== "published" ||
    !selected.includes(old.id) ||
    old.supersededByAssetId !== null ||
    old.rollbackExpiresAt !== null ||
    successor.state !== "rejected" ||
    successor.coverage.some((row) => row.current)
  )
    throw new Error("Native cancelled cleanup graph is inconsistent");
  const attempts = await tx.acquisitionAttempt.findMany({
    where: {
      state: "rolled_back",
      recoveryEpoch: cleanup.recoveryEpoch,
      filePlan: {
        array_contains: [{ assetId: successor.id, previousAssetId: old.id }],
      },
    },
    take: 2,
  });
  const attempt = attempts[0];
  if (attempt === undefined || attempts.length !== 1)
    throw new Error("Native cancelled cleanup has no exact rollback attempt");
  const entries = FilePlanSchema.parse(attempt.filePlan).filter(
    (row) => row.assetId === successor.id && row.previousAssetId === old.id,
  );
  const entry = entries[0];
  if (entry === undefined || entries.length !== 1)
    throw new Error("Native rollback publication binding changed");
  if (entry.previousVersion === null)
    throw new Error("Native rollback previous version missing");
  if (
    entry.previousChecksum !== old.checksum ||
    entry.checksum !== successor.checksum ||
    old.path !== path.join(`/data/${entry.libraryKind}`, entry.libraryPath)
  )
    throw new Error("Native rollback publication binding changed");
  sameIds(
    old.coverage.filter((row) => row.current).map((row) => row.mediaId),
    entry.mediaIds,
  );
  verifyRollbackReceipt({ attempt, old, entry });
  const nativeReceipts = await terminalRebindingChain(tx, {
    asset: old,
    originalVersion: entry.previousVersion + 2,
    originalEpoch: cleanup.recoveryEpoch,
  });
  if (
    await tx.acquisitionReservation.count({ where: { attemptId: attempt.id } })
  )
    throw new Error("Native rollback still has active reservations");
  const paths = await cancelledPaths(tx, {
    old,
    successor,
    entry,
    attempt,
    videoBindings: [
      { version: entry.previousVersion + 2, epoch: cleanup.recoveryEpoch },
      ...nativeReceipts.map((receipt) => ({
        version: receipt.binding.assetVersion,
        epoch: receipt.binding.ownershipEpoch,
      })),
    ],
    subtitleRenewals: nativeReceipts.map((receipt) => ({
      bindings: receipt.binding.subtitles,
      snapshots: receipt.subtitleSnapshots,
    })),
  });
  return { ...paths, attempt: { ...paths.attempt, nativeReceipts } };
}

function verifyRollbackReceipt({
  attempt,
  old,
  entry,
}: {
  attempt: Prisma.AcquisitionAttemptGetPayload<Record<string, never>>;
  old: Asset;
  entry: z.infer<typeof FilePlanSchema>[number];
}) {
  const receipt = Receipt.parse(attempt.failure).rollbackReceipt;
  if (
    receipt.recoveryEpoch !== attempt.recoveryEpoch ||
    !receipt.assets.some(
      (row) =>
        row.assetId === old.id &&
        entry.previousVersion !== null &&
        row.assetVersion === entry.previousVersion + 2 &&
        row.checksum === old.checksum,
    ) ||
    entry.mediaIds.some((id) => !receipt.mediaIds.includes(id))
  )
    throw new Error("Native rollback receipt changed");
}

async function cancelledPaths(
  tx: Prisma.TransactionClient,
  {
    old,
    successor,
    entry,
    attempt,
    videoBindings,
    subtitleRenewals,
  }: {
    old: Asset;
    successor: Asset;
    entry: z.infer<typeof FilePlanSchema>[number];
    attempt: Prisma.AcquisitionAttemptGetPayload<Record<string, never>>;
    videoBindings: { version: number; epoch: number }[];
    subtitleRenewals: NonNullable<
      Parameters<typeof terminalSubtitleChain>[1]["subtitleRenewals"]
    >;
  },
) {
  const rollbackId = path.basename(successor.path);
  if (successor.path !== controlPath(entry.libraryKind, "rollback", rollbackId))
    throw new Error("Native rejected rollback path changed");
  const prefix = rollbackId.slice(0, -`-rollback-${successor.id}`.length);
  if (
    rollbackId !== `${prefix}-rollback-${successor.id}` ||
    prefix.length === 0
  )
    throw new Error("Native rollback operation identity changed");
  const backup = controlPath(entry.libraryKind, "rollback", entry.operationId);
  const files: Files = [
    { canonicalPath: backup, expectedChecksum: old.checksum },
    { canonicalPath: successor.path, expectedChecksum: successor.checksum },
    {
      canonicalPath: controlPath(entry.libraryKind, "staging", rollbackId),
      expectedChecksum: null,
    },
  ];
  const journals: Journal[] = [
    {
      operationId: entry.operationId,
      kind: "import",
      source: z.string().parse(successor.sourcePath),
      target: old.path,
      sha256: entry.checksum,
      previousSha256: entry.previousChecksum,
    },
    {
      operationId: rollbackId,
      kind: "rollback",
      source: backup,
      target: old.path,
      sha256: z.string().parse(old.checksum),
      previousSha256: entry.checksum,
    },
  ];
  const replacementHistory = [];
  for (const sidecar of entry.previousSidecars) {
    const canonicalPath = path.join(
      `/data/${entry.libraryKind}`,
      sidecar.libraryPath,
    );
    const replacement = await terminalSubtitleChain(tx, {
      subtitleId: sidecar.subtitleId,
      checksum: sidecar.checksum,
      canonicalPath,
      libraryKind: entry.libraryKind,
      asset: old,
      videoBindings,
      subtitleRenewals,
    });
    files.push(...replacement.files);
    journals.push(...replacement.journals);
    replacementHistory.push(...replacement.history);
    const source = controlPath(
      entry.libraryKind,
      "quarantine",
      sidecar.quarantineId,
    );
    files.push({ canonicalPath: source, expectedChecksum: null });
    journals.push({
      operationId: `${prefix}-rollback-sidecar-${sidecar.quarantineId}`,
      kind: "restore",
      source,
      target: canonicalPath,
      sha256: sidecar.checksum,
      previousSha256: null,
    });
  }
  return {
    kind: "rollback_cancelled" as const,
    files,
    journals,
    attempt: {
      id: attempt.id,
      state: attempt.state,
      recoveryEpoch: attempt.recoveryEpoch,
      filePlan: attempt.filePlan,
      failure: attempt.failure,
      operationId: attempt.operationId,
      ...(replacementHistory.length === 0 ? {} : { replacementHistory }),
    },
  };
}

function sameIds(actual: string[], expected: string[]) {
  if (
    new Set(actual).size !== actual.length ||
    new Set(expected).size !== expected.length ||
    actual.length !== expected.length ||
    actual.some((id) => !expected.includes(id))
  )
    throw new Error("Native terminal coverage changed");
}
function controlPath(kind: string, location: string, id: string) {
  if (!/^[\w-]{1,100}$/u.test(id))
    throw new Error("Native terminal control identity is invalid");
  return `/data/${kind}/.media-control/${location}/${id}`;
}
