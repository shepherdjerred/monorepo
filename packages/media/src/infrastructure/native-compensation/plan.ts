import type { z } from "zod";
import { createHash } from "node:crypto";
import {
  NativeCompensationFileEvidenceSchema,
  NativeCompensationNetworkEvidenceSchema,
  type NativeCompensationScope,
} from "#shared/native-recovery/compensation.ts";
import {
  PublicationEffectSchema,
  type PublicationEffect,
} from "#shared/publication-proof/effects.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  stableCompensationFiles as projectFiles,
  stableCompensationNetwork as projectNetwork,
} from "#shared/plex-binding/native-projections.ts";

export function stableCompensationFiles(raw: unknown) {
  return projectFiles(raw);
}
export function stableCompensationNetwork(raw: unknown) {
  return projectNetwork(raw);
}

export function assertCompensationEvidence(
  scope: NativeCompensationScope,
  rawFiles: unknown,
  rawNetwork: unknown,
  approvedAncestorPrefix: readonly PublicationEffect[] = [],
) {
  const files = NativeCompensationFileEvidenceSchema.parse(rawFiles);
  const network = NativeCompensationNetworkEvidenceSchema.parse(rawNetwork);
  const previous = scope.previousCompensation;
  if (
    files.transitionId !== scope.transition.transitionId ||
    files.intentHash !== scope.transition.intentHash ||
    files.recoveryEpoch !== scope.request.recoveryEpoch ||
    network.recoveryEpoch !== scope.request.recoveryEpoch ||
    files.planId !== network.planId ||
    (previous === null
      ? network.previousWorkflowClosed !== null
      : network.previousWorkflowClosed?.operationId !==
        previous.coordinatorOperationId)
  )
    throw new Error(
      "Compensation evidence scope or terminal coordinator changed",
    );
  if (
    network.previousWorkflowClosed !== null &&
    (Date.parse(network.previousWorkflowClosed.observedAt) > Date.now() ||
      Date.parse(network.previousWorkflowClosed.observedAt) <
        Date.parse(network.capturedAt))
  )
    throw new Error("Compensation terminal workflow observation is not fresh");
  assertAcknowledgedPrefix(scope, files, approvedAncestorPrefix);
  const participantKeys = files.participants.map(
    (item) => `${item.libraryKind}:${item.physical.root}:${item.physical.path}`,
  );
  if (
    new Set(participantKeys).size !== participantKeys.length ||
    files.participants.some(
      (item) =>
        !scope.entries.some(
          (entry) =>
            entry.entry.libraryKind === item.libraryKind &&
            [entry.entry.assetId, entry.entry.previousAssetId].includes(
              item.assetId,
            ),
        ),
    )
  )
    throw new Error("Compensation physical participant set is inconsistent");
  if (
    new Set(files.steps.map((step) => step.operationId)).size !==
      files.steps.length ||
    files.steps.some(
      (step) =>
        !scope.entries.some(
          (entry) =>
            entry.entry.operationId === step.entryOperationId &&
            entry.entry.libraryKind === step.libraryKind &&
            [entry.entry.assetId, entry.entry.previousAssetId].includes(
              step.assetId,
            ),
        ),
    )
  )
    throw new Error("Compensation inverse step set is inconsistent");
  return { files, network };
}

function assertAcknowledgedPrefix(
  scope: NativeCompensationScope,
  files: z.infer<typeof NativeCompensationFileEvidenceSchema>,
  approvedAncestorPrefix: readonly PublicationEffect[],
) {
  const previous = scope.previousCompensation;
  let prior: string | null = null;
  if (
    approvedAncestorPrefix.length > files.acknowledgedEffects.length ||
    (previous === null && approvedAncestorPrefix.length > 0)
  )
    throw new Error("Compensation ancestor acknowledged prefix is missing");
  for (const [ordinal, raw] of files.acknowledgedEffects.entries()) {
    const effect = PublicationEffectSchema.parse(raw);
    const ancestorEffect = approvedAncestorPrefix[ordinal];
    if (
      effect.ordinal !== ordinal ||
      effect.previousEffectHash !== prior ||
      effect.transitionId !== scope.transition.transitionId ||
      effect.intentHash !== scope.transition.intentHash ||
      (ancestorEffect === undefined
        ? effect.continuationId !== (previous?.continuationId ?? null)
        : JSON.stringify(effect) !== JSON.stringify(ancestorEffect)) ||
      !scope.entries.some(
        (item) =>
          item.entry.operationId === effect.entryOperationId &&
          item.entry.libraryKind === effect.libraryKind &&
          [item.entry.assetId, item.entry.previousAssetId].includes(
            effect.assetId,
          ),
      )
    )
      throw new Error(
        "Compensation acknowledged effect prefix is not the exact transition chain",
      );
    prior = createHash("sha256").update(JSON.stringify(effect)).digest("hex");
  }
  if (
    files.effectPrefixHash !==
    snapshotHash(nativeJson(files.acknowledgedEffects))
  )
    throw new Error("Compensation reviewed effect prefix digest changed");
}
