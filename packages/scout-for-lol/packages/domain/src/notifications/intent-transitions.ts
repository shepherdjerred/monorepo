import { z } from "zod";
import type { DiscordMessageId, IsoInstant } from "#src/identity/brands.ts";
import type {
  NotificationAttemptNonce,
  NotificationFailure,
  NotificationIntent,
  NotificationIntentState,
  OperatorUnknownResolution,
} from "#src/notifications/intent.ts";

/**
 * Pure transitions over {@link NotificationIntent}. An illegal transition is
 * an expected concurrency outcome, so it returns a `conflict` with a closed
 * reason instead of throwing; exceptions are reserved for values that violate
 * the module's own invariants (e.g. an unparseable stored instant).
 */

export type NotificationConflictReason = z.infer<
  typeof NotificationConflictReasonSchema
>;
export const NotificationConflictReasonSchema = z.enum([
  "invalid-source-state",
  "terminal-state",
  "unknown-delivery-requires-operator",
  "already-sending",
  "attempt-nonce-mismatch",
  "send-in-flight",
  "freshness-deadline-passed",
  "not-stale",
]);

export type NotificationTransitionResult =
  | { outcome: "applied"; next: NotificationIntent }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: NotificationConflictReason };

function applied(next: NotificationIntent): NotificationTransitionResult {
  return { outcome: "applied", next };
}

const alreadyApplied: NotificationTransitionResult = {
  outcome: "already-applied",
};

function conflict(
  reason: NotificationConflictReason,
): NotificationTransitionResult {
  return { outcome: "conflict", reason };
}

function withState(
  intent: NotificationIntent,
  state: NotificationIntentState,
): NotificationIntent {
  return { ...intent, state };
}

function instantEpochMs(value: IsoInstant): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new TypeError(
      `Unparseable ISO instant reached a transition: ${value}`,
    );
  }
  return ms;
}

function isInstantAfter(instant: IsoInstant, reference: IsoInstant): boolean {
  return instantEpochMs(instant) > instantEpochMs(reference);
}

export function markReady(
  intent: NotificationIntent,
): NotificationTransitionResult {
  const state = intent.state;
  switch (state.kind) {
    case "pending":
      return applied(withState(intent, { kind: "ready" }));
    case "ready":
      return alreadyApplied;
    case "sending":
      return conflict("invalid-source-state");
    case "unknown-delivery":
      return conflict("unknown-delivery-requires-operator");
    case "delivered":
    case "suppressed":
    case "expired":
    case "permission-denied":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function beginSend(
  intent: NotificationIntent,
  args: { attemptNonce: NotificationAttemptNonce; startedAt: IsoInstant },
): NotificationTransitionResult {
  const state = intent.state;
  switch (state.kind) {
    case "ready": {
      if (isInstantAfter(args.startedAt, intent.freshnessDeadline)) {
        return conflict("freshness-deadline-passed");
      }
      return applied({
        ...intent,
        attemptCount: intent.attemptCount + 1,
        state: {
          kind: "sending",
          attemptNonce: args.attemptNonce,
          startedAt: args.startedAt,
        },
      });
    }
    case "sending":
      return state.attemptNonce === args.attemptNonce
        ? alreadyApplied
        : conflict("already-sending");
    case "pending":
      return conflict("invalid-source-state");
    case "unknown-delivery":
      return conflict("unknown-delivery-requires-operator");
    case "delivered":
    case "suppressed":
    case "expired":
    case "permission-denied":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function deliveredState(args: {
  messageId?: DiscordMessageId | undefined;
  deliveredAt: IsoInstant;
}): NotificationIntentState {
  return {
    kind: "delivered",
    deliveredAt: args.deliveredAt,
    ...(args.messageId === undefined ? {} : { messageId: args.messageId }),
  };
}

export function confirmDelivered(
  intent: NotificationIntent,
  args: {
    attemptNonce: NotificationAttemptNonce;
    messageId?: DiscordMessageId | undefined;
    deliveredAt: IsoInstant;
  },
): NotificationTransitionResult {
  const state = intent.state;
  switch (state.kind) {
    case "sending":
      if (state.attemptNonce !== args.attemptNonce) {
        return conflict("attempt-nonce-mismatch");
      }
      return applied(withState(intent, deliveredState(args)));
    case "delivered":
      return state.deliveredAt === args.deliveredAt &&
        state.messageId === args.messageId
        ? alreadyApplied
        : conflict("terminal-state");
    case "unknown-delivery":
      // Even a nonce-matching confirmation must go through the operator once
      // the attempt has been recorded as unknown: the operator may already be
      // acting on the ambiguity.
      return conflict("unknown-delivery-requires-operator");
    case "pending":
    case "ready":
      return conflict("invalid-source-state");
    case "suppressed":
    case "expired":
    case "permission-denied":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function recordFailure(
  intent: NotificationIntent,
  args: {
    attemptNonce: NotificationAttemptNonce;
    failure: NotificationFailure;
  },
): NotificationTransitionResult {
  const state = intent.state;
  switch (state.kind) {
    case "sending": {
      if (state.attemptNonce !== args.attemptNonce) {
        return conflict("attempt-nonce-mismatch");
      }
      const next: NotificationIntentState =
        args.failure.classification === "retryable"
          ? { kind: "ready" }
          : { kind: "permission-denied" };
      return applied({ ...intent, lastFailure: args.failure, state: next });
    }
    case "pending":
    case "ready":
      return conflict("invalid-source-state");
    case "unknown-delivery":
      return conflict("unknown-delivery-requires-operator");
    case "delivered":
    case "suppressed":
    case "expired":
    case "permission-denied":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function recordUnknownDelivery(
  intent: NotificationIntent,
  args: { attemptNonce: NotificationAttemptNonce; observedAt: IsoInstant },
): NotificationTransitionResult {
  const state = intent.state;
  switch (state.kind) {
    case "sending":
      if (state.attemptNonce !== args.attemptNonce) {
        return conflict("attempt-nonce-mismatch");
      }
      return applied(
        withState(intent, {
          kind: "unknown-delivery",
          attemptNonce: args.attemptNonce,
          observedAt: args.observedAt,
        }),
      );
    case "unknown-delivery":
      return state.attemptNonce === args.attemptNonce &&
        state.observedAt === args.observedAt
        ? alreadyApplied
        : conflict("unknown-delivery-requires-operator");
    case "pending":
    case "ready":
      return conflict("invalid-source-state");
    case "delivered":
    case "suppressed":
    case "expired":
    case "permission-denied":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function suppressStale(
  intent: NotificationIntent,
  args: { at: IsoInstant },
): NotificationTransitionResult {
  const state = intent.state;
  switch (state.kind) {
    case "pending":
    case "ready": {
      if (!isInstantAfter(args.at, intent.freshnessDeadline)) {
        return conflict("not-stale");
      }
      return applied(
        withState(intent, { kind: "suppressed", reason: "stale" }),
      );
    }
    case "sending":
      return conflict("send-in-flight");
    case "unknown-delivery":
      return conflict("unknown-delivery-requires-operator");
    case "suppressed":
      return state.reason === "stale"
        ? alreadyApplied
        : conflict("terminal-state");
    case "delivered":
    case "expired":
    case "permission-denied":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function expire(
  intent: NotificationIntent,
): NotificationTransitionResult {
  const state = intent.state;
  switch (state.kind) {
    case "pending":
    case "ready":
      return applied(withState(intent, { kind: "expired" }));
    case "sending":
      return conflict("send-in-flight");
    case "unknown-delivery":
      return conflict("unknown-delivery-requires-operator");
    case "expired":
      return alreadyApplied;
    case "delivered":
    case "suppressed":
    case "permission-denied":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function operatorResolveUnknown(
  intent: NotificationIntent,
  resolution: OperatorUnknownResolution,
): NotificationTransitionResult {
  const state = intent.state;
  switch (state.kind) {
    case "unknown-delivery":
      return resolution.outcome === "delivered"
        ? applied(withState(intent, deliveredState(resolution)))
        : applied(withState(intent, { kind: "ready" }));
    case "delivered":
      return resolution.outcome === "delivered" &&
        state.deliveredAt === resolution.deliveredAt &&
        state.messageId === resolution.messageId
        ? alreadyApplied
        : conflict("terminal-state");
    case "pending":
    case "ready":
    case "sending":
      return conflict("invalid-source-state");
    case "suppressed":
    case "expired":
    case "permission-denied":
      return conflict("terminal-state");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
