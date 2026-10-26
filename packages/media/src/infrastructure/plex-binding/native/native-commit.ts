import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativePlexProofParentSchema,
  NativePlexNetworkEnvelopeSchema,
  NativePlexProofBatchSchema,
  NativePlexProofRefSchema,
  type NativePlexProofParent,
  type NativePlexNetworkEvidence,
  type NativePlexObservation,
  type NativePlexProofTiming,
  type NativePlexProofRef,
} from "#shared/plex-binding/native.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  parseNativePlexNetwork,
  nativePlexIdentityHash,
} from "./native-evidence.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  assertNativePlexOperationParent,
  nativePlexReviewParent,
  type NativePlexReviewSnapshot,
} from "./native-parent.ts";
import {
  assertNativePlexExecutionSnapshot,
  type NativePlexExecutionSnapshot,
} from "./native-execution-parent.ts";
import {
  loadNativePlexProofBatch,
  loadNativeCompensationPlexBatch,
  loadNativeArchivePlexBatch,
} from "./native.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertNativePlexObservation } from "./native-observation.ts";
import { readNativePlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import type { NativeReceiptReadPort } from "./receipt-port.ts";
type NativePlexProofCommitInput = {
  parent: NativePlexProofParent;
  networkEvidence: NativePlexNetworkEvidence;
  plexObservation: NativePlexObservation;
  timing: NativePlexProofTiming;
  expectedOperationResultHash: string | null;
};
type NativePlexProofCommitContext = {
  freshness: PlexBindingFreshness;
  budget: PublicationAuthorityReadBudget;
  snapshot?: NativePlexReviewSnapshot;
  projection?: NativeReceiptReadPort | undefined;
  executionSnapshot?: NativePlexExecutionSnapshot;
};

/** Caller holds the exact existing lifecycle locks and rechecks its effective scope. */
export async function persistNativePlexProofBatch(
  tx: Prisma.TransactionClient,
  input: NativePlexProofCommitInput,
  freshness: PlexBindingFreshness,
  budget = new PublicationAuthorityReadBudget(),
): Promise<NativePlexProofRef> {
  return persistProof(tx, input, { freshness, budget });
}

/** Immutable receipt reuse never replaces this transaction's full current execution guard. */
export async function persistNativeExecutionPlexProofBatch(
  tx: Prisma.TransactionClient,
  input: NativePlexProofCommitInput,
  options: {
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
    projection: NativeReceiptReadPort;
    executionSnapshot?: NativePlexExecutionSnapshot;
  },
): Promise<NativePlexProofRef> {
  options.projection.assertTransaction(tx, options.budget);
  if (input.parent.purpose !== "native_execution")
    throw new Error(
      "Native execution receipt projection requires an execution parent",
    );
  return persistProof(tx, input, options);
}

/** Reuses only the full review snapshot queried under locks in this same transaction. */
export async function persistReviewedNativePlexProofBatch(
  tx: Prisma.TransactionClient,
  input: NativePlexProofCommitInput,
  options: NativePlexProofCommitContext & {
    snapshot: NativePlexReviewSnapshot;
  },
): Promise<NativePlexProofRef> {
  const { snapshot } = options;
  if (snapshot.transaction !== tx || input.parent.purpose !== "native_review")
    throw new Error(
      "Native review snapshot belongs to another transaction or purpose",
    );
  return persistProof(tx, input, options);
}

async function currentNativeParent(
  tx: Prisma.TransactionClient,
  input: NativePlexProofCommitInput,
  context: NativePlexProofCommitContext,
) {
  const { freshness, budget, snapshot, projection, executionSnapshot } =
    context;
  projection?.assertTransaction(tx, budget);
  freshness.assertActive();
  const parent = NativePlexProofParentSchema.parse(input.parent);
  let authorized =
    snapshot === undefined && executionSnapshot === undefined
      ? await assertNativePlexOperationParent(tx, parent, budget, {
          projection,
        })
      : null;
  freshness.assertActive();
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${parent.operationId} FOR UPDATE`;
  freshness.assertActive();
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: parent.operationId },
  });
  budget.consume(1);
  freshness.assertActive();
  if (executionSnapshot !== undefined) {
    authorized = await assertNativePlexExecutionSnapshot(
      tx,
      executionSnapshot,
      {
        operation,
        parent,
        budget,
      },
    );
    freshness.assertActive();
  }
  if (snapshot !== undefined) {
    if (snapshot.transaction !== tx || parent.purpose !== "native_review")
      throw new Error(
        "Native reviewed scope belongs to another transaction or purpose",
      );
    const current = nativePlexReviewParent(snapshot.plan, operation, parent);
    if (
      identityHash(current.proofParent) !== identityHash(parent) ||
      identityHash(current.parent.scope) !== identityHash(snapshot.scope)
    )
      throw new PlexBindingProtection("scope_changed");
    authorized = {
      scope: current.parent.scope,
      rawScope: current.rawScope,
      plan: snapshot.plan,
    };
  }
  if (authorized === null)
    throw new Error("Native Plex persistence omitted its validated parent");
  if (
    (operation.result === null ? null : identityHash(operation.result)) !==
    input.expectedOperationResultHash
  )
    throw new PlexBindingProtection("scope_changed");
  return { parent, authorized, operation };
}

async function persistProof(
  tx: Prisma.TransactionClient,
  input: NativePlexProofCommitInput,
  context: NativePlexProofCommitContext,
): Promise<NativePlexProofRef> {
  const { freshness, budget, projection, executionSnapshot } = context;
  const { parent, authorized, operation } = await currentNativeParent(
    tx,
    input,
    context,
  );
  const network = parseNativePlexNetwork(parent, input.networkEvidence);
  const validated = assertNativePlexObservation({
    rawScope: authorized.rawScope,
    rawObservation: input.plexObservation,
    network,
  });
  if (identityHash(validated.scope) !== identityHash(authorized.scope))
    throw new PlexBindingProtection("scope_changed");
  const targets = await readNativePlexCanonicalTargets(tx, authorized.scope);
  freshness.assertActive();
  if (identityHash(targets) !== identityHash(validated.targets))
    throw new PlexBindingProtection("scope_changed");
  const expiry = Date.parse(input.timing.expiresAt);
  if (
    expiry > freshness.expiresAtMs ||
    network.expiresAt !== input.timing.expiresAt ||
    input.plexObservation.verification.expiresAt !== input.timing.expiresAt
  )
    throw new Error(
      "Native paired observations must share their earliest captured expiry",
    );
  await bindPlexTransactionDeadline(tx, freshness);
  const batchId = crypto.randomUUID(),
    networkId = crypto.randomUUID(),
    plexId = crypto.randomUUID();
  const networkRef = {
    observationId: networkId,
    evidenceHash: identityHash(input.networkEvidence),
  };
  const envelope = NativePlexNetworkEnvelopeSchema.parse({
    schemaVersion: 1,
    parent,
    batchId,
    network: networkRef,
    observation: input.plexObservation,
  });
  const plexRef = {
    observationId: plexId,
    evidenceHash: identityHash(envelope),
  };
  const batch = NativePlexProofBatchSchema.parse({
    schemaVersion: 1,
    batchId,
    parent,
    network: networkRef,
    plex: plexRef,
    ...input.timing,
    identityHash: nativePlexIdentityHash(parent, network, envelope.observation),
  });
  await tx.nativeRecoveryObservation.createMany({
    data: [
      {
        id: networkId,
        planId: parent.planId,
        kind: parent.networkKind,
        evidenceHash: networkRef.evidenceHash,
        evidence: z.record(z.string(), z.json()).parse(input.networkEvidence),
        observedAt: new Date(network.capturedAt),
        expiresAt: new Date(expiry),
      },
      {
        id: plexId,
        planId: parent.planId,
        kind: "plex_association",
        evidenceHash: plexRef.evidenceHash,
        evidence: z.record(z.string(), z.json()).parse(envelope),
        observedAt: new Date(envelope.observation.verification.startedAt),
        expiresAt: new Date(expiry),
      },
    ],
  });
  freshness.assertActive();
  const batchHash = identityHash(batch);
  await tx.nativePlexProofBatch.create({
    data: {
      id: batchId,
      planId: parent.planId,
      operationId: parent.operationId,
      networkObservationId: networkId,
      plexObservationId: plexId,
      batch: z.record(z.string(), z.json()).parse(batch),
      batchHash,
    },
  });
  const ref = NativePlexProofRefSchema.parse({
    batchId,
    batchHash,
    parent,
    network: networkRef,
    plex: plexRef,
    identityHash: batch.identityHash,
  });
  if (executionSnapshot === undefined) {
    await loadNativePlexProofBatch(tx, ref, parent, {
      freshness,
      budget,
      receiptProjection: projection,
    });
  } else if (executionSnapshot.kind === "archive") {
    await loadNativeArchivePlexBatch(tx, ref, parent, {
      freshness,
      budget,
      phase: executionSnapshot.phase,
    });
  } else {
    await loadNativeCompensationPlexBatch(tx, ref, parent, {
      freshness,
      budget,
      phase: executionSnapshot.phase,
    });
  }
  const previous =
    operation.result === null
      ? {}
      : z.record(z.string(), z.json()).parse(operation.result);
  await tx.operation.update({
    where: { id: operation.id },
    data: {
      result: z
        .record(z.string(), z.json())
        .parse({ ...previous, nativePlexProof: ref }),
    },
  });
  if (executionSnapshot !== undefined) executionSnapshot.phase.closed = true;
  freshness.assertActive();
  return ref;
}
