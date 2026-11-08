import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import {
  NativePlexParentSchema,
  NativePlexProofParentSchema,
  NativePlexProofRefSchema,
  type NativePlexProofParent,
  type NativePlexProofRef,
} from "#shared/plex-binding/native.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { CleanupNativeArchiveInput } from "#shared/native-recovery/archive.ts";
import {
  assertNativeArchiveCleanupPhase,
  assertArchivePhaseTransaction,
} from "#infrastructure/native-archive/continuation.ts";
import {
  assertNativeCompensationPhase,
  assertCompensationPhaseTransaction,
} from "#infrastructure/native-compensation/guards.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  loadNativeCompensationPlexBatch,
  loadNativeArchivePlexBatch,
} from "./native.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import type { NativeReceiptReadPort } from "./receipt-port.ts";
import {
  loadNativePlexExecutionSnapshot,
  nativeExecutionParent,
} from "./native-execution-parent.ts";

const kinds = {
  published: ["prepare_native_recovery", "apply_native_recovery"],
  committed_quarantine: [
    "prepare_native_quarantine",
    "apply_native_quarantine",
  ],
  superseded_archive: ["prepare_native_archive", "apply_native_archive"],
  publication_compensation: [
    "prepare_native_compensation",
    "apply_native_compensation",
  ],
} as const;

/** Process-local result of a full locked snapshot, usable only in its originating transaction. */
export type NativePlexReviewSnapshot = {
  transaction: Prisma.TransactionClient;
  plan: Prisma.NativeRecoveryPlanGetPayload<Record<string, never>>;
  scope: z.infer<typeof NativeStoredScopeSchema>;
};

/** Resolves identity only; the existing lifecycle snapshot guard remains mandatory. */
export async function loadNativePlexReviewParent(
  tx: Prisma.TransactionClient,
  input: { planId: string; operationId: string },
  budget = new PublicationAuthorityReadBudget(),
) {
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  budget.consume(1);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  return { ...nativePlexReviewParent(plan, operation, input), plan };
}

/** Exact command checks shared by queried discovery and final locked persistence. */
export function nativePlexReviewParent(
  plan: Prisma.NativeRecoveryPlanGetPayload<Record<string, never>>,
  operation: Prisma.OperationGetPayload<Record<string, never>>,
  input: { planId: string; operationId: string },
) {
  const scopeHash = identityHash(plan.scope);
  const scope = NativeStoredScopeSchema.parse(plan.scope);
  const lifecycleKind =
    scope.schemaVersion === 1 ? "published" : scope.lifecycleKind;
  const allowed = kinds[lifecycleKind];
  const apply = operation.kind === allowed[1];
  const common = z.strictObject({
    planId: z.uuid(),
    operationId: z.uuid(),
    kind: z.enum(allowed),
    recoveryEpoch: z.int().nonnegative(),
  });
  const payload = apply
    ? common
        .extend({
          planHash: z.string().regex(/^[a-f0-9]{64}$/u),
          actorId: z.uuid(),
        })
        .parse(operation.payload)
    : common.parse(operation.payload);
  if (
    plan.id !== input.planId ||
    operation.id !== input.operationId ||
    operation.targetId !== plan.id ||
    operation.userId !== plan.actorId ||
    payload.planId !== plan.id ||
    payload.operationId !== operation.id ||
    payload.kind !== operation.kind ||
    payload.recoveryEpoch !== plan.recoveryEpoch ||
    !["preparing", "awaiting_review", "applying"].includes(plan.state)
  )
    throw new PlexBindingProtection("scope_changed");
  if (
    apply &&
    (!("planHash" in payload) ||
      !("actorId" in payload) ||
      payload.actorId !== plan.actorId ||
      payload.actorId !== operation.userId ||
      payload.planHash !== plan.planHash ||
      identityHash(plan.plan) !== plan.planHash)
  )
    throw new Error("Native Plex apply plan hash changed");
  const parent = NativePlexParentSchema.parse({
    planId: plan.id,
    scopeHash,
    recoveryEpoch: plan.recoveryEpoch,
    lifecycleKind,
    scope,
  });
  const proofParent = NativePlexProofParentSchema.parse({
    planId: input.planId,
    operationId: input.operationId,
    scopeHash,
    recoveryEpoch: plan.recoveryEpoch,
    lifecycleKind,
    purpose: "native_review",
    networkKind: "network",
  });
  return {
    parent,
    proofParent,
    rawScope: plan.scope,
    expectedOperationResultHash:
      operation.result === null ? null : identityHash(operation.result),
  };
}

export async function assertNativePlexOperationParent(
  tx: Prisma.TransactionClient,
  parent: NativePlexProofParent,
  budget = new PublicationAuthorityReadBudget(),
  options: {
    snapshot?: NativePlexReviewSnapshot | undefined;
    projection?: NativeReceiptReadPort | undefined;
  } = {},
) {
  const { snapshot, projection } = options;
  projection?.assertTransaction(tx, budget);
  if (parent.purpose === "native_review") {
    await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${parent.operationId} FOR UPDATE`;
    const current =
      snapshot === undefined
        ? await loadNativePlexReviewParent(tx, parent, budget)
        : await assertQueriedNativeReviewParent(tx, parent, snapshot, budget);
    if (identityHash(current.proofParent) !== identityHash(parent))
      throw new PlexBindingProtection("scope_changed");
    return {
      scope: current.parent.scope,
      rawScope: current.rawScope,
      plan: current.plan,
    };
  }
  const current = await loadNativePlexExecutionParent(
    tx,
    { operationId: parent.operationId },
    budget,
    projection,
  );
  if (identityHash(current.proofParent) !== identityHash(parent))
    throw new PlexBindingProtection("scope_changed");
  return { scope: current.scope, rawScope: current.rawScope };
}

/** The lifecycle already holds the plan and full snapshot locks; command/pointer stay fresh. */
async function assertQueriedNativeReviewParent(
  tx: Prisma.TransactionClient,
  parent: NativePlexProofParent,
  snapshot: NativePlexReviewSnapshot,
  budget: PublicationAuthorityReadBudget,
) {
  if (
    snapshot.transaction !== tx ||
    snapshot.plan.id !== parent.planId ||
    identityHash(snapshot.plan.scope) !== identityHash(snapshot.scope)
  )
    throw new Error(
      "Native reviewed plan belongs to another transaction or scope",
    );
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: parent.operationId },
  });
  budget.consume(1);
  return {
    ...nativePlexReviewParent(snapshot.plan, operation, parent),
    plan: snapshot.plan,
  };
}

/** The operation selects the existing guard; no caller supplies purpose or effective scope. */
export async function loadNativePlexExecutionParent(
  tx: Prisma.TransactionClient,
  input: { operationId: string },
  budget = new PublicationAuthorityReadBudget(),
  projection?: NativeReceiptReadPort,
) {
  const { snapshot: _snapshot, ...parent } =
    await loadNativePlexExecutionSnapshot(tx, input, budget, projection);
  return parent;
}

/** A fresh full phase on every call; only its exact pinned operation proof may be consumed. */
export async function loadNativeCompensationPlexPhase(
  tx: Prisma.TransactionClient,
  activity: NativeCompensationActivityInput,
  input: { freshness: PlexBindingFreshness; expectedRef?: NativePlexProofRef },
  budget: PublicationAuthorityReadBudget,
) {
  input.freshness.assertActive();
  const phase = await assertNativeCompensationPhase(tx, activity, budget);
  input.freshness.assertActive();
  if (phase.authority.completion !== null) return { phase, proof: null };
  const record = assertCompensationPhaseTransaction(tx, phase);
  const parent = nativeExecutionParent(
    phase.operation,
    record.row,
    phase.authority.networkScope,
  );
  const pointer = z
    .object({ nativePlexProof: NativePlexProofRefSchema })
    .parse(phase.operation.result).nativePlexProof;
  if (
    input.expectedRef !== undefined &&
    identityHash(pointer) !== identityHash(input.expectedRef)
  )
    throw new PlexBindingProtection("scope_changed");
  const proof = await loadNativeCompensationPlexBatch(tx, pointer, parent, {
    freshness: input.freshness,
    budget,
    phase,
  });
  if (
    input.expectedRef !== undefined &&
    input.freshness.expiresAtMs > proof.expiresAtMs
  )
    throw new PlexBindingProtection("verification_expired");
  const deadline = {
    expiresAtMs: Math.min(input.freshness.expiresAtMs, proof.expiresAtMs),
    assertActive: () => {
      input.freshness.assertActive();
      if (Date.now() >= proof.expiresAtMs)
        throw new PlexBindingProtection("verification_expired");
    },
  };
  await bindPlexTransactionDeadline(tx, deadline);
  deadline.assertActive();
  phase.plex = { ref: proof.ref, expiresAtMs: deadline.expiresAtMs };
  return { phase, proof };
}

/** Fresh archive phase with its original exact operation proof; never switches A to B. */
export async function loadNativeArchivePlexPhase(
  tx: Prisma.TransactionClient,
  activity: CleanupNativeArchiveInput,
  input: { freshness: PlexBindingFreshness; expectedRef?: NativePlexProofRef },
  budget: PublicationAuthorityReadBudget,
) {
  input.freshness.assertActive();
  const phase = await assertNativeArchiveCleanupPhase(tx, activity, budget);
  const authority = assertArchivePhaseTransaction(tx, phase);
  input.freshness.assertActive();
  const parent = nativeExecutionParent(
    phase.operation,
    authority.row,
    authority.networkScope,
  );
  const pointer = z
    .object({ nativePlexProof: NativePlexProofRefSchema })
    .parse(phase.operation.result).nativePlexProof;
  if (
    input.expectedRef !== undefined &&
    identityHash(pointer) !== identityHash(input.expectedRef)
  )
    throw new PlexBindingProtection("scope_changed");
  const proof = await loadNativeArchivePlexBatch(tx, pointer, parent, {
    freshness: input.freshness,
    budget,
    phase,
  });
  if (
    input.expectedRef !== undefined &&
    input.freshness.expiresAtMs > proof.expiresAtMs
  )
    throw new PlexBindingProtection("verification_expired");
  const deadline = {
    expiresAtMs: Math.min(input.freshness.expiresAtMs, proof.expiresAtMs),
    assertActive: () => {
      input.freshness.assertActive();
      if (Date.now() >= proof.expiresAtMs)
        throw new PlexBindingProtection("verification_expired");
    },
  };
  await bindPlexTransactionDeadline(tx, deadline);
  deadline.assertActive();
  phase.plex = { ref: proof.ref, expiresAtMs: deadline.expiresAtMs };
  return { phase, proof };
}
