import { z } from "zod";
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
import { assertArchiveActive, type ArchiveFileContext } from "./execution.ts";
import {
  archiveCleanupAuthority,
  assertArchiveCleanupFresh,
} from "./cleanup-authority.ts";
import { prepareArchiveCleanupProof } from "./cleanup-proof.ts";
import type { ArchiveCleanupProof } from "./cleanup-types.ts";
import { archivePurgeId } from "./purge-manifest.ts";
import { withCleanupLocks } from "./cleanup-locks.ts";

export async function cleanupNativeArchive(
  context: ArchiveFileContext,
  raw: CleanupNativeArchiveInput,
) {
  const input = CleanupNativeArchiveInputSchema.parse(raw);
  assertArchiveActive(context.execution);
  const initial =
    await context.files.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  if (initial.state === "cleaned") {
    const completion = NativeArchiveCompletionSchema.parse(initial.completion);
    if (
      initial.recoveryEpoch !== input.recoveryEpoch ||
      completion.continuationId !== initial.id ||
      completion.descriptorHash !== initial.descriptorHash
    )
      throw new Error("Archive completed receipt changed");
    // Already committed acknowledgement is not a new filesystem effect or authority grant.
    assertArchiveActive(context.execution);
    return;
  }
  const descriptor = NativeArchiveContinuationSchema.parse(initial.descriptor);
  const mediaIds = descriptor.scope.media.map((media) => media.id);
  if (await reopenLegacyClaimProtection(context.files.db, mediaIds))
    throw new PendingLegacyClaimsError(mediaIds);
  const before = await context.files.db.$transaction(async (tx) => {
    const result = await archiveCleanupAuthority(tx, context, input);
    assertArchiveActive(context.execution);
    return result;
  });
  const proof = await prepareArchiveCleanupProof(
    context,
    before.row,
    before.descriptor,
    before.networkScope,
  );
  await persistExecution(context, input, proof, before.scopeHash);
  proof.executionCommitted = true;
  await context.files.checkpoint("native-archive-execution-committed");
  await executeCleanup(context, input, proof, before.scopeHash);
}

async function persistExecution(
  context: ArchiveFileContext,
  input: CleanupNativeArchiveInput,
  proof: ArchiveCleanupProof,
  scopeHash: string,
) {
  await context.files.db.$transaction(
    async (tx) => {
      const current = await archiveCleanupAuthority(tx, context, input);
      if (current.scopeHash !== scopeHash)
        throw new Error("Archive selection changed during hashing");
      const authorize = async () => {
        const latest = await archiveCleanupAuthority(tx, context, input);
        if (latest.scopeHash !== scopeHash)
          throw new Error("Archive selection changed before execution");
        return latest.beforeEffect;
      };
      await withCleanupLocks(context, proof, authorize, async () => {
        if (current.row.executionEvidence === null)
          await tx.nativeArchiveCleanupContinuation.update({
            where: { id: input.continuationId },
            data: {
              executionEvidence: proof.execution,
              version: { increment: 1 },
            },
          });
        else if (
          snapshotHash(z.json().parse(current.row.executionEvidence)) !==
          snapshotHash(proof.execution)
        )
          throw new Error("Archive persisted execution changed");
        assertArchiveActive(context.execution);
        assertArchiveCleanupFresh(current.network);
      });
      assertArchiveActive(context.execution);
      assertArchiveCleanupFresh(current.network);
      current.beforeEffect();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function executeCleanup(
  context: ArchiveFileContext,
  input: CleanupNativeArchiveInput,
  proof: ArchiveCleanupProof,
  scopeHash: string,
) {
  await context.files.db.$transaction(
    async (tx) => {
      const current = await archiveCleanupAuthority(tx, context, input);
      if (current.scopeHash !== scopeHash)
        throw new Error("Archive selection changed before effects");
      const authorize = async () => {
        const latest = await archiveCleanupAuthority(tx, context, input);
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
        await tx.nativeArchiveCleanupContinuation.update({
          where: { id: input.continuationId },
          data: { state: "cleaned", completion, version: { increment: 1 } },
        });
        assertArchiveActive(context.execution);
        assertArchiveCleanupFresh(current.network);
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
