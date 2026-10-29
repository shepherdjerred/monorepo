import { z } from "zod";
import type { Prisma, RetentionDecision } from "#generated/prisma/client.ts";
import type { PlexPhysicalGroup } from "#shared/plex-binding/contract.ts";
import type { QuarantinePlexRef } from "#shared/plex-binding/watch.ts";
import {
  NativeQuarantineBindingSchema,
  NativeQuarantineContinuationSchema,
  NativeQuarantineScopeSchema,
} from "#shared/native-recovery/quarantine.ts";
import { FinishedNativeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import {
  NativePlexPolicyBindingSchema,
  QuarantinePlexStableFilesSchema,
  QuarantinePlexStableNetworkSchema,
} from "#shared/plex-binding/native-projections.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { validateNativePlexReceipt } from "./native-version.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

const LegacySelection = z.strictObject({
  scope: NativeQuarantineScopeSchema,
  bindings: z.array(NativeQuarantineBindingSchema).min(1).max(25),
  fileEvidence: QuarantinePlexStableFilesSchema,
  networkEvidence: QuarantinePlexStableNetworkSchema,
  policies: z.array(NativePlexPolicyBindingSchema).max(100),
});
type Row = Prisma.NativeQuarantineContinuationGetPayload<{
  include: { receipt: { include: { plan: true } } };
}>;
type Descriptor = z.infer<typeof NativeQuarantineContinuationSchema>;

/** Exact pending grants may rebind quarantined bytes; restoration or unknown effects cannot. */
export async function quarantinePlexRebindings(
  tx: Prisma.TransactionClient,
  input: {
    original: PlexPhysicalGroup;
    current: PlexPhysicalGroup;
    decisionId: string;
  },
  budget: PublicationAuthorityReadBudget,
): Promise<QuarantinePlexRef["nativeReceipts"]> {
  const { original, current } = input;
  if (
    identityHash({
      ...current,
      assetVersion: original.assetVersion,
      ownershipEpoch: original.ownershipEpoch,
    }) !== identityHash(original)
  )
    throw new PlexBindingProtection("ownership_changed");
  let version = current.assetVersion,
    epoch = current.ownershipEpoch;
  if (
    version === original.assetVersion + 1 &&
    epoch === original.ownershipEpoch
  )
    return [];
  const rows = await tx.nativeQuarantineContinuation.findMany({
    where: {
      descriptor: {
        path: ["group", "decisions"],
        array_contains: [{ id: input.decisionId }],
      },
    },
    include: { receipt: { include: { plan: true } } },
    take: budget.takeWeighted(3),
  });
  budget.consume(rows.length * 3);
  const candidates = rows.map((row) => ({
    row,
    descriptor: NativeQuarantineContinuationSchema.parse(row.descriptor),
  }));
  const refs = new Map<string, QuarantinePlexRef["nativeReceipts"][number]>();
  while (version > original.assetVersion + 1) {
    const matches = candidates.filter(({ descriptor }) =>
      descriptor.bindings.some(
        (binding) =>
          binding.assetId === original.assetId &&
          binding.assetVersion === version &&
          binding.ownershipEpoch === epoch,
      ),
    );
    const match = matches[0];
    if (match === undefined || matches.length !== 1 || refs.has(match.row.id))
      throw new PlexBindingProtection("reconciliation_required");
    const { row, descriptor } = match;
    await assertPendingReceipt(tx, row, descriptor, budget);
    const file = descriptor.files.find(
      (value) => value.assetId === original.assetId,
    );
    if (
      file?.checksum !== original.checksum ||
      file.sizeBytes !== original.sizeBytes ||
      file.canonicalPath !== original.canonicalPath ||
      identityHash([...file.mediaIds].sort()) !==
        identityHash(original.coverage.map((scope) => scope.mediaId))
    )
      throw new Error(
        "Quarantine native binding changed the original physical group",
      );
    const decision = descriptor.group.decisions.find(
      (value) => value.id === input.decisionId,
    );
    if (decision === undefined)
      throw new Error(
        "Quarantine native descriptor omitted its original decision",
      );
    const currentDecision = await tx.retentionDecision.findUniqueOrThrow({
      where: { id: decision.id },
    });
    budget.consume(1);
    assertOriginalDecision(currentDecision, decision);
    refs.set(row.id, {
      receiptId: row.receiptId,
      planHash: row.receipt.planHash,
      selectionHash: identityHash(row.receipt.selection),
      continuationId: row.id,
      descriptorHash: identityHash(row.descriptor),
      bindingHash: identityHash(descriptor.bindings),
    });
    version = file.assetVersion;
    epoch = file.ownershipEpoch;
  }
  if (
    version !== original.assetVersion + 1 ||
    epoch !== original.ownershipEpoch
  )
    throw new PlexBindingProtection("reconciliation_required");
  return [...refs.values()].sort((a, b) =>
    a.continuationId.localeCompare(b.continuationId),
  );
}

async function assertPendingReceipt(
  tx: Prisma.TransactionClient,
  row: Row,
  descriptor: Descriptor,
  budget: PublicationAuthorityReadBudget,
) {
  const { receipt } = row,
    { plan } = receipt;
  if (
    row.state !== "pending" ||
    row.executionEvidence !== null ||
    row.restoration !== null
  )
    throw new PlexBindingProtection("reconciliation_required");
  if (
    plan.state !== "applied" ||
    plan.planHash !== receipt.planHash ||
    identityHash(plan.plan) !== receipt.planHash ||
    receipt.recoveryEpoch !== row.recoveryEpoch ||
    plan.recoveryEpoch !== receipt.recoveryEpoch ||
    receipt.actorId !== plan.actorId ||
    row.groupHash !== descriptor.group.groupHash
  )
    throw new Error("Quarantine native receipt parent changed");
  const current = await validateNativePlexReceipt(tx, receipt, budget);
  let selection: z.infer<typeof LegacySelection>;
  if (current === null) {
    const finished = FinishedNativeV2Schema.parse(plan.plan);
    selection = LegacySelection.parse(receipt.selection);
    if (
      finished.lifecycleKind !== "committed_quarantine" ||
      finished.scopeHash !== identityHash(plan.scope) ||
      identityHash(finished.files) !== identityHash(selection.fileEvidence) ||
      identityHash(finished.network) !== identityHash(selection.networkEvidence)
    )
      throw new Error("Quarantine legacy finished evidence changed");
  } else {
    if (current.selection.lifecycleKind !== "committed_quarantine")
      throw new Error("Quarantine native receipt has a different lifecycle");
    selection = current.selection;
  }
  assertDescriptorSelection(row, descriptor, selection);
}

function assertOriginalDecision(
  current: RetentionDecision,
  decision: Descriptor["group"]["decisions"][number],
) {
  if (
    current.mediaId !== decision.mediaId ||
    current.version < decision.version ||
    current.generation !== decision.generation ||
    identityHash(current.manifest) !== decision.manifestHash ||
    identityHash(decision.manifest) !== decision.manifestHash ||
    identityHash(current.evidence) !== identityHash(decision.evidence) ||
    current.quarantinedAt?.toISOString() !== decision.quarantinedAt ||
    current.purgeAfter?.toISOString() !== decision.purgeAfter
  )
    throw new Error(
      "Quarantine native descriptor lost its original decision history",
    );
}

function assertDescriptorSelection(
  row: Row,
  descriptor: Descriptor,
  selection: z.infer<typeof LegacySelection>,
) {
  const { plan } = row.receipt;
  const selectedFiles = selection.scope.files.filter((file) =>
    descriptor.group.assetIds.includes(file.assetId),
  );
  const selectedBindings = selection.bindings.filter((binding) =>
    descriptor.group.assetIds.includes(binding.assetId),
  );
  const participants = selection.fileEvidence.participants.filter(
    (participant) => descriptor.group.assetIds.includes(participant.assetId),
  );
  const journals = selection.fileEvidence.groupJournals.find(
    (group) => group.groupHash === descriptor.group.groupHash,
  )?.journals;
  if (
    identityHash(selection.scope) !== identityHash(plan.scope) ||
    !selection.scope.groups.some(
      (group) => identityHash(group) === identityHash(descriptor.group),
    ) ||
    identityHash(descriptor.files) !== identityHash(selectedFiles) ||
    identityHash(descriptor.bindings) !== identityHash(selectedBindings) ||
    identityHash(descriptor.participants) !== identityHash(participants) ||
    identityHash(descriptor.journals) !== identityHash(journals) ||
    descriptor.files.length !== descriptor.group.assetIds.length ||
    descriptor.bindings.length !== descriptor.files.length
  )
    throw new Error(
      "Quarantine native descriptor differs from its immutable selection",
    );
  for (const file of descriptor.files) {
    const expected = {
      assetId: file.assetId,
      beforeVersion: file.assetVersion,
      assetVersion: file.assetVersion + 1,
      checksum: file.checksum,
      mediaIds: file.mediaIds,
      ownershipEpoch: row.recoveryEpoch,
      subtitles: file.subtitles.map((subtitle) => ({
        id: subtitle.id,
        version: subtitle.version + 1,
        videoVersion: file.assetVersion + 1,
        checksum: subtitle.checksum,
        storageKind: subtitle.storageKind,
      })),
    };
    const binding = descriptor.bindings.find(
      (value) => value.assetId === file.assetId,
    );
    if (identityHash(binding) !== identityHash(expected))
      throw new Error("Quarantine native before/after binding changed");
  }
}
