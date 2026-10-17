import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveCompletionSchema,
  NativeArchiveTerminalDependencySchema,
} from "#shared/native-recovery/archive.ts";
import { UpgradeCleanupPlanSchema } from "#shared/native-recovery/archive-plan.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { archiveClosure } from "./closure.ts";
import { archiveCompletionDependency } from "./completion.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function archiveTerminalDependency(
  tx: Prisma.TransactionClient,
  cleanup: Prisma.UpgradeCleanupGetPayload<object>,
  assets: Awaited<ReturnType<typeof archiveClosure>>["assets"],
  budget?: PublicationAuthorityReadBudget,
) {
  const old = assets.find((row) => row.id === cleanup.assetId);
  const successor = assets.find((row) => row.id === cleanup.successorAssetId);
  if (
    old === undefined ||
    successor === undefined ||
    old.state !== "purged" ||
    old.coverage.some((row) => row.current) ||
    old.supersededByAssetId !== successor.id ||
    successor.plexPublishedAt === null ||
    cleanup.expiresAt.getTime() !==
      successor.plexPublishedAt.getTime() + 7 * 86_400_000
  )
    throw new Error("Archive terminal relationship changed");
  const completed = await tx.nativeArchiveCleanupContinuation.findMany({
    where: { originalCleanupId: cleanup.id, state: "cleaned" },
    include: { receipt: { include: { plan: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(101, Math.floor((budget?.take ?? 202) / 2) + 1),
  });
  budget?.consume(completed.length * 2);
  if (completed.length > 100)
    throw new Error("Archive terminal receipt lookup exceeds bound");
  const matches = completed.filter(
    (row) =>
      NativeArchiveCompletionSchema.parse(row.completion).asset.assetVersion ===
      old.version,
  );
  if (matches.length > 1)
    throw new Error("Archive terminal receipt is ambiguous");
  const row = matches[0];
  return row === undefined
    ? legacyTerminalDependency(cleanup, old, successor)
    : archiveCompletionDependency(row, cleanup, old, successor);
}
function legacyTerminalDependency(
  cleanup: Prisma.UpgradeCleanupGetPayload<object>,
  old: Awaited<ReturnType<typeof archiveClosure>>["assets"][number],
  successor: Awaited<ReturnType<typeof archiveClosure>>["assets"][number],
) {
  const manifest = UpgradeCleanupPlanSchema.parse(cleanup.manifest);
  if (
    cleanup.state !== "purged" ||
    old.version !== manifest.assetVersion + 1 ||
    old.ownershipEpoch !== cleanup.recoveryEpoch ||
    successor.checksum !== manifest.successorChecksum ||
    snapshotHash([...manifest.mediaIds].sort()) !==
      snapshotHash(old.coverage.map((item) => item.mediaId).sort())
  )
    throw new Error("Absent archive lacks exact original terminal cleanup");
  for (const file of manifest.files) {
    if (
      file.path !==
      `/data/${manifest.libraryKind}/.media-control/${file.location}/${file.id}`
    )
      throw new Error("Terminal archive path changed");
    if (file.subtitleId === null) {
      if (file.path !== old.path || file.checksum !== old.checksum)
        throw new Error("Terminal archive video changed");
    } else {
      const subtitle = old.subtitles.find(
        (item) => item.id === file.subtitleId,
      );
      if (
        subtitle?.state !== "purged" ||
        subtitle.path !== file.path ||
        subtitle.checksum !== file.checksum ||
        subtitle.videoVersion !== old.version ||
        subtitle.ownershipEpoch !== old.ownershipEpoch
      )
        throw new Error("Terminal archive subtitle changed");
    }
  }
  return NativeArchiveTerminalDependencySchema.parse({
    kind: "legacy_cleanup",
    dependency: {
      cleanupId: cleanup.id,
      kind: "purged",
      birthEpoch: cleanup.recoveryEpoch,
      assetIds: [old.id, successor.id],
      rowDigest: snapshotHash(
        nativeJson({
          cleanup,
          old: { ...old, sizeBytes: old.sizeBytes.toString() },
        }),
      ),
      files: manifest.files.map((file) => ({
        canonicalPath: file.path,
        expectedChecksum: null,
      })),
      journals: manifest.files.map((file) => ({
        operationId: `upgrade-purge-${cleanup.id}-${file.id}`,
        kind: "purge",
        source: file.path,
        target: file.path,
        sha256: file.checksum,
        previousSha256: null,
      })),
    },
  });
}
