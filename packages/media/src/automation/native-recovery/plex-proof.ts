import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { FileContext } from "#automation/files/types.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  loadNativePlexReviewParent,
  loadNativePlexExecutionParent,
  assertNativePlexOperationParent,
  type NativePlexReviewSnapshot,
} from "#infrastructure/plex-binding/native/native-parent.ts";
import {
  readNativePlexOperationProof,
  loadNativePlexProofBatch,
} from "#infrastructure/plex-binding/native/native.ts";
import { assertNativePlexApproval } from "#infrastructure/plex-binding/native/native-version.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import {
  FinishedNativePlexV3Schema,
  NativePlexSelectionV3Schema,
} from "#shared/plex-binding/native-version.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { NativePlexProofRef } from "#shared/plex-binding/native.ts";

export type PairedNativeProof = {
  kind: "paired";
  ref: NativePlexProofRef;
  network: unknown;
  freshness: PlexBindingFreshness;
  budget: PublicationAuthorityReadBudget;
};
type LegacyNativeProof = {
  kind: "legacy";
  observationId: string;
  evidenceHash: string;
  network: unknown;
  freshness: PlexBindingFreshness;
  budget: PublicationAuthorityReadBudget;
};
export type NativeFilesPlexProof = PairedNativeProof | LegacyNativeProof;

/** This branch is only for an already finished literal historical plan. */
export function historicalNativePlan(raw: unknown): boolean {
  return z
    .object({ schemaVersion: z.union([z.literal(1), z.literal(2)]) })
    .safeParse(raw).success;
}

export async function captureNativeReviewProof(
  files: FileContext,
  input: { planId: string; operationId: string },
  finished: unknown,
  options: {
    execution: PublicationExecution;
    budget?: PublicationAuthorityReadBudget;
    expiresAtMs?: number;
  },
): Promise<NativeFilesPlexProof> {
  const { execution, budget = new PublicationAuthorityReadBudget() } = options;
  if (
    options.expiresAtMs !== undefined &&
    (!Number.isSafeInteger(options.expiresAtMs) || options.expiresAtMs <= 0)
  )
    throw new TypeError("Native review invocation deadline is invalid");
  execution.assertActive();
  const observed = { wall: Date.now(), monotonic: performance.now() };
  if (historicalNativePlan(finished)) {
    const row = await files.db.nativeRecoveryObservation.findFirstOrThrow({
      where: { planId: input.planId, kind: "network" },
      orderBy: { createdAt: "desc" },
    });
    budget.consume(1);
    if (identityHash(row.evidence) !== row.evidenceHash)
      throw new Error("Historical native network evidence changed");
    const expiresAtMs = Math.min(
      row.expiresAt.getTime(),
      options.expiresAtMs ?? row.expiresAt.getTime(),
    );
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0)
      throw new Error("Historical native invocation deadline is invalid");
    const monotonicDeadline = observed.monotonic + expiresAtMs - observed.wall;
    const assertActive = () => {
      execution.assertActive();
      execution.signal.throwIfAborted();
      if (
        Date.now() < observed.wall ||
        Date.now() >= expiresAtMs ||
        performance.now() >= monotonicDeadline
      )
        throw new Error("Historical native network evidence expired");
    };
    assertActive();
    return {
      kind: "legacy",
      observationId: row.id,
      evidenceHash: row.evidenceHash,
      network: row.evidence,
      freshness: { expiresAtMs, assertActive },
      budget,
    };
  }
  const initial = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(
      observed.wall + 60_000,
      options.expiresAtMs ?? observed.wall + 60_000,
    ),
    guards: [execution],
  });
  const parent = await loadNativePlexReviewParent(
    files.db,
    { planId: input.planId, operationId: input.operationId },
    budget,
  );
  initial.assertActive();
  const proof = await readNativePlexOperationProof(
    files.db,
    parent.proofParent,
    initial,
    budget,
  );
  const freshness = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(initial.expiresAtMs, proof.expiresAtMs),
    guards: [initial],
  });
  return {
    kind: "paired",
    ref: proof.ref,
    network: proof.network,
    freshness,
    budget,
  };
}

export async function captureNativeExecutionProof(
  files: FileContext,
  operationId: string,
  execution: { signal: AbortSignal; assertActive: () => void },
  budget = new PublicationAuthorityReadBudget(),
): Promise<PairedNativeProof> {
  execution.assertActive();
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const initial = plexBindingFreshness({
    observed,
    expiresAtMs: observed.wall + 60_000,
    guards: [execution],
  });
  const parent = await loadNativePlexExecutionParent(
    files.db,
    { operationId },
    budget,
  );
  initial.assertActive();
  const proof = await readNativePlexOperationProof(
    files.db,
    parent.proofParent,
    initial,
    budget,
  );
  const freshness = plexBindingFreshness({
    observed,
    expiresAtMs: proof.expiresAtMs,
    guards: [initial],
  });
  return {
    kind: "paired",
    ref: proof.ref,
    network: proof.network,
    freshness,
    budget,
  };
}

/** Called under the lifecycle's complete lock set, before any new writes/effects. */
export async function assertNativeFilesProof(
  tx: Prisma.TransactionClient,
  proof: NativeFilesPlexProof,
  snapshot?: NativePlexReviewSnapshot,
) {
  const budget = proof.budget;
  proof.freshness.assertActive();
  if (proof.kind === "paired") {
    const parent = await assertNativePlexOperationParent(
      tx,
      proof.ref.parent,
      budget,
      { snapshot },
    );
    const applied = await loadNativePlexProofBatch(
      tx,
      proof.ref,
      proof.ref.parent,
      { freshness: proof.freshness, budget: budget },
    );
    await bindPlexTransactionDeadline(tx, proof.freshness);
    proof.freshness.assertActive();
    if ("plan" in parent)
      return { transaction: tx, budget, plan: parent.plan, applied };
  } else {
    const row = await tx.nativeRecoveryObservation.findUniqueOrThrow({
      where: { id: proof.observationId },
    });
    budget.consume(1);
    if (
      row.evidenceHash !== proof.evidenceHash ||
      identityHash(row.evidence) !== proof.evidenceHash
    )
      throw new Error("Pinned historical native observation changed");
  }
  await bindPlexTransactionDeadline(tx, proof.freshness);
  proof.freshness.assertActive();
  return;
}

export async function assertNativeFilesApproval(
  tx: Prisma.TransactionClient,
  input: { planId: string; operationId: string },
  finished: unknown,
  options: {
    proof: NativeFilesPlexProof;
    snapshot?: NativePlexReviewSnapshot;
  },
) {
  const { proof, snapshot } = options;
  const budget = proof.budget;
  const queried = await assertNativeFilesProof(tx, proof, snapshot);
  if (proof.kind === "legacy") {
    if (!historicalNativePlan(finished))
      throw new Error("Legacy native proof cannot authorize a v3 plan");
    return;
  }
  const plan = FinishedNativePlexV3Schema.parse(finished);
  if (proof.ref.parent.operationId !== input.operationId)
    throw new Error("Pinned native apply command changed");
  await assertNativePlexApproval(
    tx,
    { planId: input.planId, approved: plan.plex, applied: proof.ref },
    proof.freshness,
    { budget: budget, queried: queried },
  );
}

export function nativeSelectionProof(
  finished: unknown,
  proof: NativeFilesPlexProof,
) {
  if (proof.kind === "legacy") return {};
  const plan = FinishedNativePlexV3Schema.parse(finished);
  return {
    schemaVersion: 3,
    lifecycleKind: plan.lifecycleKind,
    plex: { approved: plan.plex, applied: proof.ref },
  };
}

export function nativeSelection(raw: unknown, proof: NativeFilesPlexProof) {
  return z
    .record(z.string(), z.json())
    .parse(
      proof.kind === "paired" ? NativePlexSelectionV3Schema.parse(raw) : raw,
    );
}
