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
 * `(kind, version, scope)`: a receipt whose identity the state already holds
 * is `already-applied`, and the state keeps the one it has — including that
 * first receipt's `recordedAt`.
 *
 * `recordedAt` is deliberately outside the comparison, though it used to BE
 * the comparison. It is observational metadata about the first attestation —
 * when the fact was noticed, not what the fact is — and treating it as
 * evidence predates the operational reality that receipt writers are Temporal
 * Activities: a retry of an already-committed write arrives with the same
 * identity and a fresh wall clock by construction, so comparing clocks turned
 * every benign retry into a conflict.
 *
 * That leaves this transition nothing left to disagree about, because a domain
 * receipt carries its identity and `recordedAt` and nothing else: an identity
 * match here is always a replay. `receipt-evidence-mismatch` stays in the
 * vocabulary for the layer that does hold evidence — the persistence
 * repository compares the stored evidence blob, which is a claim about the
 * fact rather than about when it was seen. Both layers discriminate on
 * evidence alone, so they cannot answer the same replay differently.
 */
export function recordReceipt(args: {
  state: MatchProcessingState;
  receipt: MatchProcessingReceipt;
}): TransitionResult<MatchProcessingState> {
  const { state, receipt } = args;
  const identityKey = matchProcessingReceiptIdentityKey(receipt);
  const alreadyHeld = state.receipts.some(
    (candidate) => matchProcessingReceiptIdentityKey(candidate) === identityKey,
  );
  if (alreadyHeld) {
    return { outcome: "already-applied" };
  }
  return {
    outcome: "applied",
    next: { ...state, receipts: [...state.receipts, receipt] },
  };
}
