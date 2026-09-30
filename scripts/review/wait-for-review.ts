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
  resolveProvider,
  resolveRequiredReviewProvider,
  REVIEW_GATE_FAILURE_EXIT_CODE,
  type ReviewProvider,
} from "@shepherdjerred/code-review";
import type { GatePollState } from "../lib/review/review-gate-observe.ts";
import {
  failAtDeadline,
  pollOnce,
  type PollLoopState,
  ReviewGateFailure,
} from "../lib/review/review-gate-poll.ts";
import {
  DEFAULT_REQUEST_GRACE_SECONDS,
  DEFAULT_REQUEST_RETRY_SECONDS,
  validateReviewRequestSchedule,
} from "../lib/review/review-gate-policy.ts";

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
 * provider and head commit instead of the step timeout killing the pod
 * anonymously. `wait-for-review.test.ts` asserts that ordering against the
 * generated step, reading its own declared timeout rather than the first one
 * it finds.
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

  const cloneUrl = Bun.env["CI_REPO_CLONE_URL"];
  if (cloneUrl === undefined || cloneUrl.trim() === "") {
    return DEFAULT_REPO;
  }
  const sshMatch = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/u.exec(cloneUrl);
  if (sshMatch?.[1] !== undefined) return sshMatch[1];
  const httpsMatch = /github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u.exec(cloneUrl);
  return httpsMatch?.[1] ?? DEFAULT_REPO;
}

async function waitForReview(): Promise<void> {
  // A non-pull-request build reports a value rather than omitting the
  // variable, so anything that is not a positive integer means "not a pull
  // request" rather than a misconfiguration.
  const pullRequest = Bun.env["CI_COMMIT_PULL_REQUEST"];
  if (pullRequest === undefined || pullRequest === "") {
    console.log("Not a pull request build; skipping review gate.");
    return;
  }
  const number = Number.parseInt(pullRequest, 10);
  if (!Number.isInteger(number) || number <= 0) {
    console.log("Not a pull request build; skipping review gate.");
    return;
  }

  const token = Bun.env["GH_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new Error("GH_TOKEN is required to query GitHub review threads");
  }

  const commit = Bun.env["CI_COMMIT_SHA"];
  if (commit === undefined || commit.trim() === "") {
    throw new Error("CI_COMMIT_SHA is required to identify the PR head");
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
  const state: PollLoopState = { passStreak: 0, lastPollError: null };

  while (Date.now() <= deadline) {
    if (await pollOnce(config, poll, startedAt, state)) return;
    await Bun.sleep(intervalSeconds * 1000);
  }

  // A pass observed on the final tick still deserves its confirmation
  // attempt: without it, a review completing inside the last interval would
  // time out instead of confirming. One immediate extra tick, no sleep — a
  // fresh failure there still fails with findings rather than a timeout.
  if (state.passStreak > 0 && (await pollOnce(config, poll, startedAt, state)))
    return;

  // Deadline reached. Per-provider terminal signal events plus the deadline
  // error live in failAtDeadline; this function never returns.
  failAtDeadline(config, poll, startedAt, state.lastPollError);
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
