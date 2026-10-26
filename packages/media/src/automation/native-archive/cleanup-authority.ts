import { z } from "zod";
import type { PairedNativeProof } from "#automation/native-recovery/plex-proof.ts";
import { loadNativeArchivePlexPhase } from "#infrastructure/plex-binding/native/native-parent.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { ArchiveExecutionDiscovery } from "#infrastructure/native-archive/execution/discovery.ts";
import { assertArchiveDiscovery } from "#infrastructure/native-archive/execution/discovery-check.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveCleanupNetworkEvidenceSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import {
  assertArchivePhaseCurrent,
  type ArchiveExecutionPhase,
  type ArchiveCleanupAuthority,
  NativeArchiveProtection,
} from "#infrastructure/native-archive/continuation.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { assertArchiveActive, type ArchiveFileContext } from "./execution.ts";
import { archiveCleanupDeadline } from "./cleanup/deadline.ts";

export type ArchiveCleanupPlexProof = PairedNativeProof & {
  observed: { wall: number; monotonic: number };
};

/** Capture the exact proof and its current authority in one locked phase. */
export async function captureArchiveCleanupAuthority(
  tx: Prisma.TransactionClient,
  context: ArchiveFileContext,
  input: CleanupNativeArchiveInput,
  timing: {
    execution: PlexBindingExecution;
    discovery: ArchiveExecutionDiscovery;
    budget: PublicationAuthorityReadBudget;
  },
) {
  assertArchiveActive(context.execution);
  const { execution, discovery } = timing;
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(execution.expiresAtMs, discovery.expiresAtMs),
    guards: [execution],
  });
  const { phase, proof } = await loadNativeArchivePlexPhase(
    tx,
    input,
    { freshness, expectedRef: discovery.ref },
    timing.budget,
  );
  assertArchiveDiscovery(tx, phase, discovery, timing);
  assertArchiveActive(context.execution);
  const plex: ArchiveCleanupPlexProof = {
    kind: "paired",
    ref: proof.ref,
    network: proof.network,
    observed: execution.observed,
    freshness: plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(freshness.expiresAtMs, proof.expiresAtMs),
      guards: [freshness],
    }),
    budget: timing.budget,
  };
  const authority = await assertArchiveCleanupCurrent(tx, context, plex, phase);
  return { plex, authority, phase };
}

/** Each later transaction loads one new complete phase against the original proof. */
export async function archiveCleanupAuthority(
  tx: Prisma.TransactionClient,
  context: ArchiveFileContext,
  input: CleanupNativeArchiveInput,
  {
    plex,
    discovery,
    execution,
  }: {
    plex: ArchiveCleanupPlexProof;
    discovery: ArchiveExecutionDiscovery;
    execution: PlexBindingExecution;
  },
) {
  assertArchiveActive(context.execution);
  plex.freshness.assertActive();
  const { phase } = await loadNativeArchivePlexPhase(
    tx,
    input,
    { freshness: plex.freshness, expectedRef: plex.ref },
    plex.budget,
  );
  assertArchiveDiscovery(tx, phase, discovery, {
    execution,
    budget: plex.budget,
  });
  assertArchiveActive(context.execution);
  const authority = await assertArchiveCleanupCurrent(tx, context, plex, phase);
  return { phase, authority };
}

/** Recheck mutable authority and actual markers, without another immutable graph traversal. */
export async function assertArchiveCleanupCurrent(
  tx: Prisma.TransactionClient,
  context: ArchiveFileContext,
  plex: ArchiveCleanupPlexProof,
  phase: ArchiveExecutionPhase,
) {
  assertArchiveActive(context.execution);
  plex.freshness.assertActive();
  await assertArchivePhaseCurrent(tx, phase);
  assertArchiveActive(context.execution);
  plex.freshness.assertActive();
  if (!(await context.files.enabled.purge()))
    throw new NativeArchiveProtection("archive_purge_disabled");
  assertArchiveActive(context.execution);
  plex.freshness.assertActive();
  const current = phase.authority;
  const network = archiveCleanupNetwork(current, phase.activity, plex);
  for (const kind of ["movies", "tv"] as const) {
    if (
      network.mounts.mounts.find((mount) => mount.root === `/data/${kind}`)
        ?.podUid !== context.workerPodUid
    )
      throw new NativeArchiveProtection("archive_executor_changed");
    if (context.files.verifyPlexExclusion === undefined)
      throw new NativeArchiveProtection("archive_exclusion_unverified");
    await context.files.verifyPlexExclusion(context.files.roots[kind]);
    assertArchiveActive(context.execution);
    plex.freshness.assertActive();
    await context.files.verifyStorageAuthority(context.files.roots[kind]);
    assertArchiveActive(context.execution);
    plex.freshness.assertActive();
  }
  assertArchiveCleanupFresh(network);
  plex.freshness.assertActive();
  const deadline = await archiveCleanupDeadline(tx, context, {
    network,
    observed: plex.observed,
  });
  const previous = plex.freshness;
  plex.freshness = plexBindingFreshness({
    observed: plex.observed,
    expiresAtMs: Math.min(previous.expiresAtMs, deadline.expiresAtMs),
    guards: [previous, deadline],
  });
  await bindPlexTransactionDeadline(tx, plex.freshness);
  plex.freshness.assertActive();
  return {
    ...current,
    network,
    beforeEffect: () => {
      plex.freshness.assertActive();
    },
    scopeHash: snapshotHash(z.json().parse(current.networkScope)),
  };
}

function archiveCleanupNetwork(
  current: ArchiveCleanupAuthority,
  input: CleanupNativeArchiveInput,
  plex: PairedNativeProof,
) {
  const network = NativeArchiveCleanupNetworkEvidenceSchema.parse(plex.network);
  if (
    network.continuationId !== input.continuationId ||
    network.operationId !== input.operationId ||
    network.recoveryEpoch !== input.recoveryEpoch ||
    network.planId !== current.row.receipt.planId ||
    plex.ref.parent.operationId !== input.operationId ||
    Date.parse(network.expiresAt) <= Date.now()
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
  return network;
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
