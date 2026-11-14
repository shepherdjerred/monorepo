export const INTEREST_POLICY = Object.freeze({
  neverStartedMs: 30 * 86_400_000,
  lostInterestMs: 60 * 86_400_000,
  replyMs: 7 * 86_400_000,
  metadataFreshMs: 86_400_000,
});

export type InterestFacts = {
  now: number;
  kind: "movie" | "series" | "season" | "episode";
  policy: "keep" | "temporary";
  state: "following" | "finished" | "dropped" | "expired";
  revision: number;
  renewedAt: number;
  usableUnwatchedSince: number | null;
  lastProgressAt: number | null;
  usableUnwatched: boolean | null;
  watchedComplete: boolean | null;
  requestedCoverageComplete: boolean;
  terminalStatus: "continuing" | "ended" | "cancelled" | "unknown";
  terminalObservedAt: number | null;
  notice: {
    revision: number;
    acceptedAt: number | null;
    failed: boolean;
  } | null;
};

export type InterestEvaluation =
  | { state: "protected"; reason: string; resetUsableClock: boolean }
  | { state: "following"; usableSince: number }
  | { state: "notice_pending"; usableSince: number }
  | { state: "reply_pending"; replyBy: number; usableSince: number }
  | {
      state: "release";
      reason: "watched" | "series_finished" | "lost_interest";
      stateAfter: "finished" | "expired";
    };

/** Current playback truth and usable-content proof are supplied by the native collector.
 * Imported historical sessions and reconciler timestamps are never inputs to progress. */
export function evaluateRequestInterest(
  input: InterestFacts,
): InterestEvaluation {
  const protect = (
    reason: string,
    resetUsableClock = false,
  ): InterestEvaluation => ({ state: "protected", reason, resetUsableClock });
  if (input.policy === "keep") return protect("keep_indefinitely");
  if (input.state !== "following") return protect("interest_already_released");
  if (
    input.renewedAt > input.now ||
    (input.lastProgressAt !== null && input.lastProgressAt > input.now)
  )
    return protect("interest_clock_invalid");
  if (input.watchedComplete === null || input.usableUnwatched === null)
    return protect("playback_or_access_unknown", true);
  if (input.watchedComplete && input.requestedCoverageComplete)
    return completedInterest(input);
  if (!input.usableUnwatched)
    return protect("no_usable_unwatched_content", true);
  if (!input.requestedCoverageComplete)
    return protect("requested_coverage_incomplete", true);
  const usableSince = input.usableUnwatchedSince ?? input.now;
  if (usableSince > input.now) return protect("interest_clock_invalid");
  const baseline = Math.max(
    usableSince,
    input.renewedAt,
    input.lastProgressAt ?? 0,
  );
  const delay =
    input.lastProgressAt === null
      ? INTEREST_POLICY.neverStartedMs
      : INTEREST_POLICY.lostInterestMs;
  return input.now - baseline < delay
    ? { state: "following", usableSince }
    : evaluateReply(input, usableSince, baseline, delay);
}

/** Aging a following request requires every requested sibling to be usable;
 * an available backlog cannot hide unaired, missing or caption-pending content. */
export function usableInterestBacklog(
  states: readonly (
    "unknown" | "unavailable" | "watched" | "unwatched" | "subtitles_pending"
  )[],
) {
  return (
    states.includes("unwatched") &&
    states.every((state) => state === "watched" || state === "unwatched")
  );
}

function completedInterest(input: InterestFacts): InterestEvaluation {
  if (input.kind === "movie" || input.kind === "episode")
    return { state: "release", reason: "watched", stateAfter: "finished" };
  const terminalFresh =
    input.terminalObservedAt !== null &&
    input.terminalObservedAt <= input.now &&
    input.now - input.terminalObservedAt <= INTEREST_POLICY.metadataFreshMs;
  return terminalFresh && ["ended", "cancelled"].includes(input.terminalStatus)
    ? { state: "release", reason: "series_finished", stateAfter: "finished" }
    : {
        state: "protected",
        reason: "caught_up_following",
        resetUsableClock: true,
      };
}

function evaluateReply(
  input: InterestFacts,
  usableSince: number,
  baseline: number,
  delay: number,
): InterestEvaluation {
  const notice = input.notice;
  if (
    notice?.revision !== input.revision ||
    notice.failed ||
    notice.acceptedAt === null
  )
    return { state: "notice_pending", usableSince };
  if (notice.acceptedAt > input.now || notice.acceptedAt < baseline + delay)
    return {
      state: "protected",
      reason: "interest_notice_invalid",
      resetUsableClock: false,
    };
  const replyBy = notice.acceptedAt + INTEREST_POLICY.replyMs;
  return input.now < replyBy
    ? { state: "reply_pending", replyBy, usableSince }
    : { state: "release", reason: "lost_interest", stateAfter: "expired" };
}
