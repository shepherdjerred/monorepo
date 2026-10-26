import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  NativePlexProofRefSchema,
  NativePlexProofBatchSchema,
  NativePlexNetworkEnvelopeSchema,
  NativePlexProofParentSchema,
  type NativePlexProofRef,
  type NativePlexProofParent,
} from "#shared/plex-binding/native.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import {
  parseNativePlexNetwork,
  nativePlexIdentityHash,
  parseNativePlexReceipt,
  assertNativeReceiptPair,
  readExecutionNativeReceipt,
  assertExecutionReceiptParent,
} from "./native-evidence.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertNativePlexObservation } from "./native-observation.ts";
import { assertNativeEffectiveScope } from "./native-effective.ts";
import type { NativeReceiptReadPort } from "./receipt-port.ts";
import {
  queryNativeBatch,
  type QueriedNativePlan,
  type NativeBatchRow as BatchRow,
  type CompensationBatchPhase,
  type ArchiveBatchPhase,
} from "./native-query.ts";

type BatchContext = {
  freshness: PlexBindingFreshness | undefined;
  budget: PublicationAuthorityReadBudget;
  phase?: CompensationBatchPhase | ArchiveBatchPhase;
  receiptProjection?: NativeReceiptReadPort | undefined;
  queriedPlan?: QueriedNativePlan;
};

export async function loadNativePlexProofBatch(
  tx: Prisma.TransactionClient,
  rawRef: NativePlexProofRef,
  rawParent: NativePlexProofParent,
  options: {
    freshness?: PlexBindingFreshness | undefined;
    budget?: PublicationAuthorityReadBudget;
    receiptProjection?: NativeReceiptReadPort | undefined;
    queriedPlan?: QueriedNativePlan;
  } = {},
) {
  const {
    freshness,
    budget = new PublicationAuthorityReadBudget(),
    receiptProjection,
    queriedPlan,
  } = options;
  return loadProofBatch(tx, rawRef, rawParent, {
    freshness,
    budget,
    receiptProjection,
    ...(queriedPlan === undefined ? {} : { queriedPlan }),
  });
}

/** Same-transaction compensation closure already validated by the full locked guard. */
export async function loadNativeCompensationPlexBatch(
  tx: Prisma.TransactionClient,
  rawRef: NativePlexProofRef,
  rawParent: NativePlexProofParent,
  options: {
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
    phase: CompensationBatchPhase;
  },
) {
  const { freshness, budget, phase } = options;
  if (
    phase.transaction !== tx ||
    phase.closed ||
    phase.budget !== budget ||
    rawParent.purpose !== "native_execution" ||
    rawParent.lifecycleKind !== "publication_compensation" ||
    rawParent.continuationId !== phase.authority.continuationId ||
    rawParent.operationId !== phase.operation.id ||
    rawParent.networkScopeHash !== identityHash(phase.authority.networkScope)
  )
    throw new Error(
      "Native compensation batch requires its exact current transaction phase",
    );
  const record = phase.chain[0];
  if (record === undefined)
    throw new Error("Compensation phase has no receipt parent");
  return loadProofBatch(tx, rawRef, rawParent, {
    freshness,
    budget,
    phase,
    queriedPlan: {
      transaction: tx,
      budget,
      plan: record.row.receipt.plan,
    },
  });
}

/** Only the full locked archive phase may reuse its already queried receipt pair. */
export async function loadNativeArchivePlexBatch(
  tx: Prisma.TransactionClient,
  rawRef: NativePlexProofRef,
  rawParent: NativePlexProofParent,
  options: {
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
    phase: ArchiveBatchPhase;
  },
) {
  const { freshness, budget, phase } = options;
  if (
    phase.transaction !== tx ||
    phase.closed ||
    phase.budget !== budget ||
    rawParent.purpose !== "native_execution" ||
    rawParent.lifecycleKind !== "superseded_archive" ||
    rawParent.continuationId !== phase.authority.row.id ||
    rawParent.operationId !== phase.operation.id ||
    rawParent.networkScopeHash !== identityHash(phase.authority.networkScope)
  )
    throw new Error(
      "Native archive batch requires its exact current transaction phase",
    );
  return loadProofBatch(tx, rawRef, rawParent, {
    freshness,
    budget,
    phase,
    queriedPlan: {
      transaction: tx,
      budget,
      plan: phase.authority.row.receipt.plan,
    },
  });
}

async function loadProofBatch(
  tx: Prisma.TransactionClient,
  rawRef: NativePlexProofRef,
  rawParent: NativePlexProofParent,
  context: BatchContext,
) {
  const { freshness, budget } = context;
  context.receiptProjection?.assertTransaction(tx, budget);
  freshness?.assertActive();
  const ref = NativePlexProofRefSchema.parse(rawRef),
    parent = NativePlexProofParentSchema.parse(rawParent);
  if (identityHash(ref.parent) !== identityHash(parent))
    throw new Error("Native Plex proof reference parent changed");
  const row = await queryNativeBatch(tx, ref, context);
  freshness?.assertActive();
  const batch = parsePlexRecord(
    NativePlexProofBatchSchema,
    row.batch,
    row.batchHash,
  );
  assertNativeCommandParent(row.operation, row.plan, parent);
  assertNativeBatchClosure(row, batch, { ref, parent });
  const networkRow = row.networkObservation,
    plexRow = row.plexObservation;
  assertNativeObservationRefs(row, { ref, parent });
  const network = parseNativePlexNetwork(parent, networkRow.evidence);
  const envelope = parsePlexRecord(
    NativePlexNetworkEnvelopeSchema,
    plexRow.evidence,
    plexRow.evidenceHash,
  );
  const rawObservation = z
    .object({ observation: z.json() })
    .parse(plexRow.evidence).observation;
  const validated = assertNativePlexObservation({
    rawScope: row.plan.scope,
    rawObservation,
    network,
  });
  if (
    envelope.batchId !== row.id ||
    identityHash(envelope.parent) !== identityHash(parent) ||
    identityHash(envelope.network) !== identityHash(ref.network) ||
    nativePlexIdentityHash(
      parent,
      networkRow.evidence,
      envelope.observation,
    ) !== batch.identityHash
  )
    throw new Error("Native Plex paired identity changed");
  assertNativeBatchTimes({
    batch,
    network,
    plex: envelope.observation,
    networkRow,
    plexRow,
  });
  if (parent.purpose === "native_execution")
    await assertExecutionReceipt(tx, parent, validated.scope, context);
  const expiresAtMs = Date.parse(batch.expiresAt);
  if (
    freshness !== undefined &&
    (Date.now() >= expiresAtMs || Date.now() < Date.parse(batch.startedAt))
  )
    throw new PlexBindingProtection("verification_expired");
  freshness?.assertActive();
  return {
    ref,
    batch,
    network,
    plex: envelope.observation,
    expiresAtMs,
    operationKind: row.operation.kind,
  };
}

function assertNativeBatchClosure(
  row: BatchRow,
  batch: z.infer<typeof NativePlexProofBatchSchema>,
  input: { ref: NativePlexProofRef; parent: NativePlexProofParent },
) {
  const { ref, parent } = input;
  if (
    row.batchHash !== ref.batchHash ||
    identityHash(batch.parent) !== identityHash(parent) ||
    batch.batchId !== row.id ||
    row.planId !== parent.planId ||
    row.operationId !== parent.operationId ||
    identityHash(row.plan.scope) !== parent.scopeHash ||
    row.plan.recoveryEpoch !== parent.recoveryEpoch ||
    identityHash(batch.network) !== identityHash(ref.network) ||
    identityHash(batch.plex) !== identityHash(ref.plex) ||
    batch.identityHash !== ref.identityHash
  )
    throw new Error("Native Plex immutable batch closure changed");
}

function assertNativeObservationRefs(
  row: BatchRow,
  input: { ref: NativePlexProofRef; parent: NativePlexProofParent },
) {
  const { ref, parent } = input;
  const networkRow = row.networkObservation,
    plexRow = row.plexObservation;
  if (
    networkRow.id !== ref.network.observationId ||
    plexRow.id !== ref.plex.observationId ||
    networkRow.planId !== parent.planId ||
    plexRow.planId !== parent.planId ||
    networkRow.kind !== parent.networkKind ||
    plexRow.kind !== "plex_association" ||
    networkRow.evidenceHash !== ref.network.evidenceHash ||
    plexRow.evidenceHash !== ref.plex.evidenceHash ||
    identityHash(networkRow.evidence) !== networkRow.evidenceHash
  )
    throw new Error("Native Plex observation references changed");
}

function assertNativeCommandParent(
  operation: {
    id: string;
    kind: string;
    targetId: string | null;
    userId: string | null;
    payload: unknown;
  },
  plan: { id: string; actorId: string; planHash: string | null },
  parent: NativePlexProofParent,
) {
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
  };
  const payload = z
    .object({ kind: z.string(), operationId: z.uuid(), recoveryEpoch: z.int() })
    .loose()
    .parse(operation.payload);
  if (
    operation.id !== parent.operationId ||
    payload.operationId !== operation.id ||
    payload.kind !== operation.kind ||
    payload.recoveryEpoch !== parent.recoveryEpoch
  )
    throw new Error("Native Plex operation command changed");
  if (parent.purpose === "native_execution") {
    const expected =
      parent.networkKind === "archive_cleanup_network"
        ? "cleanup_native_archive"
        : "compensate_native_publication";
    if (
      operation.kind !== expected ||
      operation.userId !== plan.actorId ||
      operation.targetId !== parent.continuationId ||
      payload["continuationId"] !== parent.continuationId
    )
      throw new Error("Native Plex execution command parent changed");
    return;
  }
  const allowed = kinds[parent.lifecycleKind];
  if (
    !allowed.includes(operation.kind) ||
    operation.targetId !== plan.id ||
    operation.userId !== plan.actorId ||
    payload["planId"] !== plan.id
  )
    throw new Error("Native Plex review command parent changed");
  if (
    operation.kind === allowed[1] &&
    (payload["planHash"] !== plan.planHash ||
      payload["actorId"] !== plan.actorId)
  )
    throw new Error("Native Plex approval command parent changed");
}

function assertNativeBatchTimes(input: {
  batch: z.infer<typeof NativePlexProofBatchSchema>;
  network: { capturedAt: string; expiresAt: string };
  plex: z.infer<typeof NativePlexNetworkEnvelopeSchema>["observation"];
  networkRow: { observedAt: Date; expiresAt: Date };
  plexRow: { observedAt: Date; expiresAt: Date };
}) {
  const { batch, network, plex, networkRow, plexRow } = input;
  if (
    batch.startedAt !== network.capturedAt ||
    networkRow.observedAt.getTime() !== Date.parse(network.capturedAt) ||
    networkRow.expiresAt.getTime() !== Date.parse(network.expiresAt) ||
    plexRow.observedAt.getTime() !== Date.parse(plex.verification.startedAt) ||
    plexRow.expiresAt.getTime() !== Date.parse(plex.verification.expiresAt) ||
    Date.parse(plex.verification.startedAt) < Date.parse(batch.startedAt) ||
    Date.parse(plex.verification.completedAt) >
      Date.parse(batch.sessionsCheckedAt) ||
    Date.parse(batch.expiresAt) >
      Math.min(
        Date.parse(network.expiresAt),
        Date.parse(plex.verification.expiresAt),
      )
  )
    throw new Error(
      "Native paired proof chronology or earliest expiry changed",
    );
}

async function assertExecutionReceipt(
  tx: Prisma.TransactionClient,
  parent: Extract<NativePlexProofParent, { purpose: "native_execution" }>,
  effectiveScope: ReturnType<typeof assertNativePlexObservation>["scope"],
  context: BatchContext,
): Promise<void> {
  const { budget, phase } = context;
  const projection = context.receiptProjection;
  const queried =
    phase === undefined
      ? undefined
      : "chain" in phase
        ? phase.chain[0]
        : { row: phase.authority.row };
  if (phase !== undefined && queried === undefined)
    throw new Error("Native compensation phase omitted its receipt closure");
  const receipt = await readExecutionNativeReceipt(
    tx,
    {
      receiptId: parent.receipt.receiptId,
      queried: queried?.row.receipt,
      projection,
    },
    budget,
  );
  const review = parseNativePlexReceipt(receipt);
  if (review !== null && queried === undefined && projection === undefined) {
    const approved = await loadNativePlexProofBatch(
      tx,
      review.selection.plex.approved,
      review.selection.plex.approved.parent,
      { budget, queriedPlan: { transaction: tx, budget, plan: receipt.plan } },
    );
    const applied = await loadNativePlexProofBatch(
      tx,
      review.selection.plex.applied,
      review.selection.plex.applied.parent,
      { budget, queriedPlan: { transaction: tx, budget, plan: receipt.plan } },
    );
    assertNativeReceiptPair(review, approved, applied);
  }
  assertExecutionReceiptParent(receipt, parent);
  const continuation =
    queried?.row ??
    (parent.networkKind === "archive_cleanup_network"
      ? await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
          where: { id: parent.continuationId },
        })
      : await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: parent.continuationId },
        }));
  if (queried === undefined) budget.consume(1);
  // This is immutable historical proof. Active coordinator ownership is checked
  // by the lifecycle guard before new effects, not by replaying this old batch.
  if (
    continuation.receiptId !== receipt.id ||
    continuation.descriptorHash !== parent.descriptorHash ||
    identityHash(continuation.descriptor) !== parent.descriptorHash ||
    continuation.recoveryEpoch !== parent.recoveryEpoch
  )
    throw new Error("Native execution proof descriptor changed");
  await assertNativeEffectiveScope(
    tx,
    {
      parent,
      receipt,
      continuation,
      effectiveScope,
      validateReceipt: async (terminalReceipt) => {
        if (projection !== undefined) {
          await projection.validateQueried(tx, terminalReceipt, budget);
          return;
        }
        if (phase !== undefined && "projection" in phase) {
          await phase.projection.validateQueried(tx, terminalReceipt, budget);
          return;
        }
        const terminalReview = parseNativePlexReceipt(terminalReceipt);
        if (terminalReview === null) return;
        const approved = await loadNativePlexProofBatch(
          tx,
          terminalReview.selection.plex.approved,
          terminalReview.selection.plex.approved.parent,
          {
            budget,
            queriedPlan: {
              transaction: tx,
              budget,
              plan: terminalReceipt.plan,
            },
          },
        );
        const applied = await loadNativePlexProofBatch(
          tx,
          terminalReview.selection.plex.applied,
          terminalReview.selection.plex.applied.parent,
          {
            budget,
            queriedPlan: {
              transaction: tx,
              budget,
              plan: terminalReceipt.plan,
            },
          },
        );
        assertNativeReceiptPair(terminalReview, approved, applied);
      },
    },
    budget,
  );
}

/** Discovery pointer only; immutable receipt readers call the exact batch loader directly. */
export async function readNativePlexOperationProof(
  tx: Prisma.TransactionClient,
  parent: NativePlexProofParent,
  freshness: PlexBindingFreshness,
  budget = new PublicationAuthorityReadBudget(),
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: parent.operationId },
  });
  budget.consume(1);
  freshness.assertActive();
  const result = z
    .object({ nativePlexProof: NativePlexProofRefSchema.optional() })
    .nullable()
    .parse(operation.result);
  if (result?.nativePlexProof === undefined)
    throw new PlexBindingProtection("missing_binding");
  return loadNativePlexProofBatch(tx, result.nativePlexProof, parent, {
    freshness: freshness,
    budget: budget,
  });
}
