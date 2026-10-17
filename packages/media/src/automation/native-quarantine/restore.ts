import { z } from "zod";
import { FileOperations } from "#filesystem/operations.ts";
import {
  NativeQuarantineContinuationSchema,
  NativeQuarantineRestorationSchema,
  type NativeQuarantineContinuation,
} from "#shared/native-recovery/quarantine.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import {
  assertNativeQuarantineRestore,
  type NativeQuarantineRestoreInput,
} from "#infrastructure/native-quarantine/continuation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { advanceSubtitleBindings } from "#automation/files/subtitle-lifecycle/ownership.ts";
import {
  prepareQuarantineRestoreProof,
  assertRestorePhysical,
  assertRestoreJournalInventory,
  nativeRestoreEffectId,
} from "./restore-proof.ts";
import {
  assertQuarantineRestoreRows,
  writeNativeRestoreOperationReceipt,
} from "./restore-state.ts";

type Proof = Awaited<ReturnType<typeof prepareQuarantineRestoreProof>>;
async function restoreEnvironment(
  context: NativeFileContext,
  descriptor: NativeQuarantineContinuation,
) {
  if (!(await context.files.enabled.acquisition()))
    throw new Error("native_quarantine_acquisition_disabled");
  for (const kind of new Set(
    descriptor.participants.map((item) => item.libraryKind),
  )) {
    if (context.files.verifyPlexExclusion === undefined)
      throw new Error("Native quarantine exclusion proof missing");
    await context.files.verifyPlexExclusion(context.files.roots[kind]);
    await context.files.verifyStorageAuthority(context.files.roots[kind]);
  }
}

async function withRestorePaths<T>(
  context: NativeFileContext,
  {
    descriptor,
    continuationId,
    proof,
    authorize,
  }: {
    descriptor: NativeQuarantineContinuation;
    continuationId: string;
    proof: Proof;
    authorize: () => Promise<void>;
  },
  action: (operations: Map<"movies" | "tv", FileOperations>) => Promise<T>,
): Promise<T> {
  const operations = new Map<"movies" | "tv", FileOperations>();
  const kinds = ["movies", "tv"] as const;
  const enter = async (index: number): Promise<T> => {
    const kind = kinds[index];
    if (kind === undefined) return await action(operations);
    const selected = descriptor.participants.filter(
      (item) => item.libraryKind === kind,
    );
    if (selected.length === 0) return await enter(index + 1);
    const files = new FileOperations(context.files.roots[kind], {
      authorize,
      contentProof: proof.content,
      checkpoint: context.files.checkpoint,
      ...(context.files.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
    });
    operations.set(kind, files);
    return await files.withContentPaths(
      selected.flatMap((item) => [
        { root: "library", path: item.libraryPath },
        { root: "control", path: `quarantine/${item.quarantineId}` },
      ]),
      () => enter(index + 1),
      selected.map((item) =>
        nativeRestoreEffectId(continuationId, item.quarantineId),
      ),
    );
  };
  return await enter(0);
}

export async function restoreNativeQuarantine(
  context: NativeFileContext,
  input: NativeQuarantineRestoreInput,
): Promise<void> {
  const initial =
    await context.files.db.nativeQuarantineContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  const descriptor = NativeQuarantineContinuationSchema.parse(
    initial.descriptor,
  );
  await restoreEnvironment(context, descriptor);
  const proof = await prepareQuarantineRestoreProof(
    context,
    initial,
    descriptor,
  );
  // Persist creation/identity authority BEFORE any filesystem effect; an unknown gap cannot adopt a file.
  const generations = await context.files.db.$transaction(
    async (tx) => {
      const authority = await assertNativeQuarantineRestore(tx, input);
      const currentGenerations = await withRestorePaths(
        context,
        {
          descriptor,
          continuationId: input.continuationId,
          proof,
          authorize: () =>
            Promise.reject(
              new Error("Restore execution preparation cannot mutate files"),
            ),
        },
        async () => {
          await restoreEnvironment(context, descriptor);
          await assertRestorePhysical(context, descriptor, {
            continuationId: input.continuationId,
            content: proof.content,
            executionCommitted: authority.row.executionEvidence !== null,
          });
          await assertRestoreJournalInventory(
            context,
            descriptor,
            input.continuationId,
          );
          if (authority.row.state !== "restored") {
            await assertQuarantineRestoreRows(tx, descriptor, "quarantined");
            await tx.nativeQuarantineContinuation.update({
              where: { id: input.continuationId },
              data: {
                state: "restoring",
                version: { increment: 1 },
                ...(authority.row.executionEvidence === null
                  ? { executionEvidence: proof.execution }
                  : {}),
              },
            });
          }
          await assertNativeQuarantineRestore(tx, input);
          return authority.generations;
        },
      );
      await restoreEnvironment(context, descriptor);
      await assertNativeQuarantineRestore(tx, input);
      return currentGenerations;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  await context.files.checkpoint("native-quarantine-execution-committed");
  await context.files.db.$transaction(
    async (tx) => {
      const authority = await assertNativeQuarantineRestore(tx, input);
      const authorize = async () => {
        await context.files.checkpoint(
          "native-quarantine-restore-authorization",
        );
        await restoreEnvironment(context, descriptor);
        const current = await assertNativeQuarantineRestore(tx, input);
        if (snapshotHash(current.generations) !== snapshotHash(generations))
          throw new Error("native_quarantine_generation_changed");
      };
      await withRestorePaths(
        context,
        { descriptor, continuationId: input.continuationId, proof, authorize },
        async (operations) => {
          await authorize();
          await assertRestorePhysical(context, descriptor, {
            continuationId: input.continuationId,
            content: proof.content,
            executionCommitted: true,
          });
          await assertRestoreJournalInventory(
            context,
            descriptor,
            input.continuationId,
          );
          if (authority.row.state === "restored") {
            await assertQuarantineRestoreRows(
              tx,
              descriptor,
              "published",
              authority.row.restoration,
            );
            const previous = NativeQuarantineRestorationSchema.parse(
              authority.row.restoration,
            );
            await writeNativeRestoreOperationReceipt(tx, input.operationId, {
              ...previous,
              generations,
            });
          } else {
            await assertQuarantineRestoreRows(tx, descriptor, "quarantined");
            for (const participant of descriptor.participants) {
              const files = operations.get(participant.libraryKind);
              if (files === undefined)
                throw new Error("Quarantine restore executor missing");
              await files.restore({
                operationId: nativeRestoreEffectId(
                  input.continuationId,
                  participant.quarantineId,
                ),
                quarantineId: participant.quarantineId,
                libraryPath: participant.libraryPath,
                sha256: participant.checksum,
              });
            }
            const assets = [];
            for (const binding of descriptor.bindings) {
              const file = descriptor.files.find(
                (item) => item.assetId === binding.assetId,
              );
              if (file === undefined)
                throw new Error("Quarantine restore file missing");
              const asset = await tx.libraryAsset.update({
                where: { id: binding.assetId },
                data: { state: "published", version: { increment: 1 } },
              });
              await advanceSubtitleBindings(tx, {
                assetId: binding.assetId,
                checksum: binding.checksum,
                epoch: authority.row.recoveryEpoch,
                fromVersion: binding.assetVersion,
                toVersion: asset.version,
                fromState: "quarantined",
                sidecarIds: file.sidecars.map((item) => item.subtitleId),
                state: "installed",
              });
              assets.push({
                assetId: asset.id,
                assetVersion: asset.version,
                checksum: binding.checksum,
              });
            }
            const receipt = NativeQuarantineRestorationSchema.parse({
              continuationId: input.continuationId,
              decisionId: z.uuid().parse(descriptor.group.decisions[0]?.id),
              recoveryEpoch: authority.row.recoveryEpoch,
              mediaIds: descriptor.group.mediaIds,
              generations,
              assets,
            });
            await tx.nativeQuarantineContinuation.update({
              where: { id: input.continuationId },
              data: {
                state: "restored",
                restoration: receipt,
                version: { increment: 1 },
              },
            });
            await tx.mediaItem.updateMany({
              where: { id: { in: descriptor.group.mediaIds } },
              data: { availability: "importing", version: { increment: 1 } },
            });
            await writeNativeRestoreOperationReceipt(
              tx,
              input.operationId,
              receipt,
            );
            await context.files.checkpoint(
              "native-quarantine-restored-before-commit",
            );
          }
          await assertRestorePhysical(context, descriptor, {
            continuationId: input.continuationId,
            content: proof.content,
            executionCommitted: true,
          });
          await assertRestoreJournalInventory(
            context,
            descriptor,
            input.continuationId,
          );
          await authorize();
        },
      );
      await authorize();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
