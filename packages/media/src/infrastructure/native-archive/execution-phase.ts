import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveExecutionSchema,
  NativeArchiveCompletionSchema,
} from "#shared/native-recovery/archive.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  assertArchivePhaseTransaction,
  assertArchivePhaseCurrent,
  type ArchiveExecutionPhase,
} from "./continuation.ts";
import {
  assertArchiveImmutableCompletion,
  archiveCompletionDependency,
} from "./completion.ts";
import { archiveClosure } from "./closure.ts";

function writerPhase(
  tx: Prisma.TransactionClient,
  phase: ArchiveExecutionPhase,
  freshness: PlexBindingFreshness,
  budget: PublicationAuthorityReadBudget,
) {
  const authority = assertArchivePhaseTransaction(tx, phase);
  if (
    phase.budget !== budget ||
    phase.plex === null ||
    freshness.expiresAtMs > phase.plex.expiresAtMs
  )
    throw new Error(
      "Archive writer requires its exact phase and original deadline",
    );
  freshness.assertActive();
  return authority;
}

export async function persistArchivePhaseExecution(
  tx: Prisma.TransactionClient,
  raw: z.infer<typeof NativeArchiveExecutionSchema>,
  phase: ArchiveExecutionPhase,
  {
    freshness,
    budget,
  }: {
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
  },
): Promise<void> {
  const authority = writerPhase(tx, phase, freshness, budget);
  const execution = NativeArchiveExecutionSchema.parse(raw);
  const edge = authority.descriptor.scope.edges.find(
    (item) => item.id === authority.row.originalCleanupId && item.selected,
  );
  if (
    edge === undefined ||
    execution.continuationId !== authority.row.id ||
    execution.descriptorHash !== authority.row.descriptorHash ||
    execution.recoveryEpoch !== authority.row.recoveryEpoch
  )
    throw new Error("Archive execution belongs to another authority");
  if (
    execution.participants.length !== edge.derivedPlan.files.length ||
    edge.derivedPlan.files.some(
      (file) =>
        execution.participants.filter(
          (item) =>
            item.assetId === edge.assetId &&
            item.subtitleId === file.subtitleId &&
            item.libraryKind === edge.derivedPlan.libraryKind &&
            item.location === file.location &&
            item.id === file.id &&
            item.canonicalPath === file.path &&
            item.checksum === file.checksum,
        ).length !== 1,
    )
  )
    throw new Error(
      "Archive execution omitted or changed a physical participant",
    );
  for (const participant of execution.participants) {
    const file = authority.descriptor.fileEvidence.files.find(
      (item) => item.assetId === participant.assetId,
    );
    const physical =
      participant.subtitleId === null
        ? file
        : file?.subtitles.find((item) => item.id === participant.subtitleId);
    if (
      physical?.sizeBytes !== participant.sizeBytes ||
      snapshotHash(nativeJson(physical.identity)) !==
        snapshotHash(nativeJson(participant.identity))
    )
      throw new Error(
        "Archive execution changed its reviewed physical identity",
      );
  }
  if (authority.row.executionEvidence !== null) {
    if (
      snapshotHash(z.json().parse(authority.row.executionEvidence)) !==
      snapshotHash(nativeJson(execution))
    )
      throw new Error("Archive persisted execution changed");
    return;
  }
  await assertArchivePhaseCurrent(tx, phase);
  const executionEvidence = z.record(z.string(), z.json()).parse(execution);
  await writePhase(
    tx,
    phase,
    { executionEvidence, version: authority.row.version + 1 },
    { freshness, budget },
  );
}

/** Files owns the already-locked exact asset/subtitle transition and supplies its literal completion. */
export async function commitArchivePhaseCompletion(
  tx: Prisma.TransactionClient,
  raw: z.infer<typeof NativeArchiveCompletionSchema>,
  phase: ArchiveExecutionPhase,
  {
    freshness,
    budget,
  }: {
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
  },
): Promise<void> {
  const authority = writerPhase(tx, phase, freshness, budget);
  const completion = NativeArchiveCompletionSchema.parse(raw);
  const completionValue = z.record(z.string(), z.json()).parse(completion);
  await assertArchivePhaseCurrent(tx, phase);
  const candidate = {
    ...authority.row,
    state: "cleaned",
    completion: completionValue,
  };
  assertArchiveImmutableCompletion(candidate);
  const closure = await archiveClosure(
    tx,
    authority.descriptor.scope.request.cleanupIds,
  );
  const cleanup = closure.cleanups.find(
    (item) => item.id === authority.row.originalCleanupId,
  );
  const old = closure.assets.find(
    (item) => item.id === completion.asset.assetId,
  );
  const successor =
    cleanup === undefined
      ? undefined
      : closure.assets.find((item) => item.id === cleanup.successorAssetId);
  if (cleanup === undefined || old === undefined || successor === undefined)
    throw new Error("Archive completed physical group changed");
  assertCompletedAsset(old, authority, completion);
  archiveCompletionDependency(candidate, cleanup, old, successor);
  freshness.assertActive();
  await writePhase(
    tx,
    phase,
    {
      state: "cleaned",
      completion: completionValue,
      version: authority.row.version + 1,
    },
    { freshness, budget },
  );
  phase.closed = true;
}

type ContinuationPatch = {
  executionEvidence?: Prisma.InputJsonObject;
  completion?: Prisma.InputJsonObject;
  state?: string;
  version?: number;
};
async function writePhase(
  tx: Prisma.TransactionClient,
  phase: ArchiveExecutionPhase,
  patch: ContinuationPatch,
  {
    freshness,
    budget,
  }: {
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { row } = assertArchivePhaseTransaction(tx, phase);
  freshness.assertActive();
  const changed = await tx.nativeArchiveCleanupContinuation.updateMany({
    where: {
      id: row.id,
      version: row.version,
      state: row.state,
      recoveryEpoch: phase.activity.recoveryEpoch,
      coordinatorOperationId: phase.activity.operationId,
      descriptorHash: row.descriptorHash,
      receiptId: row.receiptId,
    },
    data: patch,
  });
  if (changed.count !== 1)
    throw new Error("Archive own-write compare-and-swap changed");
  const current = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: row.id },
  });
  budget.consume(1);
  freshness.assertActive();
  const { receipt: _receipt, updatedAt: _beforeTime, ...before } = row;
  const { updatedAt: _afterTime, ...after } = current;
  if (
    snapshotHash(nativeJson({ ...before, ...patch })) !==
    snapshotHash(nativeJson(after))
  )
    throw new Error(
      "Archive own-write readback differs from its exact transition",
    );
  phase.authority.row = { ...row, ...current };
}

function assertCompletedAsset(
  old: Awaited<ReturnType<typeof archiveClosure>>["assets"][number],
  authority: ArchiveExecutionPhase["authority"],
  completion: z.infer<typeof NativeArchiveCompletionSchema>,
) {
  const selected = authority.networkScope.files.find(
    (item) => item.assetId === old.id,
  );
  if (
    selected?.role !== "selected_archive" ||
    old.state !== "purged" ||
    !old.owned ||
    old.version !== selected.assetVersion + 1 ||
    old.version !== completion.asset.assetVersion ||
    old.ownershipEpoch !== selected.ownershipEpoch ||
    old.path !== selected.canonicalPath ||
    old.checksum !== selected.checksum ||
    old.sourcePath !== selected.sourcePath ||
    old.edition !== selected.edition ||
    old.editionRootId !== selected.editionRootId ||
    old.supersededByAssetId !== selected.supersededByAssetId ||
    old.sizeBytes.toString() !== selected.sizeBytes ||
    snapshotHash(z.json().parse(old.properties)) !==
      snapshotHash(selected.properties) ||
    snapshotHash(
      old.coverage.map(({ mediaId, edition, current }) => ({
        mediaId,
        edition,
        current,
      })),
    ) !== snapshotHash(selected.coverage)
  )
    throw new Error(
      "Archive completion differs from the exact owned physical transition",
    );
}
