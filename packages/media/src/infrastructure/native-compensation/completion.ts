import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  NativeCompensationExecutionSchema,
  type NativeCompensationExecution,
} from "#shared/native-recovery/compensation.ts";
import {
  NativeCompensationCompletionSchema,
  type NativeCompensationActivityInput,
  type NativeCompensationCompletion,
} from "#shared/native-recovery/compensation-runtime.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { settleReviewedReservations } from "#infrastructure/publication-proof/lifecycle.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { assertNativeCompensation } from "./guards.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { assertCompensationRestoredParticipants } from "./completion-proof.ts";

export async function persistCompensationExecution(
  tx: Prisma.TransactionClient,
  input: {
    activity: NativeCompensationActivityInput;
    execution: NativeCompensationExecution;
  },
): Promise<void> {
  const authority = await assertNativeCompensation(tx, input.activity);
  const execution = NativeCompensationExecutionSchema.parse(input.execution);
  if (
    execution.continuationId !== authority.continuationId ||
    execution.descriptorHash !== authority.descriptorHash ||
    execution.recoveryEpoch !== authority.recoveryEpoch ||
    snapshotHash(nativeJson(execution.transition)) !==
      snapshotHash(nativeJson(authority.descriptor.scope.transition)) ||
    execution.effectPrefixHash !==
      authority.descriptor.approvedFileEvidence.effectPrefixHash ||
    snapshotHash(nativeJson(execution.participants)) !==
      snapshotHash(
        nativeJson(authority.descriptor.approvedFileEvidence.participants),
      )
  )
    throw new Error(
      "Compensation execution differs from approved physical proof",
    );
  if (authority.execution !== null) {
    if (
      snapshotHash(nativeJson(authority.execution)) !==
      snapshotHash(nativeJson(execution))
    )
      throw new Error("Compensation execution identity is immutable");
    return;
  }
  if (authority.completion !== null)
    throw new Error("Completed compensation lacks execution identity");
  await tx.nativePublicationCompensationContinuation.update({
    where: { id: authority.continuationId },
    data: {
      executionEvidence: z.record(z.string(), z.json()).parse(execution),
      state: "compensating",
      version: { increment: 1 },
    },
  });
}

export async function commitNativeCompensation(
  tx: Prisma.TransactionClient,
  input: {
    activity: NativeCompensationActivityInput;
    completion: NativeCompensationCompletion;
  },
): Promise<void> {
  const authority = await assertNativeCompensation(tx, input.activity);
  const completion = NativeCompensationCompletionSchema.parse(input.completion);
  if (authority.completion !== null) {
    if (
      snapshotHash(nativeJson(authority.completion)) !==
      snapshotHash(nativeJson(completion))
    )
      throw new Error("Compensation completed receipt is immutable");
    return;
  }
  if (authority.execution === null)
    throw new Error(
      "Compensation cannot complete without persisted execution identity",
    );
  if (
    completion.continuationId !== authority.continuationId ||
    completion.receiptId !== authority.receiptId ||
    completion.descriptorHash !== authority.descriptorHash ||
    completion.recoveryEpoch !== authority.recoveryEpoch ||
    snapshotHash(nativeJson(completion.transition)) !==
      snapshotHash(nativeJson(authority.descriptor.scope.transition))
  )
    throw new Error("Compensation completion authority changed");
  const files = authority.descriptor.scope.files;
  if (
    completion.predecessorBindings.length !== files.length ||
    new Set(completion.predecessorBindings.map((row) => row.before.id)).size !==
      files.length
  )
    throw new Error("Compensation completion omitted whole-plan predecessors");
  await assertPredecessorBindings(tx, authority, completion);
  const settlement = await settleReviewedReservations(
    tx,
    authority.descriptor.scope.interruptedWork,
  );
  if (
    snapshotHash(nativeJson(settlement)) !==
    snapshotHash(nativeJson(completion.settlement))
  )
    throw new Error(
      "Compensation completion settlement differs from exact revoked reservations",
    );
  for (const binding of completion.predecessorBindings) {
    const updated = await tx.libraryAsset.updateMany({
      where: {
        id: binding.before.id,
        version: binding.before.version,
        ownershipEpoch: binding.before.ownershipEpoch,
        state: "published",
        checksum: binding.before.checksum,
      },
      data: {
        version: { increment: 1 },
        ownershipEpoch: authority.recoveryEpoch,
      },
    });
    if (updated.count !== 1)
      throw new NativeCompensationProtection(
        "compensation_predecessor_changed",
      );
    await rebindSubtitles(tx, binding, authority.recoveryEpoch);
  }
  const ids = authority.descriptor.scope.intent.mediaIds;
  if (
    (await tx.recoveryHold.count({
      where: {
        edition: "default",
        mediaId: { in: ids },
        recoveryEpoch: authority.recoveryEpoch,
        releasedAt: null,
      },
    })) !== ids.length
  )
    throw new NativeCompensationProtection(
      "compensation_recovery_holds_required",
    );
  await tx.mediaItem.updateMany({
    where: { id: { in: ids } },
    data: { availability: "importing", version: { increment: 1 } },
  });
  await mirrorDefaultAvailability(tx, ids, "importing");
  await tx.nativePublicationCompensationContinuation.update({
    where: { id: authority.continuationId },
    data: {
      completion: z.record(z.string(), z.json()).parse(completion),
      state: "compensated",
      version: { increment: 1 },
    },
  });
}

async function assertPredecessorBindings(
  tx: Prisma.TransactionClient,
  authority: Awaited<ReturnType<typeof assertNativeCompensation>>,
  completion: NativeCompensationCompletion,
) {
  const files = authority.descriptor.scope.files;
  for (const binding of completion.predecessorBindings) {
    const file = files.find((row) => row.assetId === binding.before.id);
    if (file === undefined)
      throw new Error(
        "Compensation completion includes an unknown predecessor",
      );
    const before = await snapshotPublicationAsset(tx, file.assetId);
    const expected = {
      ...before,
      version: before.version + 1,
      ownershipEpoch: authority.recoveryEpoch,
      subtitles: before.subtitles.map((subtitle) => ({
        ...subtitle,
        version: subtitle.version + 1,
        ownershipEpoch: authority.recoveryEpoch,
        videoVersion: before.version + 1,
      })),
    };
    if (
      snapshotHash(nativeJson(binding.before)) !==
        snapshotHash(nativeJson(before)) ||
      snapshotHash(nativeJson(binding.after)) !==
        snapshotHash(nativeJson(expected))
    )
      throw new Error(
        "Compensation completion cannot rewrite predecessor identity, policy or lifecycle",
      );
    assertCompensationRestoredParticipants(
      before,
      binding.participants,
      file.libraryKind,
    );
  }
}

async function rebindSubtitles(
  tx: Prisma.TransactionClient,
  binding: NativeCompensationCompletion["predecessorBindings"][number],
  recoveryEpoch: number,
) {
  for (const subtitle of binding.before.subtitles) {
    const changed = await tx.subtitleAsset.updateMany({
      where: {
        id: subtitle.id,
        version: subtitle.version,
        ownershipEpoch: subtitle.ownershipEpoch,
        videoVersion: subtitle.videoVersion,
        state: "installed",
      },
      data: {
        version: { increment: 1 },
        ownershipEpoch: recoveryEpoch,
        videoVersion: binding.after.version,
      },
    });
    if (changed.count !== 1)
      throw new NativeCompensationProtection("compensation_sidecar_changed");
  }
}
