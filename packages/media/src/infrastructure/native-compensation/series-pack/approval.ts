import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import {
  SeriesPackNativeDescriptorV2Schema,
  SeriesPackNativeFinishedV4Schema,
  type SeriesPackNativeFileEvidenceV3,
} from "#shared/native-recovery/series-pack/evidence.ts";
import {
  SeriesPackNativeSelectionV4Schema,
  SeriesPackNativeExecutionV2Schema,
  type SeriesPackNativeApplyV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { installNativeAuthority } from "#automation/native-recovery/authority.ts";
import { assertNativeEvidenceFresh } from "#infrastructure/native-recovery/evidence-freshness.ts";
import { queueOperation } from "#automation/store.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { loadSeriesPackNativePlexV1 } from "./plex-records.ts";
import { reserveSeriesPackNativeSqlV1 } from "./sql-budget.ts";
import type { loadSeriesPackNativeReviewPhaseV1 } from "./review-phase.ts";
import { assertSeriesPackNativeFileEvidenceV1 } from "./file-evidence.ts";

type ReviewPhase = Awaited<
  ReturnType<typeof loadSeriesPackNativeReviewPhaseV1>
>;
type Proof = Awaited<ReturnType<typeof loadSeriesPackNativePlexV1>>;

export async function finishSeriesPackNativePreparationV1(
  tx: Prisma.TransactionClient,
  phase: ReviewPhase,
  input: {
    files: SeriesPackNativeFileEvidenceV3;
    proof: Proof;
    freshness: PlexBindingFreshness;
  },
) {
  if (phase.transaction !== tx)
    throw new Error("Native pack review has a foreign transaction");
  input.freshness.assertActive();
  assertSeriesPackNativeFileEvidenceV1(phase.scope, phase.graph, input.files);
  if (
    phase.plan.state !== "preparing" ||
    phase.operation.kind !== "prepare_series_pack_native_compensation_v1" ||
    input.proof.row.operationId !== phase.operation.id ||
    input.files.planId !== phase.plan.id ||
    input.proof.ref.parent.purpose !== "native_review"
  )
    throw new Error("Native pack preparation coordinator or state changed");
  const {
    capturedAt: _capturedAt,
    workerPodUid: _worker,
    ...files
  } = input.files;
  const finished = SeriesPackNativeFinishedV4Schema.parse({
    schemaVersion: 4,
    lifecycleKind: "publication_compensation",
    protocol: "series_pack_publication_v3",
    scopeHash: identityHash(phase.scope),
    plex: input.proof.ref,
    networkIdentityHash: input.proof.batch.identityHash,
    files,
  });
  reserveSeriesPackNativeSqlV1(phase.budget, phase.scope, "finish_review");
  await tx.nativeRecoveryObservation.create({
    data: {
      planId: phase.plan.id,
      kind: "files",
      evidenceHash: identityHash(input.files),
      evidence: z.record(z.string(), z.json()).parse(input.files),
      observedAt: new Date(input.files.capturedAt),
      expiresAt: new Date(Date.now() + 12 * 3_600_000),
    },
  });
  await tx.nativeRecoveryPlan.update({
    where: { id: phase.plan.id, version: phase.plan.version },
    data: {
      state: "awaiting_review",
      plan: z.record(z.string(), z.json()).parse(finished),
      planHash: identityHash(finished),
      expiresAt: new Date(Date.now() + 12 * 3_600_000),
      version: { increment: 1 },
    },
  });
  input.freshness.assertActive();
}

/** Actual Files apply admits BEFORE-effect identity. This is neither an effect
 * receipt nor a claim that queued native work has run. Every later syscall
 * still requires one freshly loaded current phase and original execution. */
export async function applySeriesPackNativeApprovalV1(
  tx: Prisma.TransactionClient,
  context: NativeFileContext,
  phase: ReviewPhase,
  input: {
    activity: SeriesPackNativeApplyV1;
    files: SeriesPackNativeFileEvidenceV3;
    proof: Proof;
    freshness: PlexBindingFreshness;
  },
) {
  const { activity, files, proof, freshness } = input;
  if (phase.transaction !== tx)
    throw new Error("Native pack approval has a foreign transaction");
  freshness.assertActive();
  assertSeriesPackNativeFileEvidenceV1(phase.scope, phase.graph, files);
  const payload = z
    .strictObject({
      operationId: z.uuid(),
      kind: z.literal("apply_series_pack_native_compensation_v1"),
      recoveryEpoch: z.int().nonnegative(),
      planId: z.uuid(),
      planHash: z.string(),
      actorId: z.uuid(),
    })
    .parse(phase.operation.payload);
  const finished = SeriesPackNativeFinishedV4Schema.parse(phase.plan.plan);
  const assertApplyCommand1 = () => {
    if (
      phase.operation.id !== activity.operationId ||
      phase.plan.id !== activity.planId ||
      phase.plan.state !== "applying" ||
      phase.plan.planHash !== activity.planHash ||
      identityHash(phase.plan.plan) !== activity.planHash ||
      phase.plan.expiresAt === null ||
      phase.plan.expiresAt <= new Date() ||
      phase.operation.kind !== payload.kind
    )
      throw new Error(
        "Native pack approval requires its exact current reviewed command",
      );
  };
  assertApplyCommand1();
  const assertApplyCommand2 = () => {
    if (
      payload.operationId !== phase.operation.id ||
      payload.planId !== phase.plan.id ||
      payload.planHash !== activity.planHash ||
      payload.actorId !== phase.plan.actorId ||
      payload.recoveryEpoch !== phase.runtime.recoveryEpoch ||
      proof.row.operationId !== phase.operation.id
    )
      throw new Error(
        "Native pack approval requires its exact current reviewed command",
      );
  };
  assertApplyCommand2();
  const approved = await loadSeriesPackNativePlexV1(tx, finished.plex, {
    transaction: tx,
    budget: phase.budget,
    plan: phase.plan,
  });
  const {
    capturedAt: _capturedAt,
    workerPodUid: _worker,
    ...stableFiles
  } = files;
  if (
    approved.row.id === proof.row.id ||
    approved.row.operationId === proof.row.operationId ||
    approved.row.operation.kind !==
      "prepare_series_pack_native_compensation_v1" ||
    proof.row.operation.kind !== "apply_series_pack_native_compensation_v1" ||
    proof.batch.identityHash !== approved.batch.identityHash ||
    proof.batch.identityHash !== finished.networkIdentityHash ||
    identityHash(stableFiles) !== identityHash(finished.files) ||
    finished.scopeHash !== identityHash(phase.scope) ||
    files.planId !== phase.plan.id ||
    proof.network.mounts.mounts.some(
      (mount) => mount.podUid !== context.workerPodUid,
    )
  )
    throw new Error(
      "Native pack fresh apply changed the exact reviewed proof or actual executor",
    );
  assertNativeEvidenceFresh(proof.network);
  reserveSeriesPackNativeSqlV1(phase.budget, phase.scope, "approve");
  await installNativeAuthority(tx, context, {
    scope: phase.scope,
    network: proof.network,
  });
  const continuationId = phase.plan.id;
  const descriptor = SeriesPackNativeDescriptorV2Schema.parse({
    schemaVersion: 2,
    protocol: "series_pack_publication_v3",
    allowedAction: "compensate",
    scope: phase.scope,
    approvedFileEvidence: files,
    steps: files.steps,
  });
  const descriptorHash = identityHash(descriptor);
  const recoveryHoldBindings = [];
  for (const mediaId of phase.scope.publication.intent.mediaIds) {
    const hold = await tx.recoveryHold.upsert({
      where: targetWhere(defaultScope(mediaId)),
      create: {
        mediaId,
        recoveryEpoch: phase.runtime.recoveryEpoch,
        reason: "recovery_request_history_unconfirmed",
      },
      update: {
        recoveryEpoch: phase.runtime.recoveryEpoch,
        reason: "recovery_request_history_unconfirmed",
        releasedAt: null,
        releasedById: null,
        releaseEvidence: Prisma.DbNull,
        version: { increment: 1 },
      },
    });
    recoveryHoldBindings.push({
      mediaId,
      version: hold.version,
      recoveryEpoch: hold.recoveryEpoch,
    });
  }
  await tx.mediaRuntimeState.update({
    where: { id: "singleton", version: phase.runtime.version },
    data: {
      mode: "active",
      ownershipConfirmed: true,
      version: { increment: 1 },
    },
  });
  const selection = SeriesPackNativeSelectionV4Schema.parse({
    schemaVersion: 4,
    lifecycleKind: "publication_compensation",
    protocol: "series_pack_publication_v3",
    finishedRaw: canonicalJson(z.json().parse(phase.plan.plan)),
    scope: phase.scope,
    fileEvidence: files,
    networkEvidence: proof.network,
    plex: { approved: approved.ref, applied: proof.ref },
    compensationAuthorization: {
      continuationId,
      descriptorHash,
      descriptorRaw: canonicalJson(z.json().parse(descriptor)),
      mediaIds: phase.scope.publication.intent.mediaIds,
      predecessorAssetIds: phase.scope.files.map((row) => row.assetId),
      recoveryHoldBindings,
    },
  });
  const receipt = await tx.nativeRecoveryReceipt.create({
    data: {
      createdAt: new Date(),
      planId: phase.plan.id,
      planHash: activity.planHash,
      actorId: phase.plan.actorId,
      recoveryEpoch: phase.runtime.recoveryEpoch,
      previousRuntimeVersion: phase.runtime.version,
      runtimeVersion: phase.runtime.version + 1,
      selection: z.record(z.string(), z.json()).parse(selection),
    },
  });
  const coordinatorOperationId = await queueOperation(tx, {
    key: `series-pack-native-compensation-v1:${continuationId}`,
    kind: "compensate_series_pack_native_publication_v1",
    targetId: continuationId,
    userId: phase.plan.actorId,
    budget: phase.budget,
    createdAt: new Date(),
    availableAt: new Date(),
    payload: {
      schemaVersion: 1,
      continuationId,
      recoveryEpoch: phase.runtime.recoveryEpoch,
    },
  });
  const admittedAt = new Date();
  const execution = SeriesPackNativeExecutionV2Schema.parse({
    schemaVersion: 2,
    protocol: "series_pack_publication_v3",
    continuationId,
    descriptorHash,
    recoveryEpoch: phase.runtime.recoveryEpoch,
    transition: phase.scope.transition,
    effectPrefixHash: files.effectPrefixHash,
    participants: files.participants,
    admittedByOperationId: phase.operation.id,
    admittedAt: admittedAt.toISOString(),
    inverseNamespace: files.inverseNamespace,
  });
  await tx.nativePublicationCompensationContinuation.create({
    data: {
      id: continuationId,
      receiptId: receipt.id,
      transitionId: phase.scope.transition.transitionId,
      recoveryEpoch: phase.runtime.recoveryEpoch,
      mediaIds: [...phase.scope.publication.intent.mediaIds].sort(),
      assetIds: [
        ...new Set(
          phase.scope.publication.intent.entries.flatMap((item) => [
            item.entry.assetId,
            ...(item.predecessor === null ? [] : [item.predecessor.id]),
          ]),
        ),
      ].sort(),
      descriptor: z.record(z.string(), z.json()).parse(descriptor),
      descriptorHash,
      executionEvidence: z.record(z.string(), z.json()).parse(execution),
      coordinatorOperationId,
      createdAt: admittedAt,
    },
  });
  await tx.nativeRecoveryPlan.update({
    where: { id: phase.plan.id },
    data: { state: "applied", version: { increment: 1 } },
  });
  freshness.assertActive();
  return {
    continuationId,
    operationId: coordinatorOperationId,
    receiptId: receipt.id,
  };
}
