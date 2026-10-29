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
import type { NativePlexProofRef } from "#shared/plex-binding/native.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  FinishedCompensationPlexV3Schema,
  CompensationPlexSelectionV3Schema,
} from "#shared/plex-binding/native-version.ts";
import {
  assertNativePlexApproval,
  finishNativePlexPlan,
} from "#infrastructure/plex-binding/native/native-version.ts";
import { loadNativePlexProofBatch } from "#infrastructure/plex-binding/native/native.ts";
import { compensationRecord } from "./records.ts";
import { compensationPreviousEffects } from "./scope.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  stableCompensationFiles,
  stableCompensationNetwork,
  assertCompensationEvidence,
} from "./plan.ts";

type ApprovalInput = {
  activity: NativeCompensationApplyInput;
  scope: NativeCompensationScope;
  evidence: NativeCompensationFileEvidence;
  plex?: { ref: NativePlexProofRef; freshness: PlexBindingFreshness };
};

async function existingApproval(
  tx: Prisma.TransactionClient,
  input: ApprovalInput,
  command: { operation: Operation; actorId: string; recoveryEpoch: number },
  budget: PublicationAuthorityReadBudget,
): Promise<string | null> {
  const previous = await tx.nativeRecoveryReceipt.findUnique({
    where: { planId: input.activity.planId },
  });
  if (previous === null) return null;
  budget.consume(1);
  const selection = z
    .union([
      NativeCompensationSelectionSchema,
      CompensationPlexSelectionV3Schema,
    ])
    .parse(previous.selection);
  const settled = await compensationRecord(
    tx,
    selection.compensationAuthorization.continuationId,
    budget,
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

async function currentNetwork(
  tx: Prisma.TransactionClient,
  planId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const observation = await tx.nativeRecoveryObservation.findFirstOrThrow({
    where: { planId, kind: "network" },
    orderBy: { createdAt: "desc" },
  });
  budget.consume(1);
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
    plex: { ref: NativePlexProofRef; freshness: PlexBindingFreshness };
  },
  budget = new PublicationAuthorityReadBudget(),
): Promise<void> {
  const { plan, projection } = await assertNativeCompensationSnapshot(
    tx,
    {
      planId: input.activity.planId,
      scope: input.scope,
    },
    budget,
  );
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.activity.operationId },
  });
  budget.consume(1);
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
  if (input.plex.ref.parent.operationId !== input.activity.operationId)
    throw new Error("Compensation preparation Plex coordinator changed");
  const paired = await loadNativePlexProofBatch(
    tx,
    input.plex.ref,
    input.plex.ref.parent,
    { freshness: input.plex.freshness, budget: budget },
  );
  const network = NativeCompensationNetworkEvidenceSchema.parse(paired.network);
  const checked = assertCompensationEvidence(
    input.scope,
    input.evidence,
    network,
    compensationPreviousEffects(tx, input.scope, projection, budget),
  );
  const finished = await finishNativePlexPlan(
    tx,
    {
      planId: plan.id,
      plex: input.plex.ref,
      files: stableCompensationFiles(checked.files),
    },
    input.plex.freshness,
    budget,
  );
  if (finished.lifecycleKind !== "publication_compensation")
    throw new Error("Compensation preparation Plex lifecycle changed");
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
  input.plex.freshness.assertActive();
}

function approvalCommand(operation: Operation, input: ApprovalInput) {
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
  return payload;
}

export async function applyCompensationApproval(
  tx: Prisma.TransactionClient,
  context: NativeFileContext,
  input: ApprovalInput,
  budget = new PublicationAuthorityReadBudget(),
): Promise<string> {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.activity.operationId },
  });
  budget.consume(1);
  const payload = approvalCommand(operation, input);
  const previous = await existingApproval(
    tx,
    input,
    {
      operation,
      actorId: payload.actorId,
      recoveryEpoch: payload.recoveryEpoch,
    },
    budget,
  );
  if (previous !== null) return previous;
  await assertNativeOwner(tx, payload.actorId);
  const { plan, runtime, projection } = await assertNativeCompensationSnapshot(
    tx,
    {
      planId: input.activity.planId,
      scope: input.scope,
    },
    budget,
  );
  if (
    plan.state !== "applying" ||
    plan.planHash !== input.activity.planHash ||
    plan.expiresAt === null ||
    plan.expiresAt <= new Date() ||
    snapshotHash(nativeJson(plan.plan)) !== plan.planHash
  )
    throw new Error("Compensation approval is missing, changed or expired");
  const finished = z
    .union([FinishedNativeCompensationSchema, FinishedCompensationPlexV3Schema])
    .parse(plan.plan);
  const paired =
    finished.schemaVersion === 3
      ? await compensationApprovalPlex(tx, input, finished.plex, budget)
      : null;
  const network =
    paired === null
      ? await currentNetwork(tx, plan.id, budget)
      : NativeCompensationNetworkEvidenceSchema.parse(paired.applied.network);
  const { files } = assertCompensationEvidence(
    input.scope,
    input.evidence,
    network,
    compensationPreviousEffects(tx, input.scope, projection, budget),
  );
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
  const rawSelection = {
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
  };
  const selection =
    paired === null
      ? NativeCompensationSelectionSchema.parse(rawSelection)
      : CompensationPlexSelectionV3Schema.parse({
          ...rawSelection,
          schemaVersion: 3,
          lifecycleKind: "publication_compensation",
          plex: { approved: paired.approved.ref, applied: paired.applied.ref },
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
  input.plex?.freshness.assertActive();
  return receipt.id;
}

async function compensationApprovalPlex(
  tx: Prisma.TransactionClient,
  input: ApprovalInput,
  approved: NativePlexProofRef,
  budget: PublicationAuthorityReadBudget,
) {
  if (input.plex?.ref.parent.operationId !== input.activity.operationId)
    throw new Error("Compensation apply requires its exact paired Plex proof");
  return assertNativePlexApproval(
    tx,
    { planId: input.activity.planId, approved, applied: input.plex.ref },
    input.plex.freshness,
    { budget: budget },
  );
}
