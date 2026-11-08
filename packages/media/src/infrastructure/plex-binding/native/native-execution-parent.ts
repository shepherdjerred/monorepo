import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import {
  NativePlexProofParentSchema,
  type NativePlexProofParent,
} from "#shared/plex-binding/native.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import {
  assertNativeArchiveCleanupPhase,
  assertArchivePhaseTransaction,
  assertArchivePhaseCurrent,
  type ArchiveExecutionPhase,
} from "#infrastructure/native-archive/continuation.ts";
import {
  assertNativeCompensationPhase,
  assertCompensationPhaseTransaction,
  assertCompensationPhaseCurrent,
  type CompensationExecutionPhase,
} from "#infrastructure/native-compensation/guards.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { NativeReceiptReadPort } from "./receipt-port.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

type ExecutionPhase =
  | { kind: "archive"; phase: ArchiveExecutionPhase }
  | { kind: "compensation"; phase: CompensationExecutionPhase };
export type NativePlexExecutionSnapshot = ExecutionPhase & { rawHash: string };

/** Retains only the actual full locked phase from this transaction. */
export async function loadNativePlexExecutionSnapshot(
  tx: Prisma.TransactionClient,
  input: { operationId: string },
  budget: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
) {
  projection?.assertTransaction(tx, budget);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const archive = operation.kind === "cleanup_native_archive";
  if (!archive && operation.kind !== "compensate_native_publication")
    throw new Error("Unsupported native Plex execution operation");
  const payload = archive
    ? CleanupNativeArchiveInputSchema.parse(operation.payload)
    : NativeCompensationActivityInputSchema.parse(
        z
          .object({
            schemaVersion: z.literal(1),
            continuationId: z.uuid(),
            operationId: z.uuid(),
            recoveryEpoch: z.int().nonnegative(),
          })
          .parse(operation.payload),
      );
  const current: ExecutionPhase = archive
    ? {
        kind: "archive",
        phase: await assertNativeArchiveCleanupPhase(
          tx,
          CleanupNativeArchiveInputSchema.parse(operation.payload),
          budget,
          projection,
        ),
      }
    : {
        kind: "compensation",
        phase: await assertNativeCompensationPhase(
          tx,
          NativeCompensationActivityInputSchema.parse(payload),
          budget,
          projection,
        ),
      };
  const snapshot = { ...current, rawHash: executionSnapshotHash(current) };
  return {
    ...executionSnapshotParent(tx, snapshot, budget, current.phase.operation),
    snapshot,
  };
}

function executionSnapshotHash(current: ExecutionPhase) {
  return identityHash(
    nativeJson({
      kind: current.kind,
      operation: current.phase.operation,
      activity: current.phase.activity,
      authority: current.phase.authority,
      ancestors:
        current.kind === "compensation"
          ? current.phase.chain.map(({ row }) => row)
          : [],
    }),
  );
}

function executionSnapshotParent(
  tx: Prisma.TransactionClient,
  snapshot: NativePlexExecutionSnapshot,
  budget: PublicationAuthorityReadBudget,
  operation: Prisma.OperationGetPayload<Record<string, never>>,
) {
  if (
    snapshot.phase.transaction !== tx ||
    snapshot.phase.closed ||
    snapshot.phase.budget !== budget ||
    snapshot.rawHash !== executionSnapshotHash(snapshot)
  )
    throw new Error(
      "Native execution snapshot changed or belongs to another transaction/budget",
    );
  const continuation =
    snapshot.kind === "archive"
      ? assertArchivePhaseTransaction(tx, snapshot.phase).row
      : assertCompensationPhaseTransaction(tx, snapshot.phase).row;
  const scope = snapshot.phase.authority.networkScope;
  const proofParent = nativeExecutionParent(operation, continuation, scope);
  return {
    scope,
    proofParent,
    rawScope: continuation.receipt.plan.scope,
    expectedOperationResultHash:
      operation.result === null ? null : identityHash(operation.result),
  };
}

/** Immutable queried parents stay locked; unlocked knowledge is checked afresh. */
export async function assertNativePlexExecutionSnapshot(
  tx: Prisma.TransactionClient,
  snapshot: NativePlexExecutionSnapshot,
  input: {
    operation: Prisma.OperationGetPayload<Record<string, never>>;
    parent: NativePlexProofParent;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const current = executionSnapshotParent(
    tx,
    snapshot,
    input.budget,
    input.operation,
  );
  if (identityHash(current.proofParent) !== identityHash(input.parent))
    throw new PlexBindingProtection("scope_changed");
  if (snapshot.kind === "archive")
    await assertArchivePhaseCurrent(tx, snapshot.phase);
  else await assertCompensationPhaseCurrent(tx, snapshot.phase);
  executionSnapshotParent(tx, snapshot, input.budget, input.operation);
  return current;
}

export function nativeExecutionParent(
  operation: Parameters<typeof assertExecutionCommand>[1] & { id: string },
  continuation: Parameters<typeof assertExecutionCommand>[2] & {
    receipt: {
      id: string;
      planId: string;
      planHash: string;
      selection: unknown;
      plan: { scope: unknown };
    };
  },
  scope: z.infer<typeof NativeStoredScopeSchema>,
) {
  const archive = operation.kind === "cleanup_native_archive";
  if (!archive && operation.kind !== "compensate_native_publication")
    throw new Error("Unsupported native Plex execution operation");
  const proofParent = NativePlexProofParentSchema.parse({
    purpose: "native_execution",
    networkKind: archive ? "archive_cleanup_network" : "compensation_network",
    lifecycleKind: archive ? "superseded_archive" : "publication_compensation",
    operationId: operation.id,
    continuationId: continuation.id,
    descriptorHash: continuation.descriptorHash,
    networkScopeHash: identityHash(scope),
    planId: continuation.receipt.planId,
    scopeHash: identityHash(continuation.receipt.plan.scope),
    recoveryEpoch: continuation.recoveryEpoch,
    receipt: {
      receiptId: continuation.receipt.id,
      planHash: continuation.receipt.planHash,
      selectionHash: identityHash(continuation.receipt.selection),
    },
  });
  if (proofParent.purpose !== "native_execution")
    throw new Error("Native execution parent discriminator changed");
  assertExecutionCommand(proofParent, operation, continuation);
  return proofParent;
}

function assertExecutionCommand(
  parent: Extract<NativePlexProofParent, { purpose: "native_execution" }>,
  operation: {
    kind: string;
    targetId: string | null;
    userId: string | null;
    payload: unknown;
  },
  continuation: {
    id: string;
    receiptId: string;
    receipt: { actorId: string };
    coordinatorOperationId: string | null;
    descriptorHash: string;
    descriptor: unknown;
    recoveryEpoch: number;
  },
) {
  const expectedKind =
    parent.networkKind === "archive_cleanup_network"
      ? "cleanup_native_archive"
      : "compensate_native_publication";
  const payload = z
    .object({
      kind: z.literal(expectedKind),
      operationId: z.uuid(),
      continuationId: z.uuid(),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== expectedKind ||
    operation.targetId !== continuation.id ||
    operation.userId !== continuation.receipt.actorId ||
    payload.operationId !== parent.operationId ||
    payload.continuationId !== continuation.id ||
    payload.recoveryEpoch !== parent.recoveryEpoch ||
    continuation.coordinatorOperationId !== parent.operationId ||
    continuation.receiptId !== parent.receipt.receiptId ||
    continuation.descriptorHash !== parent.descriptorHash ||
    identityHash(continuation.descriptor) !== parent.descriptorHash ||
    continuation.recoveryEpoch !== parent.recoveryEpoch
  )
    throw new PlexBindingProtection("scope_changed");
}
