import { vi } from "vitest";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";

// This is an independent model-relation inventory, not the production charge
// constants. JSON columns deliberately never appear here. A new include fails.
const relations: Record<string, Readonly<Record<string, string>>> = {
  NativeRecoveryReceipt: { plan: "NativeRecoveryPlan" },
  NativeRecoveryPlan: {},
  NativePlexProofBatch: {
    plan: "NativeRecoveryPlan",
    operation: "Operation",
    networkObservation: "NativeRecoveryObservation",
    plexObservation: "NativeRecoveryObservation",
  },
  NativeRecoveryObservation: {},
  Operation: {},
  MediaPublicationTransition: {},
  AcquisitionAttempt: {},
  NativePublicationCompensationContinuation: {
    receipt: "NativeRecoveryReceipt",
    transition: "MediaPublicationTransition",
  },
  NativeArchiveCleanupContinuation: { receipt: "NativeRecoveryReceipt" },
};

export function returnedProofModels(
  model: string,
  args: unknown,
  result: unknown,
): number {
  const graph = relations[model];
  if (graph === undefined) throw new Error("Unknown audited proof model");
  const query = z
    .object({ include: z.record(z.string(), z.unknown()).optional() })
    .parse(args);
  const includes = Object.entries(query.include ?? {}).filter(
    ([, value]) => value !== false,
  );
  for (const [name] of includes)
    if (graph[name] === undefined)
      throw new Error(`Unknown proof relation ${model}.${name}`);
  if (result === null) return 0;
  const rows = Array.isArray(result) ? result : [result];
  let count = 0;
  for (const raw of rows) {
    const row = z.record(z.string(), z.unknown()).parse(raw);
    count++;
    for (const [name, nested] of includes) {
      const child = graph[name];
      if (child === undefined || row[name] === undefined)
        throw new Error("Audited proof relation was not returned");
      count += returnedProofModels(
        child,
        nested === true ? {} : nested,
        row[name],
      );
    }
  }
  return count;
}

/** Spies retain their default implementation: these are actual DB results. */
export function proofQueryAudit(tx: Prisma.TransactionClient) {
  const receipt = vi.spyOn(tx.nativeRecoveryReceipt, "findUniqueOrThrow");
  const batch = vi.spyOn(tx.nativePlexProofBatch, "findUniqueOrThrow");
  const plan = vi.spyOn(tx.nativeRecoveryPlan, "findUniqueOrThrow");
  const transition = vi.spyOn(tx.mediaPublicationTransition, "findUnique");
  const attempt = vi.spyOn(tx.acquisitionAttempt, "findUniqueOrThrow");
  const transitionExact = vi.spyOn(
    tx.mediaPublicationTransition,
    "findUniqueOrThrow",
  );
  const operation = vi.spyOn(tx.operation, "findUniqueOrThrow");
  const compensation = vi.spyOn(
    tx.nativePublicationCompensationContinuation,
    "findUniqueOrThrow",
  );
  const overlaps = vi.spyOn(
    tx.nativePublicationCompensationContinuation,
    "findMany",
  );
  const archive = vi.spyOn(
    tx.nativeArchiveCleanupContinuation,
    "findUniqueOrThrow",
  );
  const reads: {
    model: string;
    calls: () => readonly (readonly unknown[])[];
    results: () => readonly { type: string; value: unknown }[];
  }[] = [
    {
      model: "MediaPublicationTransition",
      calls: () => transitionExact.mock.calls,
      results: () => transitionExact.mock.results,
    },
    {
      model: "Operation",
      calls: () => operation.mock.calls,
      results: () => operation.mock.results,
    },
    {
      model: "NativePublicationCompensationContinuation",
      calls: () => compensation.mock.calls,
      results: () => compensation.mock.results,
    },
    {
      model: "NativePublicationCompensationContinuation",
      calls: () => overlaps.mock.calls,
      results: () => overlaps.mock.results,
    },
    {
      model: "NativeArchiveCleanupContinuation",
      calls: () => archive.mock.calls,
      results: () => archive.mock.results,
    },
    {
      model: "NativeRecoveryReceipt",
      calls: () => receipt.mock.calls,
      results: () => receipt.mock.results,
    },
    {
      model: "NativePlexProofBatch",
      calls: () => batch.mock.calls,
      results: () => batch.mock.results,
    },
    {
      model: "NativeRecoveryPlan",
      calls: () => plan.mock.calls,
      results: () => plan.mock.results,
    },
    {
      model: "MediaPublicationTransition",
      calls: () => transition.mock.calls,
      results: () => transition.mock.results,
    },
    {
      model: "AcquisitionAttempt",
      calls: () => attempt.mock.calls,
      results: () => attempt.mock.results,
    },
  ];
  return {
    async returned() {
      let count = 0;
      for (const read of reads)
        for (const [index, call] of read.calls().entries()) {
          const result = read.results()[index];
          if (result?.type !== "return")
            throw new Error("Proof query did not return a result");
          count += returnedProofModels(read.model, call[0], await result.value);
        }
      return count;
    },
    restore() {
      receipt.mockRestore();
      batch.mockRestore();
      plan.mockRestore();
      transition.mockRestore();
      attempt.mockRestore();
      transitionExact.mockRestore();
      operation.mockRestore();
      compensation.mockRestore();
      overlaps.mockRestore();
      archive.mockRestore();
    },
  };
}
