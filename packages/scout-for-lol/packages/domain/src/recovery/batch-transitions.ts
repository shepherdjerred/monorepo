import { z } from "zod";
import type {
  RecoveryAbandonReason,
  RecoveryBatch,
  RecoveryBatchState,
  RecoveryCounts,
  RecoveryPolicy,
} from "#src/recovery/batch.ts";

/**
 * Pure transitions over {@link RecoveryBatch}. Illegal transitions are
 * expected concurrency outcomes and return `conflict` with a closed reason;
 * exceptions are reserved for arguments that violate the module's own
 * invariants (non-integer counts, empty cursor tokens).
 */

export type RecoveryConflictReason = z.infer<
  typeof RecoveryConflictReasonSchema
>;
export const RecoveryConflictReasonSchema = z.enum([
  "invalid-source-state",
  "terminal-state",
  "scan-budget-exhausted",
  "counts-regressed",
  "counts-discovered-changed",
  "counts-exceed-discovered",
  "items-unaccounted",
  "policy-immutable",
  "policy-release-forbidden",
]);

export type RecoveryTransitionResult =
  | { outcome: "applied"; next: RecoveryBatch }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: RecoveryConflictReason };

function applied(next: RecoveryBatch): RecoveryTransitionResult {
  return { outcome: "applied", next };
}

const alreadyApplied: RecoveryTransitionResult = { outcome: "already-applied" };

function conflict(reason: RecoveryConflictReason): RecoveryTransitionResult {
  return { outcome: "conflict", reason };
}

function withState(
  batch: RecoveryBatch,
  state: RecoveryBatchState,
): RecoveryBatch {
  return { ...batch, state };
}

function requireNonnegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a non-negative integer, got ${String(value)}`,
    );
  }
}

function requireCountsShape(counts: RecoveryCounts): void {
  requireNonnegativeInt(counts.discovered, "counts.discovered");
  requireNonnegativeInt(counts.succeeded, "counts.succeeded");
  requireNonnegativeInt(counts.suppressed, "counts.suppressed");
  requireNonnegativeInt(counts.failed, "counts.failed");
}

function processedTotal(counts: RecoveryCounts): number {
  return counts.succeeded + counts.suppressed + counts.failed;
}

export function beginScan(
  batch: RecoveryBatch,
  args: { pageBudget: number },
): RecoveryTransitionResult {
  requireNonnegativeInt(args.pageBudget, "pageBudget");
  if (args.pageBudget < 1) {
    throw new Error("pageBudget must be at least 1");
  }
  const state = batch.state;
  switch (state.kind) {
    case "planned":
      return applied(
        withState(batch, {
          kind: "scanning",
          cursor: { pagesScanned: 0, pageBudget: args.pageBudget },
        }),
      );
    case "scanning":
      return state.cursor.pagesScanned === 0 &&
        state.cursor.position === undefined &&
        state.cursor.pageBudget === args.pageBudget
        ? alreadyApplied
        : conflict("invalid-source-state");
    case "processing":
    case "digesting":
      return conflict("invalid-source-state");
    case "complete":
    case "abandoned":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function advanceScanCursor(
  batch: RecoveryBatch,
  args: { nextPosition: string },
): RecoveryTransitionResult {
  if (args.nextPosition.length === 0) {
    throw new Error("nextPosition must be a non-empty resume token");
  }
  const state = batch.state;
  switch (state.kind) {
    case "scanning": {
      if (state.cursor.position === args.nextPosition) {
        return alreadyApplied;
      }
      if (state.cursor.pagesScanned >= state.cursor.pageBudget) {
        return conflict("scan-budget-exhausted");
      }
      return applied(
        withState(batch, {
          kind: "scanning",
          cursor: {
            position: args.nextPosition,
            pagesScanned: state.cursor.pagesScanned + 1,
            pageBudget: state.cursor.pageBudget,
          },
        }),
      );
    }
    case "planned":
    case "processing":
    case "digesting":
      return conflict("invalid-source-state");
    case "complete":
    case "abandoned":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function beginProcessing(
  batch: RecoveryBatch,
  args: { discovered: number },
): RecoveryTransitionResult {
  requireNonnegativeInt(args.discovered, "discovered");
  const state = batch.state;
  switch (state.kind) {
    case "scanning":
      return applied(
        withState(batch, {
          kind: "processing",
          counts: {
            discovered: args.discovered,
            succeeded: 0,
            suppressed: 0,
            failed: 0,
          },
        }),
      );
    case "processing":
      return state.counts.discovered === args.discovered &&
        processedTotal(state.counts) === 0
        ? alreadyApplied
        : conflict("invalid-source-state");
    case "planned":
    case "digesting":
      return conflict("invalid-source-state");
    case "complete":
    case "abandoned":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function processingProgressResult(
  batch: RecoveryBatch,
  current: RecoveryCounts,
  next: RecoveryCounts,
): RecoveryTransitionResult {
  if (next.discovered !== current.discovered) {
    return conflict("counts-discovered-changed");
  }
  if (
    next.succeeded < current.succeeded ||
    next.suppressed < current.suppressed ||
    next.failed < current.failed
  ) {
    return conflict("counts-regressed");
  }
  if (processedTotal(next) > next.discovered) {
    return conflict("counts-exceed-discovered");
  }
  if (
    next.succeeded === current.succeeded &&
    next.suppressed === current.suppressed &&
    next.failed === current.failed
  ) {
    return alreadyApplied;
  }
  return applied(withState(batch, { kind: "processing", counts: next }));
}

export function recordProcessingProgress(
  batch: RecoveryBatch,
  args: { counts: RecoveryCounts },
): RecoveryTransitionResult {
  requireCountsShape(args.counts);
  const state = batch.state;
  switch (state.kind) {
    case "processing":
      return processingProgressResult(batch, state.counts, args.counts);
    case "planned":
    case "scanning":
    case "digesting":
      return conflict("invalid-source-state");
    case "complete":
    case "abandoned":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function beginDigest(batch: RecoveryBatch): RecoveryTransitionResult {
  const state = batch.state;
  switch (state.kind) {
    case "processing":
      return processedTotal(state.counts) === state.counts.discovered
        ? applied(withState(batch, { kind: "digesting" }))
        : conflict("items-unaccounted");
    case "digesting":
      return alreadyApplied;
    case "planned":
    case "scanning":
      return conflict("invalid-source-state");
    case "complete":
    case "abandoned":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function completeBatch(batch: RecoveryBatch): RecoveryTransitionResult {
  const state = batch.state;
  switch (state.kind) {
    case "digesting":
      return applied(withState(batch, { kind: "complete" }));
    case "complete":
      return alreadyApplied;
    case "planned":
    case "scanning":
    case "processing":
      return conflict("invalid-source-state");
    case "abandoned":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function abandonBatch(
  batch: RecoveryBatch,
  args: { reason: RecoveryAbandonReason },
): RecoveryTransitionResult {
  const state = batch.state;
  switch (state.kind) {
    case "planned":
    case "scanning":
    case "processing":
    case "digesting":
      return applied(
        withState(batch, { kind: "abandoned", reason: args.reason }),
      );
    case "abandoned":
      return state.reason === args.reason
        ? alreadyApplied
        : conflict("terminal-state");
    case "complete":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/**
 * The single sanctioned policy change: an operator may widen `no-external` to
 * `stale-private-only` on a live batch. Every other change — including any
 * path to `normal` — is refused, keeping the policy effectively immutable.
 */
export function operatorReleasePolicy(
  batch: RecoveryBatch,
  args: { to: RecoveryPolicy },
): RecoveryTransitionResult {
  const stateKind = batch.state.kind;
  if (stateKind === "complete" || stateKind === "abandoned") {
    return conflict("terminal-state");
  }
  switch (batch.policy) {
    case "no-external":
      if (args.to === "stale-private-only") {
        return applied({ ...batch, policy: "stale-private-only" });
      }
      return args.to === "normal"
        ? conflict("policy-release-forbidden")
        : conflict("policy-immutable");
    case "stale-private-only":
      if (args.to === "stale-private-only") {
        return alreadyApplied;
      }
      return args.to === "normal"
        ? conflict("policy-release-forbidden")
        : conflict("policy-immutable");
    case "normal":
      return conflict("policy-immutable");
    default: {
      const _exhaustive: never = batch.policy;
      return _exhaustive;
    }
  }
}
