/**
 * PR-only merge gate: passes once the configured code-review provider has
 * finished reviewing the PR head commit AND every provider review comment that
 * still applies to the latest revision has been resolved.
 *
 * The gate logic is provider-neutral, but the required CI boundary runs once
 * for Qodo and once for Codex. All provider-specific knowledge — how completion is detected, how
 * severity badges are parsed, and how a deliberate skip is signalled — lives
 * in `@shepherdjerred/code-review`. This script only drives the poll loop and
 * emits structured `review-signal` observability events.
 *
 * Why not just wait for the provider's own status check? Greptile's check goes
 * green as soon as the review *completes*, regardless of whether its comments
 * were addressed; Codex posts no check at all. So we gate on resolved review
 * threads and use the provider's completion signal only as the "reviewed this
 * head?" marker.
 */

import {
  type BlockingPolicy,
  blockingPolicyForThreshold,
  evaluateGate,
  formatSignalEvent,
  resolveProvider,
  reviewGateSkipReasonForAuthor,
  resolveRequiredReviewProvider,
  type GateDecision,
  type PullRequestAuthor,
  type ReviewProvider,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import { buildSignalEvent } from "./lib/review-gate-signal.ts";
import {
  DEFAULT_REQUEST_GRACE_SECONDS,
  DEFAULT_REQUEST_RETRY_SECONDS,
  ensureReviewRequested,
  requestGraceSecondsForProvider,
  warnIfFirstReviewIsOversized,
} from "./lib/review-gate-policy.ts";
import {
  fetchPullRequestAuthor,
  fetchReviewThreads,
  resolveReviewState,
  type ReviewStateResult,
} from "@shepherdjerred/code-review/github";

const DEFAULT_REPO = "shepherdjerred/monorepo";
/**
 * Qodo routinely needs longer than this gate used to allow. Two completed
 * reviews were measured at 1637s and 1834s while the budget was 1200s, so the
 * gate reported `timed_out` on reviews that were progressing normally and the
 * PR went red for a reason unrelated to its diff.
 *
 * This value is an empirical ceiling over those samples plus margin. It is
 * explicitly **not** a proof of sufficiency: a ~51-line PR was still reviewing
 * when a 2400s budget expired, so latency does not scale with diff size and
 * behaves more like provider-side queue depth, which no constant bounds. Treat
 * this as raising the share of reviews that finish inside the build, not as a
 * guarantee that they all will. Overshooting costs idle polling in a light pod;
 * undershooting costs a false red on a healthy PR, so the asymmetry favours
 * headroom.
 *
 * It also has to hold the request schedule. The gate waits a grace period before
 * asking at all and may ask once more after that, so the deadline must leave the
 * slowest review we have watched complete still able to finish after the LAST
 * request — otherwise the retry is advertised and then cut off.
 * `reviewRequestScheduleBounds()` states that relation and
 * `wait-for-review.test.ts` asserts it, which is why raising the retry interval
 * without raising this fails the suite rather than silently disabling the
 * retry.
 *
 * The durable fix is ordering rather than duration — not starting the gate
 * until the review exists — but that is a CI-architecture change, not a
 * constant.
 *
 * The `review-gate` step allows longer still — by a margin sized for its
 * unbounded `toolchain.sh` and install preamble, not a token few minutes — so
 * this deadline is always the binding one and the timeout message names the
 * provider and head commit instead of Buildkite killing the pod anonymously.
 * `wait-for-review.test.ts` asserts that ordering against the pipeline,
 * reading the step's own declared timeout rather than the first one it finds.
 */
export const DEFAULT_TIMEOUT_SECONDS = 60 * 60;
const DEFAULT_INTERVAL_SECONDS = 30;

export function resolveReviewGateProvider(
  configuredProvider: string | undefined,
): ReviewProvider {
  const normalized = configuredProvider?.trim().toLowerCase();
  const ciProviders = new Set(["qodo", "codex"]);
  if (
    normalized !== undefined &&
    normalized !== "" &&
    !ciProviders.has(normalized)
  ) {
    throw new Error(
      `CI review gate requires Qodo or Codex; REVIEW_PROVIDER was ${String(configuredProvider)}.`,
    );
  }
  if (normalized === undefined || normalized === "") {
    return resolveRequiredReviewProvider();
  }
  return resolveProvider(normalized);
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Bun.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return parsed;
}

export function parseMaxBlockingPriority(
  raw = Bun.env["REVIEW_MAX_BLOCKING_PRIORITY"],
): number {
  const value = raw?.trim();
  if (value === undefined || value === "") return 3;
  if (!/^[0-3]$/.test(value)) {
    throw new Error(
      `REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3], got ${raw ?? ""}`,
    );
  }
  return Number.parseInt(value, 10);
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
  if (code !== null && TRANSPORT_FAILURE_CODES.has(code)) return true;
  return TRANSPORT_FAILURE_RE.test(message);
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
  const provider = resolveReviewGateProvider(Bun.env["REVIEW_PROVIDER"]);
  const policy = blockingPolicyForThreshold(parseMaxBlockingPriority());
  const timeoutSeconds = parsePositiveIntegerEnv(
    "REVIEW_WAIT_TIMEOUT_SECONDS",
    DEFAULT_TIMEOUT_SECONDS,
  );
  const intervalSeconds = parsePositiveIntegerEnv(
    "REVIEW_WAIT_INTERVAL_SECONDS",
    DEFAULT_INTERVAL_SECONDS,
  );
  const retryAfterSeconds = parsePositiveIntegerEnv(
    "REVIEW_REQUEST_RETRY_SECONDS",
    DEFAULT_REQUEST_RETRY_SECONDS,
  );
  const configuredGraceSeconds = parsePositiveIntegerEnv(
    "REVIEW_REQUEST_GRACE_SECONDS",
    DEFAULT_REQUEST_GRACE_SECONDS,
  );
  const graceSeconds = requestGraceSecondsForProvider(
    provider,
    configuredGraceSeconds,
  );

  console.log(
    `Review gate: provider=${provider.id}, repo=${repo}, pr=#${String(number)}, head=${head}, ` +
      `timeout=${String(timeoutSeconds)}s, blockingPriority<=P${String(policy.maxBlockingPriority)}, ` +
      `lowSeverity=${policy.lowSeverity}.`,
  );

  await pollReviewGate({
    provider,
    repo,
    number,
    head,
    token,
    policy,
    graceSeconds,
    retryAfterSeconds,
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
  policy: BlockingPolicy;
  graceSeconds: number;
  retryAfterSeconds: number;
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
  requestAttempts: number;
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
    policy,
    graceSeconds,
    retryAfterSeconds,
    timeoutSeconds,
    intervalSeconds,
  } = config;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;
  let warnedMismatch = false;
  let warnedOversizedFirstReview = false;
  // The head push time is REQUIRED for the clean-review 👍 binding (not
  // telemetry-only), so it is fetched INSIDE the retry loop and CACHED only once
  // a real timestamp resolves. A null result is deliberately NOT cached: the
  // ref-update event can be briefly unavailable right after a push (GitHub has
  // not exposed the Repository Activity event yet), so re-fetch on later polls
  // rather than poison the whole wait — a transient failure or not-yet-visible
  // event must not permanently mark every later reaction as stale.
  let headPushedAt: string | null = null;
  let pullRequestAuthor: PullRequestAuthor | null = null;
  let lastState: ReviewStateResult | null = null;
  let lastThreads: readonly ReviewThread[] = [];
  let lastPollError: Error | null = null;
  // Whether this run has already asked the provider to review the head. The
  // marker check makes a duplicate request impossible anyway; this avoids
  // paying for a comment scan on every poll.
  // The next request attempt to make for this head, 1-based. Incremented only
  // once an attempt has actually been posted, so a poll that decides it is too
  // early to escalate re-decides on the next one.
  let attempt = 1;

  while (Date.now() <= deadline) {
    let stateResult: ReviewStateResult;
    let threadResult: { threads: ReviewThread[]; headRefOid: string | null };
    try {
      pullRequestAuthor ??= await fetchPullRequestAuthor({
        repo,
        number,
        token,
      });
      const authorSkipReason = reviewGateSkipReasonForAuthor({
        author: pullRequestAuthor,
        provider,
      });
      if (authorSkipReason !== null) {
        console.log(
          JSON.stringify({
            level: "info",
            msg: "review-gate-skipped",
            component: "review-gate",
            reason: authorSkipReason,
            provider: provider.id,
            repo,
            pr: number,
            head_sha: head,
            author_login: pullRequestAuthor.login,
            author_type: pullRequestAuthor.type,
          }),
        );
        console.log(
          `Skipping ${provider.displayName} review gate for bot-authored PR #${String(number)} (${pullRequestAuthor.login}).`,
        );
        return;
      }

      // Review-at-head and issue-comment providers bind their completion to the
      // exact head push. A check-run provider (e.g. Greptile) never reads this
      // timestamp, so don't make the Activity endpoint a prerequisite for a
      // gate that can otherwise pass on a valid check-run.
      if (
        provider.completion.kind === "review-at-head" ||
        provider.completion.kind === "issue-comment"
      ) {
        headPushedAt ??= await fetchHeadPushedAt({
          repo,
          sha: head,
          prNumber: number,
          token,
        });
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
        // Reuse the comment resolveReviewState just fetched: it makes both
        // decisions describe the identical snapshot and avoids paginating the
        // whole comment history twice on every poll.
        issueComment: stateResult.issueComment,
      });

      // Ask for the review this loop is waiting on, once we have seen that the
      // provider has not already reviewed this head. Kept inside the same retry
      // boundary as the reads above: a transient failure while checking or
      // posting the request must not fail the gate immediately.
      attempt = await ensureReviewRequested({
        repo,
        number,
        head,
        token,
        provider,
        attempt,
        graceSeconds,
        retryAfterSeconds,
        headPushedAt,
        startedAt,
        reviewedCommit: stateResult.reviewedCommit,
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
      policy,
      skipReason: stateResult.skipReason,
    });

    if (!warnedOversizedFirstReview) {
      warnedOversizedFirstReview = warnIfFirstReviewIsOversized({
        provider,
        number,
        threads: threadResult.threads,
      });
    }

    emitSignal({
      config,
      headPushedAt,
      state: stateResult,
      threads: threadResult.threads,
      startedAt,
      timedOut: false,
      decision,
      // Attempts already made, not the next one queued up.
      requestAttempts: attempt - 1,
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
    requestAttempts: attempt - 1,
  });

  if (lastPollError !== null) {
    throw new Error(
      `Timed out after ${String(timeoutSeconds)}s waiting for ${provider.displayName} to review ${repo}@${head}; ` +
        `the most recent GitHub query kept failing transiently: ${lastPollError.message}`,
    );
  }
  throw new Error(
    `Timed out after ${String(timeoutSeconds)}s waiting for ${provider.displayName} to finish reviewing ${repo}@${head}. ` +
      `Confirm it is enabled and authors reviews/threads as one of [${provider.authorLogins.join(", ")}].`,
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
