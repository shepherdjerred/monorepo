import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveCleanupNetworkEvidenceSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import {
  assertNativeArchiveCleanup,
  NativeArchiveProtection,
} from "#infrastructure/native-archive/continuation.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { assertArchiveActive, type ArchiveFileContext } from "./execution.ts";
import { archiveCleanupDeadline } from "./cleanup/deadline.ts";

export async function archiveCleanupAuthority(
  tx: Prisma.TransactionClient,
  context: ArchiveFileContext,
  input: CleanupNativeArchiveInput,
) {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  assertArchiveActive(context.execution);
  const current = await assertNativeArchiveCleanup(tx, input);
  assertArchiveActive(context.execution);
  if (!(await context.files.enabled.purge()))
    throw new NativeArchiveProtection("archive_purge_disabled");
  const observation = await tx.nativeRecoveryObservation.findFirstOrThrow({
    where: {
      planId: current.row.receipt.planId,
      kind: "archive_cleanup_network",
      AND: [
        {
          evidence: { path: ["continuationId"], equals: input.continuationId },
        },
        { evidence: { path: ["operationId"], equals: input.operationId } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  const network = NativeArchiveCleanupNetworkEvidenceSchema.parse(
    observation.evidence,
  );
  if (
    network.continuationId !== input.continuationId ||
    network.operationId !== input.operationId ||
    network.recoveryEpoch !== input.recoveryEpoch ||
    network.planId !== current.row.receipt.planId ||
    snapshotHash(z.json().parse(network)) !== observation.evidenceHash ||
    observation.expiresAt <= new Date()
  )
    throw new NativeArchiveProtection("archive_network_evidence_changed");
  assertArchiveCleanupFresh(network);
  const expected = current.networkScope.files
    .filter((file) => file.role === "current_playback")
    .map((file) => ({
      assetId: file.assetId,
      assetVersion: file.assetVersion,
      checksum: file.checksum,
      mediaIds: file.mediaIds,
    }));
  if (
    snapshotHash(expected) !==
    snapshotHash(
      network.plex.currentPlayback.map(({ items: _items, ...file }) => file),
    )
  )
    throw new NativeArchiveProtection(
      "archive_current_playback_binding_changed",
    );
  const absent = current.networkScope.files.flatMap((file) =>
    file.role === "current_playback"
      ? []
      : [
          file.canonicalPath,
          ...file.subtitles.flatMap((subtitle) =>
            subtitle.path === null ? [] : [subtitle.path],
          ),
        ],
  );
  absent.push(
    ...current.networkScope.terminalDependencies.flatMap((terminal) =>
      terminal.dependency.files
        .filter((file) => file.expectedChecksum === null)
        .map((file) => file.canonicalPath),
    ),
  );
  if (
    snapshotHash([...new Set(absent)].sort()) !==
    snapshotHash(
      [
        ...new Set(network.plex.archiveAbsence.flatMap((item) => item.paths)),
      ].sort(),
    )
  )
    throw new NativeArchiveProtection("archive_absence_scope_changed");
  for (const kind of ["movies", "tv"] as const) {
    if (
      network.mounts.mounts.find((mount) => mount.root === `/data/${kind}`)
        ?.podUid !== context.workerPodUid
    )
      throw new NativeArchiveProtection("archive_executor_changed");
    if (context.files.verifyPlexExclusion === undefined)
      throw new NativeArchiveProtection("archive_exclusion_unverified");
    await context.files.verifyPlexExclusion(context.files.roots[kind]);
    await context.files.verifyStorageAuthority(context.files.roots[kind]);
    assertArchiveActive(context.execution);
  }
  assertArchiveCleanupFresh(network);
  return {
    ...current,
    network,
    beforeEffect: await archiveCleanupDeadline(tx, context, {
      network,
      observed,
    }),
    scopeHash: snapshotHash(z.json().parse(current.networkScope)),
  };
}

export function assertArchiveCleanupFresh(
  network: Parameters<typeof assertNativeEvidenceFresh>[0],
): void {
  try {
    assertNativeEvidenceFresh(network);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "Native recovery authority expired or has invalid freshness"
    )
      throw new NativeArchiveProtection("archive_network_evidence_expired");
    throw error;
  }
}
