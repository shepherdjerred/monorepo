import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  type NativeCompensationDescriptorSchema,
  type NativeCompensationExecutionSchema,
  FinishedNativeCompensationSchema,
} from "#shared/native-recovery/compensation.ts";
import type {
  NativeCompensationCompletionSchema,
  NativeCompensationSelectionSchema,
} from "#shared/native-recovery/compensation-runtime.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { stableCompensationNetwork } from "./plan.ts";
import { publicationPhysicalSnapshot } from "#infrastructure/publication-proof/projection.ts";
import { assertCompensationRestoredParticipants } from "./completion-proof.ts";
import {
  FinishedCompensationPlexV3Schema,
  type CompensationPlexSelectionV3Schema,
} from "#shared/plex-binding/native-version.ts";

type RecordProof = {
  row: Prisma.NativePublicationCompensationContinuationGetPayload<{
    include: { receipt: { include: { plan: true } }; transition: true };
  }>;
  descriptor: z.infer<typeof NativeCompensationDescriptorSchema>;
  selection:
    | z.infer<typeof NativeCompensationSelectionSchema>
    | z.infer<typeof CompensationPlexSelectionV3Schema>;
  execution: z.infer<typeof NativeCompensationExecutionSchema> | null;
  completion: z.infer<typeof NativeCompensationCompletionSchema> | null;
};
export function assertCompensationRecord(proof: RecordProof) {
  assertReviewEvidence(proof);
  assertReviewAuthority(proof);
  assertExecution(proof);
  assertCompletion(proof);
}
function assertReviewEvidence({ row, descriptor, selection }: RecordProof) {
  const plan = row.receipt.plan;
  const finished = z
    .union([FinishedNativeCompensationSchema, FinishedCompensationPlexV3Schema])
    .parse(plan.plan);
  const {
    capturedAt: _capturedAt,
    workerPodUid: _worker,
    ...stableFiles
  } = selection.fileEvidence;
  if (
    plan.state !== "applied" ||
    plan.planHash !== row.receipt.planHash ||
    plan.recoveryEpoch !== row.recoveryEpoch ||
    row.receipt.recoveryEpoch !== row.recoveryEpoch ||
    snapshotHash(nativeJson(plan.plan)) !== row.receipt.planHash ||
    snapshotHash(nativeJson(plan.scope)) !== finished.scopeHash ||
    snapshotHash(nativeJson(descriptor.scope)) !== finished.scopeHash ||
    snapshotHash(nativeJson(selection.scope)) !== finished.scopeHash ||
    finished.network.identityHash !==
      snapshotHash(
        nativeJson(stableCompensationNetwork(selection.networkEvidence)),
      ) ||
    snapshotHash(nativeJson(stableFiles)) !==
      snapshotHash(nativeJson(finished.files)) ||
    snapshotHash(nativeJson(selection.fileEvidence)) !==
      snapshotHash(nativeJson(descriptor.approvedFileEvidence)) ||
    snapshotHash(nativeJson(descriptor.steps)) !==
      snapshotHash(nativeJson(selection.fileEvidence.steps)) ||
    snapshotHash(nativeJson(descriptor)) !== row.descriptorHash
  )
    throw new Error(
      "Compensation continuation parent or whole-plan binding changed",
    );
}
function assertReviewAuthority({ row, descriptor, selection }: RecordProof) {
  const authorization = selection.compensationAuthorization;
  const assets = [
    ...new Set(
      descriptor.scope.intent.entries.flatMap(({ entry }) => [
        entry.assetId,
        ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
      ]),
    ),
  ].sort();
  if (
    row.transitionId !== descriptor.scope.transition.transitionId ||
    row.transition.intentHash !== descriptor.scope.transition.intentHash ||
    authorization.continuationId !== row.id ||
    authorization.descriptorHash !== row.descriptorHash ||
    snapshotHash([...authorization.mediaIds].sort()) !==
      snapshotHash([...row.mediaIds].sort()) ||
    snapshotHash([...authorization.predecessorAssetIds].sort()) !==
      snapshotHash(descriptor.scope.files.map((file) => file.assetId).sort()) ||
    snapshotHash(
      authorization.recoveryHoldBindings.map((hold) => hold.mediaId).sort(),
    ) !== snapshotHash([...row.mediaIds].sort()) ||
    snapshotHash(nativeJson(authorization.transition)) !==
      snapshotHash(nativeJson(descriptor.scope.transition)) ||
    snapshotHash([...row.mediaIds].sort()) !==
      snapshotHash([...descriptor.scope.intent.mediaIds].sort()) ||
    snapshotHash([...row.assetIds].sort()) !== snapshotHash(assets) ||
    assets.length > 25
  )
    throw new Error(
      "Compensation continuation parent or whole-plan binding changed",
    );
}
function assertExecution({
  row,
  descriptor,
  execution,
  completion,
}: RecordProof) {
  for (const proof of [execution, completion]) {
    if (
      proof !== null &&
      (proof.continuationId !== row.id ||
        proof.descriptorHash !== row.descriptorHash ||
        proof.recoveryEpoch !== row.recoveryEpoch ||
        snapshotHash(nativeJson(proof.transition)) !==
          snapshotHash(nativeJson(descriptor.scope.transition)))
    )
      throw new Error("Compensation execution parent changed");
  }
  if (
    (row.state === "compensated") !== (completion !== null) ||
    (completion !== null &&
      (execution === null || completion.receiptId !== row.receiptId))
  )
    throw new Error("Compensation completion lacks execution authority");
  if (
    execution !== null &&
    (execution.effectPrefixHash !==
      descriptor.approvedFileEvidence.effectPrefixHash ||
      snapshotHash(nativeJson(execution.participants)) !==
        snapshotHash(nativeJson(descriptor.approvedFileEvidence.participants)))
  )
    throw new Error(
      "Compensation execution differs from reviewed physical identities",
    );
}
function assertCompletion(proof: RecordProof) {
  const { descriptor, completion } = proof;
  if (completion !== null) {
    const { reservations: releasedReservations, ...settlement } =
      descriptor.scope.interruptedWork;
    if (
      snapshotHash(nativeJson(completion.settlement)) !==
        snapshotHash(nativeJson({ ...settlement, releasedReservations })) ||
      completion.predecessorBindings.length !== descriptor.scope.files.length ||
      new Set(
        completion.predecessorBindings.map((binding) => binding.before.id),
      ).size !== descriptor.scope.files.length
    )
      throw new Error("Compensation completed whole-plan settlement changed");

    for (const binding of completion.predecessorBindings)
      assertBinding(proof, binding);
  }
}
function assertBinding(
  { row, descriptor }: RecordProof,
  binding: z.infer<
    typeof NativeCompensationCompletionSchema
  >["predecessorBindings"][number],
) {
  const file = descriptor.scope.files.find(
    (item) => item.assetId === binding.before.id,
  );
  const originalPredecessor = descriptor.scope.entries.find(
    (item) => item.predecessor?.id === binding.before.id,
  )?.predecessor;
  if (file === undefined || originalPredecessor == null)
    throw new Error(
      "Compensation completed predecessor is outside original intent",
    );
  const reviewedBefore = {
    ...originalPredecessor,
    version: file.assetVersion,
    ownershipEpoch: file.ownershipEpoch,
    subtitles: file.subtitles,
  };
  const expected = {
    ...binding.before,
    version: binding.before.version + 1,
    ownershipEpoch: row.recoveryEpoch,
    subtitles: binding.before.subtitles.map((subtitle) => ({
      ...subtitle,
      version: subtitle.version + 1,
      ownershipEpoch: row.recoveryEpoch,
      videoVersion: binding.before.version + 1,
    })),
  };
  if (
    snapshotHash(nativeJson(publicationPhysicalSnapshot(binding.before))) !==
      snapshotHash(nativeJson(publicationPhysicalSnapshot(reviewedBefore))) ||
    file.assetVersion !== binding.before.version ||
    file.checksum !== binding.before.checksum ||
    file.ownershipEpoch !== binding.before.ownershipEpoch ||
    snapshotHash(nativeJson(binding.after)) !==
      snapshotHash(nativeJson(expected))
  )
    throw new Error("Compensation completed predecessor grant changed");
  assertCompensationRestoredParticipants(
    binding.after,
    binding.participants,
    file.libraryKind,
  );
}
