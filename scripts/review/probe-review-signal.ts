/**
 * Ad-hoc probe: dump the code-review provider's signal shape for one or more
 * PRs, so we can see "what the reviewer did and when" and confirm open
 * questions (e.g. where Codex attaches its 👍 clean-review reaction, whether it
 * re-reviews on push). Output is one JSON object per PR — the same
 * `ReviewSignalEvent` the CI gate emits plus the raw building blocks — suitable
 * as test fixtures for `@shepherdjerred/code-review`.
 *
 * Defaults to the provider the CI review gate requires, so its output explains
 * that gate; set `REVIEW_PROVIDER` to inspect a different one.
 *
 * Usage:
 *   GH_TOKEN=$(gh auth token) bun scripts/review/probe-review-signal.ts 1645 1643 1638
 *   REVIEW_PROVIDER=codex GH_TOKEN=… bun scripts/review/probe-review-signal.ts 2079
 */

import {
  blockingPolicyForThreshold,
  isBlocking,
  isProviderAuthor,
  REVIEW_SIGNAL_SCHEMA,
  resolveProvider,
  resolveRequiredReviewProvider,
  tallyFindings,
  type ReviewSignalEvent,
} from "@shepherdjerred/code-review";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import {
  fetchLatestProviderReview,
  fetchProviderThumbsUp,
  fetchReviewThreads,
  resolveReviewState,
} from "@shepherdjerred/code-review/github";
import { z } from "zod";

const DEFAULT_REPO = "shepherdjerred/monorepo";

const PrHeadSchema = z.object({ head: z.object({ sha: z.string() }) });

async function fetchHeadSha(
  repo: string,
  prNumber: number,
  token: string,
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${String(prNumber)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Could not read PR #${String(prNumber)}: ${String(response.status)} ${response.statusText}`,
    );
  }
  const parsed = PrHeadSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new TypeError(`PR #${String(prNumber)} response had no head.sha`);
  }
  return parsed.data.head.sha;
}

async function probePr(
  repo: string,
  prNumber: number,
  token: string,
): Promise<void> {
  // Default to the provider the CI gate enforces, not the provider-neutral
  // default. This probe exists to explain a red review gate, so answering about
  // a different provider than the gate polls reports unrelated threads as the
  // reason it is stuck. `REVIEW_PROVIDER` still selects another provider.
  const configured = Bun.env["REVIEW_PROVIDER"];
  const provider =
    configured === undefined || configured.trim() === ""
      ? resolveRequiredReviewProvider()
      : resolveProvider(configured);
  const head = await fetchHeadSha(repo, prNumber, token);

  // Head push time first — `resolveReviewState` needs it to bind a provider's
  // commit-less completion signal to the current head.
  const headPushedAt = await fetchHeadPushedAt({
    repo,
    sha: head,
    prNumber,
    token,
  });
  // Resolve state before the rest so the thread fetch can reuse the issue
  // comment it read. Fetching that comment twice would let one call see the
  // provider's re-rendered comment and the other its previous revision, and
  // the probe would report a state and a finding set that never coexisted.
  const state = await resolveReviewState({
    provider,
    repo,
    head,
    prNumber,
    token,
    headPushedAt,
  });
  const [threadResult, latestReview, thumbsUp] = await Promise.all([
    fetchReviewThreads({
      repo,
      number: prNumber,
      token,
      provider,
      issueComment: state.issueComment,
    }),
    fetchLatestProviderReview({ repo, number: prNumber, token, provider }),
    fetchProviderThumbsUp({ repo, number: prNumber, token, provider }),
  ]);

  const providerThreads = threadResult.threads.filter(
    (thread) =>
      isProviderAuthor(provider, thread.authorLogin) && !thread.isOutdated,
  );
  const blocking = threadResult.threads.filter((thread) =>
    isBlocking(thread, provider, blockingPolicyForThreshold(3)),
  );
  // Latency only when the reviewed commit IS the head (else a stale review of
  // an older commit yields a bogus/negative value).
  const atHead = state.reviewedCommit === head;
  const reviewedAt = atHead ? state.reviewedAt : null;
  const latencyS =
    reviewedAt !== null && headPushedAt !== null
      ? Math.round((Date.parse(reviewedAt) - Date.parse(headPushedAt)) / 1000)
      : null;

  const event: ReviewSignalEvent = {
    schema: REVIEW_SIGNAL_SCHEMA,
    ts: new Date().toISOString(),
    provider: provider.id,
    pr: prNumber,
    head_sha: head,
    head_pushed_at: headPushedAt,
    review_state:
      state.completionSignal === "thumbsup-reaction"
        ? "reviewed-clean-reaction"
        : state.state,
    completion_signal: state.completionSignal,
    reviewed_at_head: atHead,
    latency_s: latencyS,
    findings: tallyFindings(providerThreads.map((thread) => thread.priority)),
    blocking_count: blocking.length,
    unresolved_count: providerThreads.filter((thread) => !thread.isResolved)
      .length,
    gate_wait_s: null,
    timed_out: false,
    stale_reaction: state.staleReaction,
    decision: null,
    // A probe reads state; it never asks for a review.
    request_attempts: null,
    // Which parser produced these counts. A probe run from a stale checkout
    // reads the repository's stale parser and reports numbers that disagree
    // with CI for reasons that have nothing to do with the PR.
    parser_commit: parserCommit(),
  };

  console.log(
    JSON.stringify(
      {
        event,
        raw: {
          headRefOid: threadResult.headRefOid,
          latestProviderReview: latestReview,
          thumbsUpFromProvider: thumbsUp,
          providerThreads: providerThreads.map((thread) => ({
            authorLogin: thread.authorLogin,
            priority: thread.priority,
            isResolved: thread.isResolved,
            isOutdated: thread.isOutdated,
            // What the finding says, plus the handles needed to act on it and
            // the key it was deduplicated by. Without these a caller has a
            // count and a filename, and has to re-derive everything else by
            // hand from the raw GitHub payloads.
            title: thread.title,
            path: thread.path,
            line: thread.line,
            url: thread.url,
            threadId: thread.threadId,
            commentId: thread.commentId,
            findingKey: provider.findingKey?.(thread) ?? null,
          })),
        },
      },
      null,
      2,
    ),
  );
}

/**
 * The commit this probe's copy of `code-review` came from.
 *
 * The probe imports the parser from the checkout it runs in, so its numbers
 * describe that checkout's parser rather than CI's. Reporting the commit is
 * what lets a caller see a disagreement for what it is.
 */
function parserCommit(): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: import.meta.dir,
  });
  if (result.exitCode !== 0) return null;
  const sha = result.stdout.toString().trim();
  return sha === "" ? null : sha;
}

async function main(): Promise<void> {
  const prNumbers = Bun.argv
    .slice(2)
    .map((arg) => Number.parseInt(arg, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (prNumbers.length === 0) {
    throw new Error(
      "Usage: GH_TOKEN=$(gh auth token) bun scripts/review/probe-review-signal.ts <pr> [<pr> …]",
    );
  }
  const token = Bun.env["GH_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new Error("GH_TOKEN is required (try: GH_TOKEN=$(gh auth token))");
  }
  const repo = Bun.env["GITHUB_REPOSITORY"]?.trim() ?? DEFAULT_REPO;
  for (const prNumber of prNumbers) {
    await probePr(repo, prNumber, token);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
