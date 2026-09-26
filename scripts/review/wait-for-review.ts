/**
 * PR-only merge gate: passes once the configured code-review provider has
 * finished reviewing the PR head commit AND every provider review comment that
 * still applies to the latest revision has been resolved.
 *
 * The gate logic is provider-neutral, but the required CI boundary currently
 * runs for Codex. All provider-specific knowledge — how completion is detected, how
 * severity badges are parsed, and how a deliberate skip is signalled — lives
 * in `@shepherdjerred/code-review`. This script only drives the poll loop and
 * emits structured `review-signal` observability events.
 *
 * Why not just wait for the provider's own status check? Codex posts no check
 * at all, and a check-run provider's check goes green as soon as the review
 * *completes*, regardless of whether its comments were addressed. So we gate
 * on resolved review threads and use the provider's completion signal only as
 * the "reviewed this head?" marker.
 */

import {
  type BlockingPolicy,
  blockingPolicyForThreshold,
  evaluateMultiGate,
  formatSignalEvent,
  gateExitCode,
  type GateDecision,
  type ProviderGateSnapshot,
  type ReviewProvider,
  type ReviewThread,
  resolveProvider,
  resolveRequiredReviewProvider,
  REVIEW_GATE_FAILURE_EXIT_CODE,
} from "@shepherdjerred/code-review";
import { buildSignalEvent } from "../lib/review/review-gate-signal.ts";
import {
  DEFAULT_REQUEST_GRACE_SECONDS,
  DEFAULT_REQUEST_RETRY_SECONDS,
  validateReviewRequestSchedule,
  warnIfFirstReviewIsOversized,
} from "../lib/review/review-gate-policy.ts";
import {
  type GatePollState,
  observeTick,
  type ProviderObservation,
} from "../lib/review/review-gate-observe.ts";
import type { ReviewStateResult } from "@shepherdjerred/code-review/github";

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
 * The `codex-review-gate` step allows longer still — by a margin sized for its
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
  const ciProviders = new Set(["codex"]);
  if (
    normalized !== undefined &&
    normalized !== "" &&
    !ciProviders.has(normalized)
  ) {
    throw new Error(
      `CI review gate requires Codex; REVIEW_PROVIDER was ${String(configuredProvider)}.`,
    );
  }
  return normalized === undefined || normalized === ""
    ? resolveRequiredReviewProvider()
    : resolveProvider(normalized);
}

/**
 * The providers one gate run waits on. `REVIEW_PROVIDERS` (comma-separated)
 * selects the multi-provider gate; an unknown id fails loudly instead of
 * gating against the wrong bots. Without it, the legacy singular
 * `REVIEW_PROVIDER` keeps its Codex-only contract, and an unset environment
 * defaults to the required provider — today's behavior, unchanged.
 */
export function resolveReviewGateProviders(): ReviewProvider[] {
  const plural = Bun.env["REVIEW_PROVIDERS"];
  if (plural !== undefined && plural.trim() !== "") {
    const ids = [
      ...new Set(
        plural
          .split(",")
          .map((id) => id.trim().toLowerCase())
          .filter((id) => id !== ""),
      ),
    ];
    if (ids.length === 0) {
      throw new Error("REVIEW_PROVIDERS must name at least one provider");
    }
    return ids.map((id) => resolveProvider(id));
  }
  return [resolveReviewGateProvider(Bun.env["REVIEW_PROVIDER"])];
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
  return httpsMatch?.[1] ?? DEFAULT_REPO;
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

/** A terminal failed gate decision, carrying the exit status it maps to. */
class ReviewGateFailure extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "ReviewGateFailure";
  }
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
  const providers = resolveReviewGateProviders();
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
  // The request schedule is validated against the longest grace any enabled
  // provider gets, so the advertised retry always fits inside the deadline.
  const maxGraceSeconds = providers.some(
    (provider) => provider.startsReviewOnPush,
  )
    ? configuredGraceSeconds
    : 0;
  validateReviewRequestSchedule({
    graceSeconds: maxGraceSeconds,
    retryAfterSeconds,
    timeoutSeconds,
  });

  console.log(
    `Review gate: providers=${providers.map((provider) => provider.id).join(",")}, repo=${repo}, pr=#${String(number)}, head=${head}, ` +
      `timeout=${String(timeoutSeconds)}s, blockingPriority<=P${String(policy.maxBlockingPriority)}, ` +
      `lowSeverity=${policy.lowSeverity}.`,
  );

  await pollReviewGate({
    providers,
    repo,
    number,
    head,
    token,
    policy,
    configuredGraceSeconds,
    retryAfterSeconds,
    timeoutSeconds,
    intervalSeconds,
  });
}

type GateConfig = {
  providers: ReviewProvider[];
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

/** Log one structured `review-signal` event for one provider's observation. */
function emitSignal(input: {
  config: GateConfig;
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
  config: GateConfig,
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
function failAtDeadline(
  config: GateConfig,
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
 * Poll GitHub until the gate passes, fails, or the deadline is reached.
 * Resolves cleanly on pass; throws on a blocking failure or a timeout.
 */
async function pollReviewGate(config: GateConfig): Promise<void> {
  const { providers, timeoutSeconds, intervalSeconds } = config;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;
  const poll: GatePollState = {
    headPushedAt: null,
    pullRequestAuthor: null,
    // The marker check makes a duplicate request impossible anyway; the map
    // avoids paying for a comment scan on every poll. Incremented only once
    // an attempt has actually been posted, so a poll that decides it is too
    // early re-decides on the next one.
    attempts: new Map(providers.map((provider) => [provider.id, 1])),
    lastObservations: new Map(),
    warnedMismatch: false,
    warnedOversized: new Set(),
  };
  let lastPollError: Error | null = null;

  while (Date.now() <= deadline) {
    let observed: ProviderObservation[];
    try {
      const tick = await observeTick(config, poll, startedAt);
      if (tick === null) return;
      observed = tick;
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
    if (concludeTick(config, poll, observed, startedAt)) return;
    await Bun.sleep(intervalSeconds * 1000);
  }

  // Deadline reached. Per-provider terminal signal events plus the deadline
  // error live in failAtDeadline; this function never returns.
  failAtDeadline(config, poll, startedAt, lastPollError);
}

if (import.meta.main) {
  try {
    await waitForReview();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    // Only a provider-declared block (quota exhaustion) exits with the status
    // the Buildkite step soft-fails on; timeouts, configuration errors, and
    // findings all keep the hard failure status.
    process.exit(
      error instanceof ReviewGateFailure
        ? error.exitCode
        : REVIEW_GATE_FAILURE_EXIT_CODE,
    );
  }
}
