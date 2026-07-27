/**
 * PR-only merge gate: passes once the configured code-review provider has
 * finished reviewing the PR head commit AND every provider review comment that
 * still applies to the latest revision has been resolved.
 *
 * Provider-neutral: the active provider (Greptile, Codex, …) is chosen by
 * `REVIEW_PROVIDER` (default `codex`). All provider-specific knowledge — how
 * completion is detected (a check-run vs a review-at-head + 👍 reaction), how
 * severity badges are parsed, how a deliberate skip is signalled — lives in
 * `@shepherdjerred/code-review`. This script only drives the poll loop and
 * emits structured `review-signal` observability events.
 *
 * Why not just wait for the provider's own status check? Greptile's check goes
 * green as soon as the review *completes*, regardless of whether its comments
 * were addressed; Codex posts no check at all. So we gate on resolved review
 * threads and use the provider's completion signal only as the "reviewed this
 * head?" marker.
 */

import {
  evaluateGate,
  formatSignalEvent,
  isBlocking,
  isProviderAuthor,
  REVIEW_SIGNAL_SCHEMA,
  resolveProvider,
  tallyFindings,
  type GateDecision,
  type ReviewProvider,
  type ReviewSignalEvent,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import {
  fetchReviewThreads,
  resolveReviewState,
  type ReviewStateResult,
} from "@shepherdjerred/code-review/github";

const DEFAULT_REPO = "shepherdjerred/monorepo";
const DEFAULT_TIMEOUT_SECONDS = 20 * 60;
const DEFAULT_INTERVAL_SECONDS = 30;

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Bun.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return parsed;
}

function parseMaxBlockingPriority(): number {
  const raw = Bun.env["REVIEW_MAX_BLOCKING_PRIORITY"];
  if (raw === undefined || raw.trim() === "") return 3;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw new Error(
      `REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3], got ${raw}`,
    );
  }
  return parsed;
}

function repoFromEnvironment(): string {
  const explicit = Bun.env["GITHUB_REPOSITORY"];
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim();

  const buildkiteRepo = Bun.env["BUILDKITE_REPO"];
  if (buildkiteRepo === undefined || buildkiteRepo.trim() === "") {
    return DEFAULT_REPO;
  }
  const sshMatch = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/u.exec(
    buildkiteRepo,
  );
  if (sshMatch?.[1] !== undefined) return sshMatch[1];
  const httpsMatch = /github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u.exec(
    buildkiteRepo,
  );
  if (httpsMatch?.[1] !== undefined) return httpsMatch[1];
  return DEFAULT_REPO;
}

function latencySeconds(
  reviewedAt: string | null,
  headPushedAt: string | null,
): number | null {
  if (reviewedAt === null || headPushedAt === null) return null;
  const reviewed = Date.parse(reviewedAt);
  const pushed = Date.parse(headPushedAt);
  if (!Number.isFinite(reviewed) || !Number.isFinite(pushed)) return null;
  return Math.round((reviewed - pushed) / 1000);
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
  if ("cause" in error) return errorCode(error.cause);
  return null;
}

/**
 * Whether a GitHub query error during the poll loop is worth retrying rather
 * than failing the gate. Retry ONLY recognized transient failures — a 5xx
 * response, or a transport-level failure (socket closed/refused, DNS error,
 * timeout — by message OR error code). Everything else fails fast so the step
 * doesn't hold a Buildkite agent until the 20-minute deadline: a 4xx (bad token
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
  if (code !== null && TRANSPORT_FAILURE_CODES.has(code)) return true;
  return TRANSPORT_FAILURE_RE.test(message);
}

function buildSignalEvent(input: {
  provider: ReviewProvider;
  pr: number;
  head: string;
  headPushedAt: string | null;
  state: ReviewStateResult;
  threads: readonly ReviewThread[];
  maxBlockingPriority: number;
  gateWaitSeconds: number;
  timedOut: boolean;
  decision: GateDecision | null;
}): ReviewSignalEvent {
  const providerThreads = input.threads.filter(
    (thread) =>
      isProviderAuthor(input.provider, thread.authorLogin) &&
      !thread.isOutdated,
  );
  const blocking = input.threads.filter((thread) =>
    isBlocking(thread, input.provider, input.maxBlockingPriority),
  );
  const reviewState =
    input.state.completionSignal === "thumbsup-reaction"
      ? "reviewed-clean-reaction"
      : input.state.state;
  return {
    schema: REVIEW_SIGNAL_SCHEMA,
    ts: new Date().toISOString(),
    provider: input.provider.id,
    pr: input.pr,
    head_sha: input.head,
    head_pushed_at: input.headPushedAt,
    review_state: reviewState,
    completion_signal: input.state.completionSignal,
    reviewed_at_head: input.state.reviewedCommit === input.head,
    // Latency is only meaningful when the reviewed commit IS the head; a stale
    // review of an older commit must not produce a (possibly negative) latency.
    latency_s:
      input.state.reviewedCommit === input.head
        ? latencySeconds(input.state.reviewedAt, input.headPushedAt)
        : null,
    findings: tallyFindings(providerThreads.map((thread) => thread.priority)),
    blocking_count: blocking.length,
    unresolved_count: providerThreads.filter((thread) => !thread.isResolved)
      .length,
    gate_wait_s: input.gateWaitSeconds,
    timed_out: input.timedOut,
    stale_reaction: input.state.staleReaction,
    decision: input.decision === null ? null : input.decision.state,
  };
}

async function waitForReview(): Promise<void> {
  const pullRequest = Bun.env["BUILDKITE_PULL_REQUEST"];
  if (
    pullRequest === undefined ||
    pullRequest === "" ||
    pullRequest === "false"
  ) {
    console.log("Not a Buildkite pull request build; skipping review gate.");
    return;
  }
  const number = Number.parseInt(pullRequest, 10);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(
      `BUILDKITE_PULL_REQUEST must be a positive integer, got ${pullRequest}`,
    );
  }

  const token = Bun.env["GH_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new Error("GH_TOKEN is required to query GitHub review threads");
  }

  const commit = Bun.env["BUILDKITE_COMMIT"];
  if (commit === undefined || commit.trim() === "") {
    throw new Error("BUILDKITE_COMMIT is required to identify the PR head");
  }
  const head = commit.trim();
  const repo = repoFromEnvironment();
  const provider = resolveProvider(Bun.env["REVIEW_PROVIDER"]);
  const maxBlockingPriority = parseMaxBlockingPriority();
  const timeoutSeconds = parsePositiveIntegerEnv(
    "REVIEW_WAIT_TIMEOUT_SECONDS",
    DEFAULT_TIMEOUT_SECONDS,
  );
  const intervalSeconds = parsePositiveIntegerEnv(
    "REVIEW_WAIT_INTERVAL_SECONDS",
    DEFAULT_INTERVAL_SECONDS,
  );

  console.log(
    `Review gate: provider=${provider.id}, repo=${repo}, pr=#${String(number)}, head=${head}, ` +
      `timeout=${String(timeoutSeconds)}s, blockingPriority<=P${String(maxBlockingPriority)}.`,
  );

  await pollReviewGate({
    provider,
    repo,
    number,
    head,
    token,
    maxBlockingPriority,
    timeoutSeconds,
    intervalSeconds,
  });
}

type GateConfig = {
  provider: ReviewProvider;
  repo: string;
  number: number;
  head: string;
  token: string;
  maxBlockingPriority: number;
  timeoutSeconds: number;
  intervalSeconds: number;
};

/** Log one structured `review-signal` event for the current observation. */
function emitSignal(input: {
  config: GateConfig;
  headPushedAt: string | null;
  state: ReviewStateResult;
  threads: readonly ReviewThread[];
  startedAt: number;
  timedOut: boolean;
  decision: GateDecision | null;
}): void {
  const { config } = input;
  console.log(
    formatSignalEvent(
      buildSignalEvent({
        provider: config.provider,
        pr: config.number,
        head: config.head,
        headPushedAt: input.headPushedAt,
        state: input.state,
        threads: input.threads,
        maxBlockingPriority: config.maxBlockingPriority,
        gateWaitSeconds: Math.round((Date.now() - input.startedAt) / 1000),
        timedOut: input.timedOut,
        decision: input.decision,
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
};

/**
 * Poll GitHub until the gate passes, fails, or the deadline is reached.
 * Resolves cleanly on pass; throws on a blocking failure or a timeout.
 */
async function pollReviewGate(config: GateConfig): Promise<void> {
  const {
    provider,
    repo,
    number,
    head,
    token,
    maxBlockingPriority,
    timeoutSeconds,
    intervalSeconds,
  } = config;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;
  let warnedMismatch = false;
  // The head push time is REQUIRED for the clean-review 👍 binding (not
  // telemetry-only), so it is fetched INSIDE the retry loop: a transient failure
  // on one poll must not permanently poison every later reaction as stale. Once
  // resolved (a real push time, or a definitive null from GitHub) it is cached.
  let headPushedAt: string | null = null;
  let headPushedAtResolved = false;
  let lastState: ReviewStateResult | null = null;
  let lastThreads: readonly ReviewThread[] = [];
  let lastPollError: Error | null = null;

  while (Date.now() <= deadline) {
    let stateResult: ReviewStateResult;
    let threadResult: { threads: ReviewThread[]; headRefOid: string | null };
    try {
      if (!headPushedAtResolved) {
        headPushedAt = await fetchHeadPushedAt({
          repo,
          sha: head,
          prNumber: number,
          token,
        });
        headPushedAtResolved = true;
      }
      // Resolve completion FIRST, then fetch threads AFTER — never
      // concurrently. A concurrent thread query can be captured just before the
      // provider submits its review while the state query lands just after,
      // yielding `reviewed` with the newly-created findings missing from the
      // thread snapshot, which would let the gate pass with unresolved threads.
      // Fetching threads strictly after observing the state guarantees both
      // decisions describe the same (or a fresher) review snapshot.
      stateResult = await resolveReviewState({
        provider,
        repo,
        head,
        prNumber: number,
        token,
        headPushedAt,
      });
      threadResult = await fetchReviewThreads({
        repo,
        number,
        token,
        provider,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!isRetryablePollError(err)) throw err;
      lastPollError = err;
      console.warn(
        `Transient error querying GitHub for the review gate (will retry until the deadline): ${err.message}`,
      );
      await Bun.sleep(intervalSeconds * 1000);
      continue;
    }
    lastPollError = null;
    lastState = stateResult;
    lastThreads = threadResult.threads;

    if (
      !warnedMismatch &&
      threadResult.headRefOid !== null &&
      threadResult.headRefOid !== head
    ) {
      console.warn(
        `PR #${String(number)} head is now ${threadResult.headRefOid}, but this build is for ${head}; evaluating ${head}.`,
      );
      warnedMismatch = true;
    }

    const decision = evaluateGate({
      head,
      provider,
      reviewState: stateResult.state,
      threads: threadResult.threads,
      maxBlockingPriority,
      skipReason: stateResult.skipReason,
    });

    emitSignal({
      config,
      headPushedAt,
      state: stateResult,
      threads: threadResult.threads,
      startedAt,
      timedOut: false,
      decision,
    });

    if (decision.state === "passed") {
      console.log(decision.message);
      return;
    }
    if (decision.state === "failed") {
      throw new Error(decision.message);
    }
    console.log(decision.message);
    await Bun.sleep(intervalSeconds * 1000);
  }

  // Deadline reached. Always emit ONE terminal signal event with
  // `timed_out: true` so consumers can distinguish a genuine timeout from an
  // ordinary waiting poll — even when every poll failed transiently and no
  // snapshot was ever captured (a synthetic "unobserved" state; the underlying
  // error is carried in the thrown message below).
  emitSignal({
    config,
    headPushedAt,
    state: lastState ?? UNOBSERVED_STATE,
    threads: lastThreads,
    startedAt,
    timedOut: true,
    decision: null,
  });

  if (lastPollError !== null) {
    throw new Error(
      `Timed out after ${String(timeoutSeconds)}s waiting for ${provider.displayName} to review ${repo}@${head}; ` +
        `the most recent GitHub query kept failing transiently: ${lastPollError.message}`,
    );
  }
  throw new Error(
    `Timed out after ${String(timeoutSeconds)}s waiting for ${provider.displayName} to finish reviewing ${repo}@${head}. ` +
      `If ${provider.displayName} is enabled, confirm it authors reviews/threads as one of [${provider.authorLogins.join(", ")}] ` +
      `(override the active provider with REVIEW_PROVIDER).`,
  );
}

if (import.meta.main) {
  try {
    await waitForReview();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
