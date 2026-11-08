import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  SeriesPackNativeDescriptorV2Schema,
  SeriesPackNativeFinishedV4Schema,
} from "#shared/native-recovery/series-pack/evidence.ts";
import {
  SeriesPackNativeSelectionV4Schema,
  SeriesPackNativeExecutionV2Schema,
  SeriesPackNativeCompletionV2Schema,
} from "#shared/native-recovery/series-pack/runtime.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { loadSeriesPackNativeParentsV1 } from "./parents.ts";
import {
  loadSeriesPackNativePlexV1,
  seriesPackNativeNetworkIdentityV1,
} from "./plex-records.ts";
import { assertSeriesPackNativeCompletionV1 } from "./completion-validation.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";

/** Actual graph for the new family only. Never widens the old compensation reader. */
export async function readSeriesPackNativeCoreRecordV1(
  tx: Prisma.TransactionClient,
  id: string,
  budget: PublicationAuthorityReadBudget,
) {
  const row =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id },
      include: { receipt: { include: { plan: true } } },
    });
  budget.consume(3);
  const descriptor = SeriesPackNativeDescriptorV2Schema.parse(row.descriptor);
  const selection = SeriesPackNativeSelectionV4Schema.parse(
    row.receipt.selection,
  );
  const finished = SeriesPackNativeFinishedV4Schema.parse(
    row.receipt.plan.plan,
  );
  const scope = descriptor.scope;
  const plan = row.receipt.plan;
  const authorization = selection.compensationAuthorization;
  const assertApprovalGraph1 = () => {
    if (
      row.id !== plan.id ||
      // Future namespace is genuinely reviewed before it can exist.
      row.recoveryEpoch !== scope.request.recoveryEpoch ||
      row.receipt.recoveryEpoch !== row.recoveryEpoch ||
      plan.recoveryEpoch !== row.recoveryEpoch ||
      plan.state !== "applied" ||
      plan.planHash !== row.receipt.planHash ||
      identityHash(plan.plan) !== row.receipt.planHash ||
      row.descriptorHash !== identityHash(row.descriptor)
    )
      throw new Error(
        "Native pack descriptor lost its actual whole owner approval graph",
      );
  };
  assertApprovalGraph1();
  const assertApprovalGraph2 = () => {
    if (
      authorization.descriptorHash !== row.descriptorHash ||
      authorization.descriptorRaw !==
        canonicalJson(z.json().parse(row.descriptor)) ||
      selection.finishedRaw !== canonicalJson(z.json().parse(plan.plan)) ||
      authorization.continuationId !== row.id ||
      row.receiptId !== row.receipt.id ||
      identityHash(scope) !== finished.scopeHash ||
      identityHash(selection.scope) !== finished.scopeHash ||
      identityHash(plan.scope) !== finished.scopeHash
    )
      throw new Error(
        "Native pack descriptor lost its actual whole owner approval graph",
      );
  };
  assertApprovalGraph2();
  const assertApprovalGraph3 = () => {
    if (
      row.transitionId !== scope.publication.transitionId ||
      identityHash([...row.mediaIds].sort()) !==
        identityHash([...scope.publication.intent.mediaIds].sort()) ||
      identityHash([...row.assetIds].sort()) !==
        identityHash(
          [
            ...new Set(
              scope.publication.intent.entries.flatMap((item) => [
                item.entry.assetId,
                ...(item.predecessor === null ? [] : [item.predecessor.id]),
              ]),
            ),
          ].sort(),
        ) ||
      identityHash([...authorization.mediaIds].sort()) !==
        identityHash([...row.mediaIds].sort()) ||
      identityHash([...authorization.predecessorAssetIds].sort()) !==
        identityHash(scope.files.map((file) => file.assetId).sort()) ||
      identityHash(selection.fileEvidence) !==
        identityHash(descriptor.approvedFileEvidence) ||
      identityHash(descriptor.steps) !==
        identityHash(selection.fileEvidence.steps)
    )
      throw new Error(
        "Native pack descriptor lost its actual whole owner approval graph",
      );
  };
  assertApprovalGraph3();
  const {
    capturedAt: _capturedAt,
    workerPodUid: _worker,
    ...stableFiles
  } = selection.fileEvidence;
  if (identityHash(stableFiles) !== identityHash(finished.files))
    throw new Error("Native pack approved physical proof changed");
  const publication = await loadSeriesPackPublicationRecordV1(
    tx,
    scope.publication.intent.attemptId,
    budget,
  );
  if (
    publication?.outcome !== null ||
    identityHash(publication.reference) !== identityHash(scope.publication)
  )
    throw new Error(
      "Native pack descriptor lost its original immutable v3 ancestry",
    );
  const queried = { transaction: tx, budget, plan };
  const approved = await loadSeriesPackNativePlexV1(
    tx,
    selection.plex.approved,
    queried,
  );
  const applied = await loadSeriesPackNativePlexV1(
    tx,
    selection.plex.applied,
    queried,
  );
  const assertApprovalPair1 = () => {
    if (
      approved.row.id === applied.row.id ||
      approved.row.operationId === applied.row.operationId ||
      approved.row.operation.kind !==
        "prepare_series_pack_native_compensation_v1" ||
      applied.row.operation.kind !==
        "apply_series_pack_native_compensation_v1" ||
      approved.batch.identityHash !== applied.batch.identityHash ||
      approved.batch.identityHash !== finished.networkIdentityHash ||
      identityHash(selection.networkEvidence) !==
        identityHash(applied.network) ||
      identityHash(seriesPackNativeNetworkIdentityV1(applied.network)) !==
        finished.networkIdentityHash
    )
      throw new Error(
        "Native pack approval is not the real distinct preparation/apply pair",
      );
  };
  assertApprovalPair1();
  const execution =
    row.executionEvidence === null
      ? null
      : SeriesPackNativeExecutionV2Schema.parse(row.executionEvidence);
  const completion =
    row.completion === null
      ? null
      : SeriesPackNativeCompletionV2Schema.parse(row.completion);
  if (execution === null)
    throw new Error(
      "Native pack immutable admission or terminal identity changed",
    );
  const assertAdmission1 = () => {
    if (
      execution.continuationId !== row.id ||
      execution.descriptorHash !== row.descriptorHash ||
      execution.recoveryEpoch !== row.recoveryEpoch ||
      execution.admittedByOperationId !== applied.row.operationId ||
      execution.effectPrefixHash !==
        descriptor.approvedFileEvidence.effectPrefixHash ||
      identityHash(execution.participants) !==
        identityHash(descriptor.approvedFileEvidence.participants) ||
      identityHash(execution.inverseNamespace) !==
        identityHash(descriptor.approvedFileEvidence.inverseNamespace) ||
      Date.parse(execution.admittedAt) < applied.row.createdAt.getTime()
    )
      throw new Error(
        "Native pack immutable admission or terminal identity changed",
      );
  };
  assertAdmission1();
  const assertAdmission2 = () => {
    if (
      Date.parse(execution.admittedAt) > row.createdAt.getTime() ||
      (row.state === "compensated") !== (completion !== null)
    )
      throw new Error(
        "Native pack immutable admission or terminal identity changed",
      );
  };
  assertAdmission2();
  if (
    completion !== null &&
    (completion.continuationId !== row.id ||
      completion.receiptId !== row.receiptId ||
      completion.descriptorHash !== row.descriptorHash ||
      completion.recoveryEpoch !== row.recoveryEpoch ||
      identityHash(completion.transition) !== identityHash(scope.transition))
  )
    throw new Error("Native pack terminal completion parent changed");
  const executionPlex =
    completion === null
      ? null
      : await loadSeriesPackNativePlexV1(tx, completion.executionPlex, queried);
  const assertCompletedExecutionPair = () => {
    if (
      executionPlex !== null &&
      (executionPlex.ref.parent.purpose !== "native_execution" ||
        executionPlex.ref.parent.continuationId !== row.id ||
        executionPlex.ref.parent.descriptorHash !== row.descriptorHash ||
        executionPlex.ref.parent.operationId !== row.coordinatorOperationId ||
        executionPlex.batch.identityHash !== finished.networkIdentityHash)
    )
      throw new Error(
        "Native pack completed receipt lost its actual execution paired parent",
      );
  };
  assertCompletedExecutionPair();
  const record = {
    transaction: tx,
    budget,
    row,
    descriptor,
    selection,
    finished,
    publication,
    approved,
    applied,
    execution,
    completion,
    executionPlex,
  };
  assertSeriesPackNativeCompletionV1(record);
  return record;
}

/** Physical replay needs the actual original preparation and forward parents;
 * completed serving consumers instead resolve the actual whole native receipt.
 * Both variants pay every queried parent and never fabricate deeper ancestry. */
export async function readSeriesPackNativeRecordV1(
  tx: Prisma.TransactionClient,
  id: string,
  budget: PublicationAuthorityReadBudget,
) {
  const core = await readSeriesPackNativeCoreRecordV1(tx, id, budget);
  const graph = await loadSeriesPackNativeParentsV1(
    tx,
    core.publication.reference.intent.attemptId,
    budget,
    core,
  );
  if (
    identityHash(
      graph.forward.map((item) => ({
        operationId: item.operationId,
        batchIndex: item.command.batchIndex,
        commandHash: item.commandHash,
        completionHash: item.completionHash,
      })),
    ) !== identityHash(core.descriptor.scope.forwardParents)
  )
    throw new Error(
      "Native pack physical receipt lost actual completed forward ancestry",
    );
  return { ...core, graph };
}

export type SeriesPackNativeRecordV1 = Awaited<
  ReturnType<typeof readSeriesPackNativeRecordV1>
>;
