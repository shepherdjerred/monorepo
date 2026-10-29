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
import {
  assertNativeCompensationPhase,
  assertCompensationPhaseCurrent,
  assertCompensationPhaseTransaction,
  type CompensationExecutionAuthority,
  type CompensationExecutionPhase,
} from "./guards.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { assertCompensationRestoredParticipants } from "./completion-proof.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";

type ExecutionInput = {
  activity: NativeCompensationActivityInput;
  execution: NativeCompensationExecution;
};
type CompletionInput = {
  activity: NativeCompensationActivityInput;
  completion: NativeCompensationCompletion;
};
type PhaseWriteOptions = {
  freshness: PlexBindingFreshness;
  budget: PublicationAuthorityReadBudget;
};
type WriteOptions = {
  freshness?: PlexBindingFreshness | undefined;
  budget: PublicationAuthorityReadBudget;
};

export async function persistCompensationExecution(
  tx: Prisma.TransactionClient,
  input: ExecutionInput,
  budget = new PublicationAuthorityReadBudget(),
): Promise<void> {
  const phase = await assertNativeCompensationPhase(tx, input.activity, budget);
  return persistExecution(tx, input, phase, { budget });
}

export async function persistCompensationPhaseExecution(
  tx: Prisma.TransactionClient,
  input: ExecutionInput,
  phase: CompensationExecutionPhase,
  { freshness, budget }: PhaseWriteOptions,
): Promise<void> {
  freshness.assertActive();
  assertPairedWriterPhase(tx, phase, freshness, budget);
  return persistExecution(tx, input, phase, { budget, freshness });
}

async function persistExecution(
  tx: Prisma.TransactionClient,
  input: ExecutionInput,
  phase: CompensationExecutionPhase,
  { budget, freshness }: WriteOptions,
): Promise<void> {
  const record = assertWriterPhase(tx, input.activity, phase);
  const authority = phase.authority;
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
  await assertCompensationPhaseCurrent(tx, phase);
  freshness?.assertActive();
  const changed = await tx.nativePublicationCompensationContinuation.updateMany(
    {
      where: phaseWhere(phase),
      data: {
        executionEvidence: z.record(z.string(), z.json()).parse(execution),
        state: "compensating",
        version: { increment: 1 },
      },
    },
  );
  if (changed.count !== 1)
    throw new Error("Compensation execution compare-and-swap changed");
  const current = await readPhaseWrite(
    tx,
    phase,
    {
      executionEvidence: z.record(z.string(), z.json()).parse(execution),
      state: "compensating",
      version: record.row.version + 1,
    },
    { budget, freshness },
  );
  record.row = { ...record.row, ...current };
  record.execution = execution;
  authority.version = current.version;
  authority.execution = execution;
}

export async function commitNativeCompensation(
  tx: Prisma.TransactionClient,
  input: CompletionInput,
  budget = new PublicationAuthorityReadBudget(),
): Promise<void> {
  const phase = await assertNativeCompensationPhase(tx, input.activity, budget);
  return commitCompletion(tx, input, phase, { budget });
}

export async function commitCompensationPhaseCompletion(
  tx: Prisma.TransactionClient,
  input: CompletionInput,
  phase: CompensationExecutionPhase,
  { freshness, budget }: PhaseWriteOptions,
): Promise<void> {
  freshness.assertActive();
  assertPairedWriterPhase(tx, phase, freshness, budget);
  return commitCompletion(tx, input, phase, { budget, freshness });
}

async function commitCompletion(
  tx: Prisma.TransactionClient,
  input: CompletionInput,
  phase: CompensationExecutionPhase,
  { budget, freshness }: WriteOptions,
): Promise<void> {
  const record = assertWriterPhase(tx, input.activity, phase);
  const authority = phase.authority;
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
  await assertCompensationPhaseCurrent(tx, phase);
  freshness?.assertActive();
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
    record.original,
    { budget: phase.budget, parent: record.queriedParent },
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
  freshness?.assertActive();
  const changed = await tx.nativePublicationCompensationContinuation.updateMany(
    {
      where: phaseWhere(phase),
      data: {
        completion: z.record(z.string(), z.json()).parse(completion),
        state: "compensated",
        version: { increment: 1 },
      },
    },
  );
  if (changed.count !== 1)
    throw new Error("Compensation completion compare-and-swap changed");
  await readPhaseWrite(
    tx,
    phase,
    {
      completion: z.record(z.string(), z.json()).parse(completion),
      state: "compensated",
      version: authority.version + 1,
    },
    { budget, freshness },
  );
  phase.closed = true;
}

function assertWriterPhase(
  tx: Prisma.TransactionClient,
  input: NativeCompensationActivityInput,
  phase: CompensationExecutionPhase,
) {
  const record = assertCompensationPhaseTransaction(tx, phase);
  if (snapshotHash(input) !== snapshotHash(phase.activity))
    throw new Error("Compensation write changed the phase command");
  return record;
}

function assertPairedWriterPhase(
  tx: Prisma.TransactionClient,
  phase: CompensationExecutionPhase,
  freshness: PlexBindingFreshness,
  budget: PublicationAuthorityReadBudget,
) {
  assertCompensationPhaseTransaction(tx, phase);
  if (
    phase.budget !== budget ||
    phase.plex === null ||
    freshness.expiresAtMs > phase.plex.expiresAtMs
  )
    throw new Error(
      "Compensation writer requires the phase's original budget and Plex deadline",
    );
}

function phaseWhere(phase: CompensationExecutionPhase) {
  const row = phase.chain[0]?.row;
  if (row === undefined) throw new Error("Compensation phase record missing");
  return {
    id: row.id,
    version: row.version,
    state: row.state,
    coordinatorOperationId: phase.activity.operationId,
    recoveryEpoch: phase.activity.recoveryEpoch,
    descriptorHash: row.descriptorHash,
    receiptId: row.receiptId,
  };
}

async function readPhaseWrite(
  tx: Prisma.TransactionClient,
  phase: CompensationExecutionPhase,
  patch: Partial<
    Pick<
      Prisma.NativePublicationCompensationContinuationGetPayload<
        Record<string, never>
      >,
      "executionEvidence" | "completion" | "state" | "version"
    >
  >,
  { budget, freshness }: WriteOptions,
) {
  freshness?.assertActive();
  const record = assertCompensationPhaseTransaction(tx, phase);
  const current =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: record.row.id },
    });
  budget.consume(1);
  freshness?.assertActive();
  const {
    receipt: _receipt,
    transition: _transition,
    updatedAt: _beforeTime,
    ...before
  } = record.row;
  const { updatedAt: _afterTime, ...after } = current;
  if (
    snapshotHash(nativeJson({ ...before, ...patch })) !==
    snapshotHash(nativeJson(after))
  )
    throw new Error(
      "Compensation own-write readback differs from its exact transition",
    );
  return current;
}

async function assertPredecessorBindings(
  tx: Prisma.TransactionClient,
  authority: CompensationExecutionAuthority,
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
