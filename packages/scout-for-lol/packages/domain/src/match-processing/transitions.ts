import { z } from "zod";
import { type IsoInstant } from "#src/identity/brands.ts";
import {
  type AssignedPipelineOwner,
  type MatchProcessingReceipt,
  type MatchProcessingState,
  matchProcessingReceiptIdentityKey,
} from "#src/match-processing/states.ts";

/**
 * Why an attempted transition is illegal. Closed enum — a conflict is a
 * legitimate answer for racing callers, never an exception.
 */
export type MatchProcessingConflictReason = z.infer<
  typeof MatchProcessingConflictReasonSchema
>;
export const MatchProcessingConflictReasonSchema = z.enum([
  "ownership-held-by-another-owner",
  "promotion-target-born-full",
  "receipt-evidence-mismatch",
]);

/**
 * Result of a pure transition attempt. `applied` carries the next state;
 * `already-applied` means this exact transition already happened (idempotent
 * retry); `conflict` means the transition is illegal from the current state.
 * Thrown errors are reserved for broken internal invariants.
 */
export type TransitionResult<T> =
  | { readonly outcome: "applied"; readonly next: T }
  | { readonly outcome: "already-applied" }
  | {
      readonly outcome: "conflict";
      readonly reason: MatchProcessingConflictReason;
    };

/**
 * Claim ownership of an unowned match. Ownership never transfers between
 * owners: a claim on a match held by a different pipeline is a conflict, and
 * a claim by the current holder is an idempotent retry.
 */
export function claimOwnership(args: {
  state: MatchProcessingState;
  claimant: AssignedPipelineOwner;
}): TransitionResult<MatchProcessingState> {
  const { state, claimant } = args;
  switch (state.owner.kind) {
    case "unowned":
      return { outcome: "applied", next: { ...state, owner: claimant } };
    case "legacy-v1":
    case "temporal-v2":
      return state.owner.kind === claimant.kind
        ? { outcome: "already-applied" }
        : { outcome: "conflict", reason: "ownership-held-by-another-owner" };
  }
}

/**
 * Promote an ARCHIVE_ONLY match to FULL. Happens at most once: the applied
 * transition records the promotion, a retry on the promoted state is
 * `already-applied`, and promoting a state that was born FULL is a conflict.
 * FULL never downgrades — no transition produces ARCHIVE_ONLY from FULL.
 */
export function promoteArchiveOnlyToFull(args: {
  state: MatchProcessingState;
  promotedAt: IsoInstant;
}): TransitionResult<MatchProcessingState> {
  const { state, promotedAt } = args;
  switch (state.policy) {
    case "ARCHIVE_ONLY":
      return {
        outcome: "applied",
        next: { ...state, policy: "FULL", promotion: { promotedAt } },
      };
    case "FULL":
      return state.promotion === null
        ? { outcome: "conflict", reason: "promotion-target-born-full" }
        : { outcome: "already-applied" };
  }
}

/**
 * Record a processing receipt. Idempotent by the full receipt identity
 * `(kind, version, scope)`: an exact replay — same identity, same evidence —
 * is `already-applied`, while a receipt that shares an identity but carries
 * different evidence (`recordedAt`) is a conflict: something recorded the
 * same fact twice with disagreeing observations, and the state keeps the
 * first.
 */
export function recordReceipt(args: {
  state: MatchProcessingState;
  receipt: MatchProcessingReceipt;
}): TransitionResult<MatchProcessingState> {
  const { state, receipt } = args;
  const identityKey = matchProcessingReceiptIdentityKey(receipt);
  const existing = state.receipts.find(
    (candidate) => matchProcessingReceiptIdentityKey(candidate) === identityKey,
  );
  if (existing !== undefined) {
    return existing.recordedAt === receipt.recordedAt
      ? { outcome: "already-applied" }
      : { outcome: "conflict", reason: "receipt-evidence-mismatch" };
  }
  return {
    outcome: "applied",
    next: { ...state, receipts: [...state.receipts, receipt] },
  };
}
