import { Prisma, type Operation } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  FinishedNativeCompensationSchema,
  NativeCompensationDescriptorSchema,
  NativeCompensationNetworkEvidenceSchema,
  type NativeCompensationScope,
  type NativeCompensationFileEvidence,
} from "#shared/native-recovery/compensation.ts";
import {
  NativeCompensationSelectionSchema,
  type NativeCompensationApplyInput,
  type NativeCompensationPrepareInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import {
  assertNativeEvidenceFresh,
  installNativeAuthority,
} from "#automation/native-recovery/authority.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { queueOperation } from "#automation/store.ts";
import { assertNativeCompensationSnapshot } from "./guards.ts";
import { compensationRecord } from "./records.ts";
import {
  stableCompensationFiles,
  stableCompensationNetwork,
  assertCompensationEvidence,
} from "./plan.ts";

type ApprovalInput = {
  activity: NativeCompensationApplyInput;
  scope: NativeCompensationScope;
  evidence: NativeCompensationFileEvidence;
};

async function previousEffects(
  tx: Prisma.TransactionClient,
  scope: NativeCompensationScope,
) {
  if (scope.previousCompensation === null) return [];
  const previous = await compensationRecord(
    tx,
    scope.previousCompensation.continuationId,
  );
  return previous.descriptor.approvedFileEvidence.acknowledgedEffects;
}

async function existingApproval(
  tx: Prisma.TransactionClient,
  input: ApprovalInput,
  command: { operation: Operation; actorId: string; recoveryEpoch: number },
): Promise<string | null> {
  const previous = await tx.nativeRecoveryReceipt.findUnique({
    where: { planId: input.activity.planId },
  });
  if (previous === null) return null;
  const selection = NativeCompensationSelectionSchema.parse(previous.selection);
  const settled = await compensationRecord(
    tx,
    selection.compensationAuthorization.continuationId,
  );
  if (
    command.operation.idempotencyKey !==
      `native-compensation-apply:${input.activity.planId}:${input.activity.planHash}` ||
    previous.planHash !== input.activity.planHash ||
    previous.actorId !== command.actorId ||
    previous.recoveryEpoch !== command.recoveryEpoch ||
    previous.previousRuntimeVersion !== input.scope.request.runtimeVersion ||
    previous.runtimeVersion !== previous.previousRuntimeVersion + 1 ||
    settled.row.receiptId !== previous.id ||
    settled.row.receipt.planId !== input.activity.planId ||
    snapshotHash(nativeJson(selection.scope)) !==
      snapshotHash(nativeJson(input.scope)) ||
    snapshotHash(nativeJson(selection.fileEvidence)) !==
      snapshotHash(nativeJson(input.evidence))
  )
    throw new Error("Compensation approval receipt changed");
  return previous.id;
}

async function currentNetwork(tx: Prisma.TransactionClient, planId: string) {
  const observation = await tx.nativeRecoveryObservation.findFirstOrThrow({
    where: { planId, kind: "network" },
    orderBy: { createdAt: "desc" },
  });
  if (
    observation.evidenceHash !==
      snapshotHash(nativeJson(observation.evidence)) ||
    observation.expiresAt <= new Date()
  )
    throw new Error("Compensation network observation changed or expired");
  const network = NativeCompensationNetworkEvidenceSchema.parse(
    observation.evidence,
  );
  assertNativeEvidenceFresh(network);
  return network;
}

/** Files owns ordered PG/path locks and fresh process-local proofs around this final commit. */
export async function finishCompensationPreparation(
  tx: Prisma.TransactionClient,
  input: {
    activity: NativeCompensationPrepareInput;
    scope: NativeCompensationScope;
    evidence: NativeCompensationFileEvidence;
  },
): Promise<void> {
  const { plan } = await assertNativeCompensationSnapshot(tx, {
    planId: input.activity.planId,
    scope: input.scope,
  });
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.activity.operationId },
  });
  const payload = z
    .object({ planId: z.uuid(), recoveryEpoch: z.int() })
    .parse(operation.payload);
  if (
    operation.kind !== "prepare_native_compensation" ||
    operation.targetId !== plan.id ||
    operation.userId !== plan.actorId ||
    payload.planId !== plan.id ||
    payload.recoveryEpoch !== plan.recoveryEpoch
  )
    throw new Error("Compensation preparation coordinator changed");
  await assertNativeOwner(tx, plan.actorId);
  if (plan.state === "awaiting_review") return;
  if (plan.state !== "preparing")
    throw new Error("Compensation preparation state changed");
  const network = await currentNetwork(tx, plan.id);
  const checked = assertCompensationEvidence(
    input.scope,
    input.evidence,
    network,
    await previousEffects(tx, input.scope),
  );
  const finished = FinishedNativeCompensationSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "publication_compensation",
    scopeHash: snapshotHash(nativeJson(input.scope)),
    network: {
      identityHash: snapshotHash(
        nativeJson(stableCompensationNetwork(network)),
      ),
    },
    files: stableCompensationFiles(checked.files),
  });
  await tx.nativeRecoveryObservation.create({
    data: {
      planId: plan.id,
      kind: "files",
      evidenceHash: snapshotHash(nativeJson(checked.files)),
      evidence: z.record(z.string(), z.json()).parse(checked.files),
      observedAt: new Date(checked.files.capturedAt),
      expiresAt: new Date(Date.now() + 12 * 3_600_000),
    },
  });
  await tx.nativeRecoveryPlan.update({
    where: { id: plan.id },
    data: {
      state: "awaiting_review",
      plan: z.record(z.string(), z.json()).parse(finished),
      planHash: snapshotHash(nativeJson(finished)),
      expiresAt: new Date(Date.now() + 12 * 3_600_000),
      version: { increment: 1 },
    },
  });
  assertNativeEvidenceFresh(network);
}

export async function applyCompensationApproval(
  tx: Prisma.TransactionClient,
  context: NativeFileContext,
  input: ApprovalInput,
): Promise<string> {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.activity.operationId },
  });
  const payload = z
    .object({
      actorId: z.uuid(),
      planId: z.uuid(),
      planHash: z.string(),
      recoveryEpoch: z.int(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== "apply_native_compensation" ||
    operation.targetId !== input.activity.planId ||
    operation.userId !== payload.actorId ||
    payload.planId !== input.activity.planId ||
    payload.planHash !== input.activity.planHash ||
    payload.recoveryEpoch !== input.scope.request.recoveryEpoch
  )
    throw new Error("Compensation approval operation changed");
  const previous = await existingApproval(tx, input, {
    operation,
    actorId: payload.actorId,
    recoveryEpoch: payload.recoveryEpoch,
  });
  if (previous !== null) return previous;
  await assertNativeOwner(tx, payload.actorId);
  const { plan, runtime } = await assertNativeCompensationSnapshot(tx, {
    planId: input.activity.planId,
    scope: input.scope,
  });
  if (
    plan.state !== "applying" ||
    plan.planHash !== input.activity.planHash ||
    plan.expiresAt === null ||
    plan.expiresAt <= new Date() ||
    snapshotHash(nativeJson(plan.plan)) !== plan.planHash
  )
    throw new Error("Compensation approval is missing, changed or expired");
  const network = await currentNetwork(tx, plan.id);
  const { files } = assertCompensationEvidence(
    input.scope,
    input.evidence,
    network,
    await previousEffects(tx, input.scope),
  );
  const finished = FinishedNativeCompensationSchema.parse(plan.plan);
  if (
    finished.scopeHash !== snapshotHash(nativeJson(input.scope)) ||
    snapshotHash(nativeJson(finished.files)) !==
      snapshotHash(nativeJson(stableCompensationFiles(files))) ||
    finished.network.identityHash !==
      snapshotHash(nativeJson(stableCompensationNetwork(network)))
  )
    throw new Error(
      "Compensation reviewed physical or network identity changed",
    );
  await installNativeAuthority(tx, context, { scope: input.scope, network });
  assertNativeEvidenceFresh(network);
  const continuationId = crypto.randomUUID();
  const descriptor = NativeCompensationDescriptorSchema.parse({
    schemaVersion: 1,
    allowedAction: "compensate",
    scope: input.scope,
    approvedFileEvidence: files,
    steps: files.steps,
  });
  const descriptorHash = snapshotHash(nativeJson(descriptor));
  const recoveryHoldBindings = [];
  for (const mediaId of input.scope.intent.mediaIds) {
    const hold = await tx.recoveryHold.upsert({
      where: targetWhere(defaultScope(mediaId)),
      create: {
        mediaId,
        recoveryEpoch: runtime.recoveryEpoch,
        reason: "recovery_request_history_unconfirmed",
      },
      update: {
        recoveryEpoch: runtime.recoveryEpoch,
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
    where: { id: "singleton" },
    data: {
      mode: "active",
      ownershipConfirmed: true,
      version: { increment: 1 },
    },
  });
  const selection = NativeCompensationSelectionSchema.parse({
    scope: input.scope,
    fileEvidence: files,
    networkEvidence: network,
    bindings: [],
    compensationAuthorization: {
      continuationId,
      transition: input.scope.transition,
      allowedAction: "compensate",
      mediaIds: input.scope.intent.mediaIds,
      predecessorAssetIds: input.scope.files.map((file) => file.assetId),
      descriptorHash,
      recoveryHoldBindings,
    },
  });
  const receipt = await tx.nativeRecoveryReceipt.create({
    data: {
      planId: plan.id,
      planHash: input.activity.planHash,
      recoveryEpoch: runtime.recoveryEpoch,
      previousRuntimeVersion: runtime.version,
      runtimeVersion: runtime.version + 1,
      actorId: payload.actorId,
      selection: z.record(z.string(), z.json()).parse(selection),
    },
  });
  const assetIds = [
    ...new Set(
      input.scope.intent.entries.flatMap(({ entry }) => [
        entry.assetId,
        ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
      ]),
    ),
  ].sort();
  await tx.nativePublicationCompensationContinuation.create({
    data: {
      id: continuationId,
      receiptId: receipt.id,
      transitionId: input.scope.transition.transitionId,
      recoveryEpoch: runtime.recoveryEpoch,
      mediaIds: input.scope.intent.mediaIds,
      assetIds,
      descriptor: z.record(z.string(), z.json()).parse(descriptor),
      descriptorHash,
    },
  });
  const coordinator = await queueOperation(tx, {
    key: `native-compensation:${continuationId}`,
    kind: "compensate_native_publication",
    targetId: continuationId,
    userId: payload.actorId,
    payload: {
      schemaVersion: 1,
      continuationId,
      recoveryEpoch: runtime.recoveryEpoch,
    },
  });
  await tx.nativePublicationCompensationContinuation.update({
    where: { id: continuationId },
    data: { coordinatorOperationId: coordinator },
  });
  await tx.nativeRecoveryPlan.update({
    where: { id: plan.id },
    data: { state: "applied", version: { increment: 1 } },
  });
  assertNativeEvidenceFresh(network);
  return receipt.id;
}
