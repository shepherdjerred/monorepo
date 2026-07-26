/**
 * Ad-hoc probe: dump the code-review provider's signal shape for one or more
 * PRs, so we can see "what the reviewer did and when" and confirm open
 * questions (e.g. where Codex attaches its 👍 clean-review reaction, whether it
 * re-reviews on push). Output is one JSON object per PR — the same
 * `ReviewSignalEvent` the CI gate emits plus the raw building blocks — suitable
 * as test fixtures for `@shepherdjerred/code-review`.
 *
 * Usage:
 *   GH_TOKEN=$(gh auth token) bun scripts/probe-review-signal.ts 1645 1643 1638
 *   REVIEW_PROVIDER=greptile GH_TOKEN=… bun scripts/probe-review-signal.ts 1026
 */

import {
  isBlocking,
  isProviderAuthor,
  REVIEW_SIGNAL_SCHEMA,
  resolveProvider,
  tallyFindings,
  type ReviewSignalEvent,
} from "@shepherdjerred/code-review";
import {
  fetchCommitCommittedAt,
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
  const provider = resolveProvider(Bun.env["REVIEW_PROVIDER"]);
  const head = await fetchHeadSha(repo, prNumber, token);

  const [threadResult, state, latestReview, thumbsUp, headPushedAt] =
    await Promise.all([
      fetchReviewThreads({ repo, number: prNumber, token, provider }),
      resolveReviewState({ provider, repo, head, prNumber, token }),
      fetchLatestProviderReview({ repo, number: prNumber, token, provider }),
      fetchProviderThumbsUp({ repo, number: prNumber, token, provider }),
      fetchCommitCommittedAt({ repo, sha: head, token }),
    ]);

  const providerThreads = threadResult.threads.filter(
    (thread) =>
      isProviderAuthor(provider, thread.authorLogin) && !thread.isOutdated,
  );
  const blocking = threadResult.threads.filter((thread) =>
    isBlocking(thread, provider, 3),
  );
  // Latency only when the reviewed commit IS the head (else a stale review of
  // an older commit yields a bogus/negative value).
  const reviewedAt = state.reviewedCommit === head ? state.reviewedAt : null;
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
    latency_s: latencyS,
    findings: tallyFindings(providerThreads.map((thread) => thread.priority)),
    blocking_count: blocking.length,
    unresolved_count: providerThreads.filter((thread) => !thread.isResolved)
      .length,
    gate_wait_s: null,
    timed_out: false,
    stale_reaction: state.staleReaction,
    decision: null,
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
            path: thread.path,
            line: thread.line,
          })),
        },
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const prNumbers = Bun.argv
    .slice(2)
    .map((arg) => Number.parseInt(arg, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (prNumbers.length === 0) {
    throw new Error(
      "Usage: GH_TOKEN=$(gh auth token) bun scripts/probe-review-signal.ts <pr> [<pr> …]",
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
