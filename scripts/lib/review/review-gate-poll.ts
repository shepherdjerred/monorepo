/**
 * The review-gate poll loop: one tick per interval across providers, pass
 * confirmation, terminal acceptance, and the deadline.
 *
 * Split out of `scripts/review/wait-for-review.ts`, which sits at the repo's
 * max-lines cap. That script keeps CLI/env/config wiring; everything the loop
 * needs from GitHub in a tick lives in `review-gate-observe.ts`, and
 * everything a tick decides lives here, so adding a provider never touches
 * the loop's shape.
 */

import {
  type BlockingPolicy,
  evaluateMultiGate,
  formatSignalEvent,
  gateExitCode,
  type GateDecision,
  type ProviderGateSnapshot,
  type ReviewProvider,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import { fetchSharedProviderThreads } from "@shepherdjerred/code-review/github-review-snapshot";
import {
  resolveReviewState,
  type ReviewStateResult,
} from "@shepherdjerred/code-review/github";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import { buildSignalEvent } from "./review-gate-signal.ts";
import { warnIfFirstReviewIsOversized } from "./review-gate-policy.ts";
import {
  type GatePollState,
  observeTick,
  type ProviderObservation,
} from "./review-gate-observe.ts";

/** The poll-loop view of the gate config (GateConfig is a superset). */
export type PollLoopConfig = {
  providers: readonly ReviewProvider[];
  repo: string;
  number: number;
  head: string;
  token: string;
  policy: BlockingPolicy;
  configuredGraceSeconds: number;
  retryAfterSeconds: number;
  timeoutSeconds: number;
  intervalSeconds: number;
};

/** A terminal failed gate decision, carrying the exit status it maps to. */
export class ReviewGateFailure extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "ReviewGateFailure";
  }
}

/**
 * Recognized transport-level failure signatures (no HTTP status): the socket
 * dropped, DNS/connection failed, or the request timed out. Covers both
 * libc/undici wording and Bun's native fetch phrasing ("Unable to connect. Is
 * the computer able to access the url?" / "Failed to open socket").
 */
const TRANSPORT_FAILURE_RE =
  /socket connection was closed|socket hang up|fetch failed|failed to open socket|unable to connect|able to access the url|connection (?:closed|refused|reset|timed out)|network|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|timed out|timeout/iu;

/**
 * Recognized transport-level error CODES. Bun surfaces refused/closed/timed-out
 * connections with a string `code` (e.g. `ConnectionRefused`,
 * `ConnectionClosed`, `FailedToOpenSocket`) that carries no HTTP status, so
 * matching the code catches failures whose message wording may vary.
 */
const TRANSPORT_FAILURE_CODES = new Set<string>([
  "ConnectionRefused",
  "ConnectionClosed",
  "ConnectionResetByPeer",
  "FailedToOpenSocket",
  "Timeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
]);

/** Read a transport error `code` from the error or its `cause`, when present. */
function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? errorCode(error.cause) : null;
}

/**
 * Whether a GitHub query error during the poll loop is worth retrying rather
 * than failing the gate. Retry ONLY recognized transient failures — a 5xx
 * response, or a transport-level failure (socket closed/refused, DNS error,
 * timeout — by message OR error code). Everything else fails fast so the step
 * doesn't hold a Buildkite agent until the gate deadline: a 4xx (bad token
 * / missing permission), a GraphQL application-error payload (HTTP 200 +
 * `errors`), and — critically — an unexpected-shape / invariant error thrown by
 * our own parsers (e.g. `parseThreadPage` when `reviewThreads` is missing) all
 * carry neither an HTTP status nor a transport signature, so they propagate.
 */
function isRetryablePollError(error: Error): boolean {
  const message = error.message;
  const httpStatus = /request failed with (\d{3})/u.exec(message);
  if (httpStatus !== null) {
    const code = Number.parseInt(httpStatus[1] ?? "", 10);
    return code >= 500 && code <= 599;
  }
  const code = errorCode(error);
  return (
    (code !== null && TRANSPORT_FAILURE_CODES.has(code)) ||
    TRANSPORT_FAILURE_RE.test(message)
  );
}

/** Log one structured `review-signal` event for one provider's observation. */
function emitSignal(input: {
  config: PollLoopConfig;
  provider: ReviewProvider;
  headPushedAt: string | null;
  state: ReviewStateResult;
  threads: readonly ReviewThread[];
  startedAt: number;
  timedOut: boolean;
  decision: GateDecision | null;
  requestAttempts: number;
}): void {
  const { config } = input;
  console.log(
    formatSignalEvent(
      buildSignalEvent({
        provider: input.provider,
        pr: config.number,
        head: config.head,
        headPushedAt: input.headPushedAt,
        state: input.state,
        threads: input.threads,
        policy: config.policy,
        gateWaitSeconds: Math.round((Date.now() - input.startedAt) / 1000),
        timedOut: input.timedOut,
        decision: input.decision,
        requestAttempts: input.requestAttempts,
      }),
    ),
  );
}

/** A synthetic "nothing observed yet" review state for the terminal timeout
 * event when every poll failed transiently and no snapshot was captured. */
const UNOBSERVED_STATE: ReviewStateResult = {
  state: "reviewing",
  completionSignal: "none",
  reviewedCommit: null,
  reviewedAt: null,
  staleReaction: false,
  skipReason: null,
  blockedReason: null,
};

/**
 * Evaluate one tick across providers: warn once about head movement and
 * oversized first reviews, emit one signal event per provider, and report
 * the combined decision. Returns true when the gate passed; throws
 * ReviewGateFailure when it failed terminally.
 */
function concludeTick(
  config: PollLoopConfig,
  poll: GatePollState,
  observed: readonly ProviderObservation[],
  startedAt: number,
): boolean {
  const { number, head, policy } = config;
  const mismatch = observed.find(
    (observation) =>
      observation.headRefOid !== null && observation.headRefOid !== head,
  );
  const movedHead = mismatch?.headRefOid ?? null;
  if (movedHead !== null && !poll.warnedMismatch) {
    console.warn(
      `PR #${String(number)} head is now ${movedHead}, but this build is for ${head}; evaluating ${head}.`,
    );
    poll.warnedMismatch = true;
  }

  const snapshots: ProviderGateSnapshot[] = observed.flatMap((observation) =>
    observation.state === null
      ? []
      : [
          {
            provider: observation.provider,
            reviewState: observation.state.state,
            threads: observation.threads,
            skipReason: observation.state.skipReason,
            blockedReason: observation.state.blockedReason,
          },
        ],
  );
  const decision = evaluateMultiGate({ head, providers: snapshots, policy });

  for (const observation of observed) {
    if (
      !poll.warnedOversized.has(observation.provider.id) &&
      warnIfFirstReviewIsOversized({
        provider: observation.provider,
        number,
        threads: observation.threads,
      })
    ) {
      poll.warnedOversized.add(observation.provider.id);
    }
    emitSignal({
      config,
      provider: observation.provider,
      headPushedAt: poll.headPushedAt,
      state: observation.state ?? UNOBSERVED_STATE,
      threads: observation.threads,
      startedAt,
      timedOut: false,
      decision: observation.decision,
      // Attempts already made, not the next one queued up.
      requestAttempts: (poll.attempts.get(observation.provider.id) ?? 1) - 1,
    });
  }

  if (decision.state === "passed") {
    console.log(decision.message);
    return true;
  }
  if (decision.state === "failed") {
    throw new ReviewGateFailure(decision.message, gateExitCode(decision));
  }
  console.log(decision.message);
  return false;
}

/**
 * Emit one terminal `timed_out` signal event per provider, then throw the
 * deadline error. Never returns.
 */
export function failAtDeadline(
  config: PollLoopConfig,
  poll: GatePollState,
  startedAt: number,
  lastPollError: Error | null,
): never {
  const { providers, repo, head, timeoutSeconds } = config;
  for (const provider of providers) {
    const last = poll.lastObservations.get(provider.id);
    emitSignal({
      config,
      provider,
      headPushedAt: poll.headPushedAt,
      state: last?.state ?? UNOBSERVED_STATE,
      threads: last?.threads ?? [],
      startedAt,
      timedOut: true,
      decision: null,
      requestAttempts: (poll.attempts.get(provider.id) ?? 1) - 1,
    });
  }

  const names = providers.map((provider) => provider.displayName).join(", ");
  if (lastPollError !== null) {
    throw new Error(
      `Timed out after ${String(timeoutSeconds)}s waiting for ${names} to review ${repo}@${head}; ` +
        `the most recent GitHub query kept failing transiently: ${lastPollError.message}`,
    );
  }
  const logins = providers
    .flatMap((provider) => [...provider.authorLogins])
    .join(", ");
  throw new Error(
    `Timed out after ${String(timeoutSeconds)}s waiting for ${names} to finish reviewing ${repo}@${head}. ` +
      `Confirm each is enabled and authors reviews/threads as one of [${logins}].`,
  );
}

/**
 * How many consecutive passing ticks it takes to accept a pass. Provider
 * snapshots within one tick are fetched sequentially, so a P0 posted by an
 * earlier provider after its fetch — but before a later provider's clean
 * snapshot in the same tick — would otherwise be missed: acceptance is
 * terminal and the next tick never runs. Failing decisions still throw
 * immediately; only acceptance waits for confirmation.
 */
export const PASS_CONFIRMATION_TICKS = 2;

export type PassConfirmation = { streak: number; accepted: boolean };

/** Pure transition for the pass-confirmation rule (see PASS_CONFIRMATION_TICKS). */
export function confirmPass(passed: boolean, streak: number): PassConfirmation {
  const next = passed ? streak + 1 : 0;
  return { streak: next, accepted: next >= PASS_CONFIRMATION_TICKS };
}

/**
 * Final veto re-check before terminal acceptance. Every provider's threads
 * come from ONE shared {@link ReviewListing} fetched up front, then each
 * provider partitions that same snapshot in memory: a P0 posted after one
 * provider's sequential fetch — while a later provider's multi-page fetch is
 * still running — can no longer slip through a mixed-time acceptance.
 * Completion state is re-resolved fresh per provider — a review dismissed
 * after the confirming tick reads as unresolved, never as reviewed. Throws
 * on a blocking failure (fail fast, like any tick); returns true only when
 * the fresh evaluation still passes. `fetchShared` and `resolveCompletion`
 * are injectable for tests.
 */
export async function verifyPassBeforeAccepting(input: {
  repo: string;
  number: number;
  head: string;
  token: string;
  policy: BlockingPolicy;
  observed: readonly ProviderObservation[];
  fetchShared?: (
    providers: readonly ReviewProvider[],
  ) => Promise<ReadonlyMap<string, readonly ReviewThread[]>>;
  resolveCompletion?: (provider: ReviewProvider) => Promise<ReviewStateResult>;
}): Promise<boolean> {
  const { repo, number, head, token, policy, observed } = input;
  const targets = observed.flatMap((observation) => {
    const { state } = observation;
    return state === null ? [] : [{ provider: observation.provider }];
  });
  // Defensive: the tick-null path never reaches verification, so there is
  // always something to re-check. Fail closed — keep polling, accept nothing.
  if (targets.length === 0) return false;
  const fetch =
    input.fetchShared ??
    (async (providers: readonly ReviewProvider[]) => {
      const { byProvider } = await fetchSharedProviderThreads({
        repo,
        number,
        token,
        providers,
        evaluateHead: head,
      });
      return byProvider;
    });
  const byProvider = await fetch(targets.map((target) => target.provider));
  let pushedAt: string | null | undefined;
  const resolve =
    input.resolveCompletion ??
    (async (provider: ReviewProvider) => {
      pushedAt ??= await fetchHeadPushedAt({
        repo,
        sha: head,
        prNumber: number,
        token,
      });
      return resolveReviewState({
        provider,
        repo,
        head,
        prNumber: number,
        token,
        headPushedAt: pushedAt,
      });
    });
  const snapshots: ProviderGateSnapshot[] = [];
  for (const target of targets) {
    const threads = byProvider.get(target.provider.id);
    // Fail closed: an incomplete re-check keeps polling, accepts nothing.
    if (threads === undefined) return false;
    // Fresh completion, not the confirming tick's: a dismissal after that
    // tick resolves here and can no longer be accepted as reviewed.
    const fresh = await resolve(target.provider);
    snapshots.push({
      provider: target.provider,
      reviewState: fresh.state,
      threads: [...threads],
      skipReason: fresh.skipReason,
      blockedReason: fresh.blockedReason,
    });
  }
  const decision = evaluateMultiGate({
    head,
    providers: snapshots,
    policy,
  });
  if (decision.state === "failed") {
    throw new ReviewGateFailure(decision.message, gateExitCode(decision));
  }
  return decision.state === "passed";
}

/** Mutable per-run state for the poll loop (see pollOnce). */
export type PollLoopState = {
  passStreak: number;
  lastPollError: Error | null;
};

/** Record a retryable poll error and reset the pass streak; rethrow anything else. */
function noteTransientPollError(state: PollLoopState, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (!isRetryablePollError(err)) throw err;
  state.lastPollError = err;
  state.passStreak = 0;
  console.warn(
    `Transient error querying GitHub for the review gate (will retry until the deadline): ${err.message}`,
  );
}

/**
 * Run one poll iteration: observe every provider, conclude the tick, and
 * fold the decision into the pass-confirmation streak. Returns true when a
 * pass has been confirmed and the gate is decided; throws on a blocking
 * failure or a non-retryable error (both propagate to the caller).
 */
export async function pollOnce(
  config: PollLoopConfig,
  poll: GatePollState,
  startedAt: number,
  state: PollLoopState,
): Promise<boolean> {
  let observed: ProviderObservation[];
  try {
    const tick = await observeTick(config, poll, startedAt);
    // Unanimous skip passes, but through the same confirmation as any
    // other pass: a skipped provider's stale P0 is still a snapshot taken
    // mid-tick and must survive a second observation to be trusted absent.
    if (tick === null) {
      state.passStreak = confirmPass(true, state.passStreak).streak;
      return state.passStreak >= PASS_CONFIRMATION_TICKS;
    }
    observed = tick;
  } catch (error) {
    noteTransientPollError(state, error);
    return false;
  }
  state.lastPollError = null;
  const passed = concludeTick(config, poll, observed, startedAt);
  const confirmation = confirmPass(passed, state.passStreak);
  state.passStreak = confirmation.streak;
  if (!confirmation.accepted) {
    if (passed) {
      console.log(
        `Pass observed for ${config.head}; confirming on the next tick before accepting, so a P0 posted mid-tick still vetoes.`,
      );
    }
    return false;
  }
  // Terminal acceptance: re-fetch veto state first. A failure here throws
  // (fail fast); a transient fetch error resets the streak and retries;
  // anything less than a fresh pass keeps polling.
  try {
    if (
      await verifyPassBeforeAccepting({
        repo: config.repo,
        number: config.number,
        head: config.head,
        token: config.token,
        policy: config.policy,
        observed,
      })
    )
      return true;
  } catch (error) {
    // ReviewGateFailure is not retryable, so it propagates here unchanged.
    noteTransientPollError(state, error);
    return false;
  }
  state.passStreak = 0;
  return false;
}
