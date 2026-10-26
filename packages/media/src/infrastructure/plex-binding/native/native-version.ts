import type { Prisma } from "#generated/prisma/client.ts";
import {
  FinishedNativePlexV3Schema,
  type FinishedNativePlexV3,
} from "#shared/plex-binding/native-version.ts";
import type { NativePlexProofRef } from "#shared/plex-binding/native.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { loadNativePlexProofBatch } from "./native.ts";
import {
  parseNativePlexReceipt,
  assertNativeReceiptPair,
  nativeFinishedNetwork,
} from "./native-evidence.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type NativePlexApprovalInput = {
  planId: string;
  approved: NativePlexProofRef;
  applied: NativePlexProofRef;
};

/** Historical dispatch is explicit: null leaves the literal v1/v2 consumer unchanged. */
export async function readNativePlexReceipt(
  tx: Prisma.TransactionClient,
  receiptId: string,
  budget = new PublicationAuthorityReadBudget(),
) {
  const receipt = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: receiptId },
    include: { plan: true },
  });
  budget.consume(2);
  return validateNativePlexReceipt(tx, receipt, budget);
}

/** Reuses the caller's exact queried parent; no second receipt lookup or historical projection rewrite. */
export async function validateNativePlexReceipt(
  tx: Prisma.TransactionClient,
  receipt: Prisma.NativeRecoveryReceiptGetPayload<{ include: { plan: true } }>,
  budget = new PublicationAuthorityReadBudget(),
) {
  const record = parseNativePlexReceipt(receipt);
  if (record === null) return null;
  const { selection } = record;
  const approved = await loadNativePlexProofBatch(
    tx,
    selection.plex.approved,
    selection.plex.approved.parent,
    { budget, queriedPlan: { transaction: tx, budget, plan: receipt.plan } },
  );
  const applied = await loadNativePlexProofBatch(
    tx,
    selection.plex.applied,
    selection.plex.applied.parent,
    { budget, queriedPlan: { transaction: tx, budget, plan: receipt.plan } },
  );
  assertNativeReceiptPair(record, approved, applied);
  return { ...record, approved, applied };
}

/** Fresh apply resolves the exact approved batch and independently produced apply batch. */
export async function assertNativePlexApproval(
  tx: Prisma.TransactionClient,
  input: NativePlexApprovalInput,
  freshness: PlexBindingFreshness,
  options: {
    budget?: PublicationAuthorityReadBudget;
    queried?:
      | {
          transaction: Prisma.TransactionClient;
          budget: PublicationAuthorityReadBudget;
          plan: Prisma.NativeRecoveryPlanGetPayload<Record<string, never>>;
          applied: Awaited<ReturnType<typeof loadNativePlexProofBatch>>;
        }
      | undefined;
  } = {},
) {
  const { budget = new PublicationAuthorityReadBudget(), queried } = options;
  if (
    queried !== undefined &&
    (queried.transaction !== tx ||
      queried.budget !== budget ||
      queried.plan.id !== input.planId ||
      identityHash(queried.applied.ref) !== identityHash(input.applied))
  )
    throw new Error(
      "Native approval projection belongs to another transaction or proof",
    );
  const plan =
    queried?.plan ??
    (await tx.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: input.planId },
    }));
  if (queried === undefined) budget.consume(1);
  freshness.assertActive();
  if (plan.planHash === null)
    throw new Error("Native v3 approval has no finished hash");
  const finished = parsePlexRecord(
    FinishedNativePlexV3Schema,
    plan.plan,
    plan.planHash,
  );
  assertApprovalPlan(plan, finished, input);
  const approved = await loadNativePlexProofBatch(
    tx,
    input.approved,
    input.approved.parent,
    { budget: budget },
  );
  const applied =
    queried?.applied ??
    (await loadNativePlexProofBatch(tx, input.applied, input.applied.parent, {
      freshness: freshness,
      budget: budget,
    }));
  if (freshness.expiresAtMs > applied.expiresAtMs)
    throw new Error(
      "Native apply guard exceeds its original paired proof expiry",
    );
  assertReviewPair(approved, applied, finished.lifecycleKind);
  if (
    approved.batch.identityHash !== applied.batch.identityHash ||
    identityHash(nativeFinishedNetwork(applied.ref.parent, applied.network)) !==
      identityHash(finished.network)
  )
    throw new Error("Native v3 fresh apply differs from approved identity");
  freshness.assertActive();
  return { finished, approved, applied };
}

function assertApprovalPlan(
  plan: Prisma.NativeRecoveryPlanGetPayload<Record<string, never>>,
  finished: FinishedNativePlexV3,
  input: NativePlexApprovalInput,
) {
  if (
    plan.state !== "applying" ||
    plan.expiresAt === null ||
    plan.expiresAt.getTime() <= Date.now() ||
    identityHash(finished.plex) !== identityHash(input.approved) ||
    finished.scopeHash !== identityHash(plan.scope) ||
    input.approved.parent.planId !== plan.id ||
    input.applied.parent.planId !== plan.id ||
    input.approved.parent.purpose !== "native_review" ||
    input.applied.parent.purpose !== "native_review" ||
    input.approved.parent.scopeHash !== input.applied.parent.scopeHash ||
    input.approved.parent.recoveryEpoch !==
      input.applied.parent.recoveryEpoch ||
    input.applied.parent.recoveryEpoch !== plan.recoveryEpoch
  )
    throw new Error("Native v3 approval parent changed or expired");
}

export async function finishNativePlexPlan(
  tx: Prisma.TransactionClient,
  input: {
    planId: string;
    plex: NativePlexProofRef;
    files: FinishedNativePlexV3["files"];
  },
  freshness: PlexBindingFreshness,
  budget = new PublicationAuthorityReadBudget(),
): Promise<FinishedNativePlexV3> {
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  budget.consume(1);
  if (
    plan.state !== "preparing" ||
    plan.planHash !== null ||
    input.plex.parent.purpose !== "native_review" ||
    input.plex.parent.planId !== plan.id ||
    input.plex.parent.scopeHash !== identityHash(plan.scope) ||
    input.plex.parent.recoveryEpoch !== plan.recoveryEpoch
  )
    throw new Error("Native v3 finish has a foreign proof parent");
  const proof = await loadNativePlexProofBatch(
    tx,
    input.plex,
    input.plex.parent,
    { freshness: freshness, budget: budget },
  );
  if (freshness.expiresAtMs > proof.expiresAtMs)
    throw new Error(
      "Native finish guard exceeds its original paired proof expiry",
    );
  if (proof.operationKind !== reviewKinds[input.plex.parent.lifecycleKind][0])
    throw new Error("Native finished proof is not its preparation operation");
  const finished = FinishedNativePlexV3Schema.parse({
    schemaVersion: 3,
    lifecycleKind: input.plex.parent.lifecycleKind,
    scopeHash: input.plex.parent.scopeHash,
    plex: input.plex,
    network: nativeFinishedNetwork(proof.ref.parent, proof.network),
    files: input.files,
  });
  freshness.assertActive();
  return finished;
}

const reviewKinds = {
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

function assertReviewPair(
  approved: Awaited<ReturnType<typeof loadNativePlexProofBatch>>,
  applied: Awaited<ReturnType<typeof loadNativePlexProofBatch>>,
  lifecycle: FinishedNativePlexV3["lifecycleKind"],
) {
  const kinds = reviewKinds[lifecycle];
  if (
    approved.operationKind !== kinds[0] ||
    applied.operationKind !== kinds[1] ||
    approved.ref.parent.operationId === applied.ref.parent.operationId ||
    approved.ref.batchId === applied.ref.batchId
  )
    throw new Error(
      "Native Plex review pair lost its distinct prepare/apply operations",
    );
}
