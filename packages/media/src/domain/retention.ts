export const DAY_MS = 86_400_000;
export const RETENTION_DEFAULTS = Object.freeze({
  graceMs: 7 * DAY_MS,
  keepMs: 30 * DAY_MS,
  quarantineMs: 7 * DAY_MS,
  maximumWatchAgeMs: 15 * 60_000,
});

export type RetentionRequester = {
  userId: string;
  owner: boolean;
  watched: boolean | null;
  observedAt: number | null;
  warningAcceptedAt: number | null;
  warningFailed: boolean;
  fulfillment: MovieEditionFulfillment;
};

export type RetentionInput = {
  now: number;
  generation: number;
  decisionGeneration: number;
  owned: boolean;
  identityConfirmed: boolean;
  activePlayback: boolean;
  operationInProgress: boolean;
  requesters: readonly RetentionRequester[];
  holds: readonly { until: number | null; isPin: boolean }[];
};

export type RetentionEvaluation =
  | { state: "protected"; reason: string }
  | { state: "warning_pending"; recipients: string[] }
  | { state: "grace_period"; graceUntil: number }
  | { state: "quarantine_eligible"; graceUntil: number; purgeAfter: number };

export function evaluateRetention(input: RetentionInput): RetentionEvaluation {
  const protect = (reason: string): RetentionEvaluation => ({
    state: "protected",
    reason,
  });
  if (input.generation !== input.decisionGeneration)
    return protect("decision_obsolete");
  if (!(input.owned && input.identityConfirmed))
    return protect("ownership_uncertain");
  if (input.activePlayback) return protect("active_playback");
  if (input.operationInProgress) return protect("operation_in_progress");
  if (
    input.holds.some(
      (hold) => hold.isPin || hold.until === null || hold.until > input.now,
    )
  )
    return protect("keep_hold");
  const unfulfilled = fulfillmentProtection(input.requesters);
  if (unfulfilled !== null) return protect(unfulfilled);
  const requesters = input.requesters.filter((requester) => !requester.owner);
  if (requesters.length === 0) return protect("owner_only_or_unclaimed");
  for (const requester of requesters) {
    const reason = watchProtection(requester, input.now);
    if (reason !== null) return protect(reason);
  }
  const pending = requesters.filter(
    (requester) =>
      requester.warningAcceptedAt === null || requester.warningFailed,
  );
  if (pending.length > 0)
    return {
      state: "warning_pending",
      recipients: pending.map((requester) => requester.userId),
    };
  const latestWarning = Math.max(
    ...requesters.map((requester) => requester.warningAcceptedAt ?? input.now),
  );
  if (latestWarning > input.now) return protect("warning_timestamp_invalid");
  const graceUntil = latestWarning + RETENTION_DEFAULTS.graceMs;
  return input.now < graceUntil
    ? { state: "grace_period", graceUntil }
    : {
        state: "quarantine_eligible",
        graceUntil,
        purgeAfter: input.now + RETENTION_DEFAULTS.quarantineMs,
      };
}

function fulfillmentProtection(
  requesters: readonly RetentionRequester[],
): string | null {
  for (const requester of requesters) {
    if (
      requester.fulfillment.status !== "fulfilled" &&
      requester.fulfillment.status !== "not_applicable"
    )
      return requester.fulfillment.reason;
  }
  return null;
}

function watchProtection(
  requester: RetentionRequester,
  now: number,
): string | null {
  if (requester.watched === null || requester.observedAt === null)
    return "watch_unknown";
  if (
    requester.observedAt > now ||
    now - requester.observedAt > RETENTION_DEFAULTS.maximumWatchAgeMs
  )
    return "watch_stale";
  return requester.watched ? null : "requester_unwatched";
}

export function extendKeep(now: number, existingUntil: number | null): number {
  const minimum = now + RETENTION_DEFAULTS.keepMs;
  return existingUntil === null ? minimum : Math.max(existingUntil, minimum);
}

export function canPurge(input: {
  now: number;
  quarantinedAt: number;
  generation: number;
  decisionGeneration: number;
  owned: boolean;
  manifestVerified: boolean;
  protectedByRequestOrHold: boolean;
  activeOperation: boolean;
}): boolean {
  return (
    input.owned &&
    input.manifestVerified &&
    !input.protectedByRequestOrHold &&
    !input.activeOperation &&
    input.generation === input.decisionGeneration &&
    input.now >= input.quarantinedAt + RETENTION_DEFAULTS.quarantineMs
  );
}
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
