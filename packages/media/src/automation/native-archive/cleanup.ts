import { z } from "zod";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { readCompletedNativeArchiveCleanup } from "#infrastructure/plex-binding/native/native-archive-ack.ts";
import { commitArchivePhaseCompletion } from "#infrastructure/native-archive/execution-phase.ts";
import {
  discoverNativeArchiveExecution,
  type ArchiveExecutionDiscovery,
} from "#infrastructure/native-archive/execution/discovery.ts";
import { persistArchiveDiscoveryExecution } from "#infrastructure/native-archive/execution/discovery-check.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  NativeArchiveCompletionSchema,
  NativeArchiveContinuationSchema,
  CleanupNativeArchiveInputSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import { advanceSubtitleBindings } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  reopenLegacyClaimProtection,
  PendingLegacyClaimsError,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { NativeArchiveProtection } from "#infrastructure/native-archive/continuation.ts";
import { assertArchiveActive, type ArchiveFileContext } from "./execution.ts";
import {
  archiveCleanupAuthority,
  captureArchiveCleanupAuthority,
  assertArchiveCleanupCurrent,
  assertArchiveCleanupFresh,
  type ArchiveCleanupPlexProof,
} from "./cleanup-authority.ts";
import { measureArchiveCleanup } from "./cleanup/measurement.ts";
import type { ArchiveCleanupProof } from "./cleanup-types.ts";
import { archivePurgeId } from "./purge-manifest.ts";
import { withCleanupLocks } from "./cleanup-locks.ts";

export async function cleanupNativeArchive(
  context: ArchiveFileContext,
  raw: CleanupNativeArchiveInput,
) {
  const input = CleanupNativeArchiveInputSchema.parse(raw);
  const observed = context.execution.observed;
  const budget = new PublicationAuthorityReadBudget();
  assertArchiveActive(context.execution);
  const completed = await context.files.db.$transaction((tx) =>
    readCompletedNativeArchiveCleanup(tx, input, budget),
  );
  assertArchiveActive(context.execution);
  // Exact committed acknowledgement precedes fresh config, proof and filesystem work.
  if (completed !== null) return;
  const original = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(
      context.execution.expiresAtMs,
      observed.wall + 60_000,
    ),
    guards: [context.execution],
  });
  const execution: PlexBindingExecution = {
    observed,
    expiresAtMs: original.expiresAtMs,
    signal: context.execution.signal,
    assertActive: () => {
      assertArchiveActive(context.execution);
      original.assertActive();
    },
    checkpoint: context.execution.checkpoint,
  };
  // Negative admission only: a restored epoch must protect before old scanner
  // evidence is inspected. Each complete locked phase still checks authority.
  execution.assertActive();
  budget.consume(1);
  const runtime = await context.files.db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { mode: true, ownershipConfirmed: true, recoveryEpoch: true },
  });
  execution.assertActive();
  if (
    runtime.mode !== "active" ||
    !runtime.ownershipConfirmed ||
    runtime.recoveryEpoch !== input.recoveryEpoch
  )
    throw new NativeArchiveProtection("archive_runtime_protected");
  budget.consume(1);
  const initial =
    await context.files.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  execution.assertActive();
  if (
    snapshotHash(z.json().parse(initial.descriptor)) !== initial.descriptorHash
  )
    throw new Error("Archive raw cleanup descriptor changed");
  const descriptor = NativeArchiveContinuationSchema.parse(initial.descriptor);
  const selectedEdge = descriptor.scope.edges.find(
    (edge) => edge.id === descriptor.selectedCleanupId && edge.selected,
  );
  if (selectedEdge === undefined)
    throw new Error("Archive selected measurement edge missing");
  // A negative admission check preserves the original no-hash rollback window;
  // it cannot grant authority and is repeated by each complete locked phase.
  if (Date.parse(selectedEdge.expiresAt) > Date.now())
    throw new NativeArchiveProtection("archive_rollback_window_incomplete");
  const mediaIds = descriptor.scope.media.map((media) => media.id);
  if (await reopenLegacyClaimProtection(context.files.db, mediaIds))
    throw new PendingLegacyClaimsError(mediaIds);
  execution.assertActive();
  const discovery = await context.files.db.$transaction((tx) =>
    discoverNativeArchiveExecution(tx, input, { execution, budget }),
  );
  execution.assertActive();
  const measurementClock = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(execution.expiresAtMs, discovery.expiresAtMs),
    guards: [execution],
  });
  const measured = await measureArchiveCleanup(
    context,
    discovery,
    measurementClock.assertActive,
  );
  await context.files.checkpoint("native-archive-cleanup-measured");
  measurementClock.assertActive();
  const selected = await persistExecution(context, input, {
    measured,
    discovery,
    execution,
    budget,
  });
  selected.proof.executionCommitted = true;
  await context.files.checkpoint("native-archive-execution-committed");
  selected.plex.freshness.assertActive();
  await executeCleanup(context, input, selected);
}

type SelectedCleanup = {
  proof: ArchiveCleanupProof;
  scopeHash: string;
  plex: ArchiveCleanupPlexProof;
  discovery: ArchiveExecutionDiscovery;
  execution: PlexBindingExecution;
};

async function persistExecution(
  context: ArchiveFileContext,
  input: CleanupNativeArchiveInput,
  measuredInput: {
    measured: Awaited<ReturnType<typeof measureArchiveCleanup>>;
    discovery: ArchiveExecutionDiscovery;
    execution: PlexBindingExecution;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { measured, discovery, execution, budget } = measuredInput;
  return await context.files.db.$transaction(
    async (tx) => {
      const {
        phase,
        authority: current,
        plex,
      } = await captureArchiveCleanupAuthority(tx, context, input, {
        discovery,
        execution,
        budget,
      });
      const scopeHash = measured.scopeHash;
      if (current.scopeHash !== scopeHash)
        throw new Error("Archive selection changed during hashing");
      const authorize = async () => {
        const latest = await assertArchiveCleanupCurrent(
          tx,
          context,
          plex,
          phase,
        );
        if (latest.scopeHash !== scopeHash)
          throw new Error("Archive selection changed before execution");
        return latest.beforeEffect;
      };
      const proof = await measured.seal({
        assertActive: () => {
          plex.freshness.assertActive();
        },
        assertCurrent: async () => {
          await authorize();
        },
      });
      const advanced = await withCleanupLocks(
        context,
        proof,
        authorize,
        async () => {
          const result = await persistArchiveDiscoveryExecution(
            tx,
            proof.execution,
            phase,
            {
              discovery,
              execution,
              freshness: plex.freshness,
              budget,
            },
          );
          assertArchiveActive(context.execution);
          assertArchiveCleanupFresh(current.network);
          current.beforeEffect();
          return result;
        },
      );
      assertArchiveActive(context.execution);
      assertArchiveCleanupFresh(current.network);
      current.beforeEffect();
      return {
        proof,
        scopeHash,
        plex,
        discovery: advanced,
        execution,
      } satisfies SelectedCleanup;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function executeCleanup(
  context: ArchiveFileContext,
  input: CleanupNativeArchiveInput,
  selected: SelectedCleanup,
) {
  const { proof, scopeHash, plex } = selected;
  await context.files.db.$transaction(
    async (tx) => {
      const { phase, authority: current } = await archiveCleanupAuthority(
        tx,
        context,
        input,
        { plex, discovery: selected.discovery, execution: selected.execution },
      );
      if (current.scopeHash !== scopeHash)
        throw new Error("Archive selection changed before effects");
      const authorize = async () => {
        const latest = await assertArchiveCleanupCurrent(
          tx,
          context,
          plex,
          phase,
        );
        if (
          latest.scopeHash !== scopeHash ||
          snapshotHash(z.json().parse(latest.row.executionEvidence)) !==
            snapshotHash(proof.execution)
        )
          throw new Error("Archive exact execution authority changed");
        assertArchiveActive(context.execution);
        return latest.beforeEffect;
      };
      await withCleanupLocks(context, proof, authorize, async (operations) => {
        const journals = [];
        for (const item of proof.execution.participants) {
          const executor = operations.get(item.libraryKind);
          if (executor === undefined)
            throw new Error("Archive scoped executor missing");
          await authorize();
          const journal = await executor.purge({
            operationId: archivePurgeId(
              input.continuationId,
              item.canonicalPath,
            ),
            quarantineId: item.id,
            sha256: item.checksum,
            location: item.location,
          });
          assertArchiveActive(context.execution);
          journals.push({
            operationId: journal.operationId,
            kind: "purge" as const,
            source: item.canonicalPath,
            target: item.canonicalPath,
            sha256: item.checksum,
            previousSha256: null,
            phase: "complete" as const,
            manifestHash: snapshotHash({
              ...journal,
              source: item.canonicalPath,
              target: item.canonicalPath,
            }),
          });
        }
        await authorize();
        await context.files.checkpoint("native-archive-before-commit");
        await authorize();
        const file = current.networkScope.files.find(
          (item) => item.assetId === proof.execution.participants[0]?.assetId,
        );
        if (file === undefined)
          throw new Error("Archive selected DB participant missing");
        const asset = await tx.libraryAsset.update({
          where: { id: file.assetId },
          data: { state: "purged", version: { increment: 1 } },
        });
        await advanceSubtitleBindings(tx, {
          assetId: asset.id,
          checksum: file.checksum,
          epoch: input.recoveryEpoch,
          fromVersion: file.assetVersion,
          toVersion: asset.version,
          fromState: "superseded",
          sidecarIds: proof.execution.participants.flatMap((item) =>
            item.subtitleId === null ? [] : [item.subtitleId],
          ),
          state: "purged",
        });
        const absences = [];
        for (const item of proof.execution.participants) {
          const absence = await proof.content.reviewAbsence(
            nativeLocalPath(context, item.canonicalPath),
          );
          absences.push({
            canonicalPath: item.canonicalPath,
            ancestors: absence.ancestors,
          });
        }
        const completion = NativeArchiveCompletionSchema.parse({
          schemaVersion: 1,
          continuationId: input.continuationId,
          receiptId: current.row.receiptId,
          originalCleanupId: current.row.originalCleanupId,
          descriptorHash: current.row.descriptorHash,
          recoveryEpoch: input.recoveryEpoch,
          asset: {
            assetId: asset.id,
            beforeVersion: file.assetVersion,
            assetVersion: asset.version,
            checksum: file.checksum,
            mediaIds: file.mediaIds,
            ownershipEpoch: input.recoveryEpoch,
          },
          subtitles: file.subtitles.map((subtitle) => ({
            id: subtitle.id,
            before: {
              version: subtitle.version,
              ownershipEpoch: subtitle.ownershipEpoch,
              videoVersion: subtitle.videoVersion,
            },
            after: {
              version: subtitle.version + 1,
              ownershipEpoch: subtitle.ownershipEpoch,
              videoVersion: asset.version,
            },
            qualityStatus: subtitle.qualityStatus,
            checksum: subtitle.checksum,
          })),
          journals,
          absences,
          completedAt: new Date().toISOString(),
        });
        await commitArchivePhaseCompletion(tx, completion, phase, {
          freshness: plex.freshness,
          budget: plex.budget,
        });
        assertArchiveActive(context.execution);
        assertArchiveCleanupFresh(current.network);
        current.beforeEffect();
      });
      const authority = await runtimeAuthority(tx);
      if (!authority.active || authority.epoch !== input.recoveryEpoch)
        throw new Error("Archive authority expired before commit");
      assertArchiveCleanupFresh(current.network);
      assertArchiveActive(context.execution);
      current.beforeEffect();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
