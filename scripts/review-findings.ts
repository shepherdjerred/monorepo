#!/usr/bin/env bun
/**
 * Inspect and clear what the required review gate is blocking on.
 *
 * Two things make this necessary. Qodo does not strike a finding it has
 * re-read and no longer stands behind — it re-lists it verbatim — so a PR
 * whose findings are all fixed or all wrong can stay blocked through any
 * number of re-reviews. And a fix pushed without resolving its thread costs a
 * full gate cycle (~7 minutes) to discover, because nothing surfaces the
 * unresolved thread earlier.
 *
 * `list` is the pre-push check for the second problem. `dismiss` is the
 * audited escape hatch for the first: it never runs on its own, requires a
 * reason per finding, and records every dismissal in a PR comment so the
 * decision is reviewable rather than an invisible edit to a bot's comment.
 *
 * Usage:
 *   GH_TOKEN=$(gh auth token) bun scripts/review-findings.ts list 2104
 *   GH_TOKEN=$(gh auth token) bun scripts/review-findings.ts dismiss 2104 \
 *     --finding "S3 fetch lacks timeout" --reason "fixed in 10224eabd"
 *   GH_TOKEN=$(gh auth token) bun scripts/review-findings.ts resolve-thread 2104 \
 *     --thread PRRT_kwDO… --reason "fixed in e4ec2f6db"
 */
import {
  isBlocking,
  markQodoFindingResolved,
  resolveProvider,
  resolveRequiredReviewProvider,
  severityLabel,
  type ReviewProvider,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import {
  fetchReviewThreads,
  resolveReviewState,
} from "@shepherdjerred/code-review/github";
import { z } from "zod";

const DEFAULT_REPO = "shepherdjerred/monorepo";
const GITHUB_API = "https://api.github.com";
/** Matches the CI gate's default, so `list` reports what the gate will block on. */
const MAX_BLOCKING_PRIORITY = 3;
const AUDIT_MARKER = "<!-- review-findings:dismissals -->";

const PrSchema = z.object({ head: z.object({ sha: z.string() }) });
const CommentSchema = z.object({ id: z.number(), body: z.string() });
const GraphqlResponseSchema = z.object({
  errors: z.array(z.object({ message: z.string() }).loose()).optional(),
  data: z
    .object({
      resolveReviewThread: z
        .object({ thread: z.object({ isResolved: z.boolean() }).loose() })
        .nullish(),
    })
    .nullish(),
});

function requireToken(): string {
  const token = Bun.env["GH_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new Error("GH_TOKEN is required (GH_TOKEN=$(gh auth token)).");
  }
  return token;
}

function activeProvider(): ReviewProvider {
  const configured = Bun.env["REVIEW_PROVIDER"];
  return configured === undefined || configured.trim() === ""
    ? resolveRequiredReviewProvider()
    : resolveProvider(configured);
}

async function githubJson(
  method: "GET" | "POST" | "PATCH",
  url: string,
  token: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(
      `${method} ${url} failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  return await response.json();
}

/**
 * Why a resolveReviewThread mutation did not succeed, or null when it did.
 *
 * GraphQL reports failure in the body with HTTP 200, so a status check alone
 * would let a failed resolution be recorded as a dismissal — and that audit
 * entry is what someone later trusts.
 */
export function resolveThreadOutcome(payload: unknown): string | null {
  const parsed = GraphqlResponseSchema.parse(payload);
  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    return parsed.errors.map((error) => error.message).join("; ");
  }
  if (parsed.data?.resolveReviewThread?.thread.isResolved !== true) {
    return "the mutation returned no confirmation that the thread is resolved";
  }
  return null;
}

/**
 * The numeric id of the comment behind an `html_url`. The library models a
 * review comment by body/url because reading never needs the id; editing does.
 */
export function commentIdFromUrl(url: string | null): number {
  const matched = /#issuecomment-(\d+)/u.exec(url ?? "");
  const id = matched?.[1];
  if (id === undefined) {
    throw new Error(
      `could not read a comment id from ${url ?? "(no url)"} — expected an #issuecomment-<id> anchor`,
    );
  }
  return Number.parseInt(id, 10);
}

/**
 * One line per finding: severity, what it is, and where to read it.
 *
 * Only comment-parsed findings carry a title; a thread opened on the diff is
 * identified by its location instead, so it leads with that rather than a
 * placeholder that says nothing.
 */
export function describeFinding(thread: ReviewThread): string {
  const severity = severityLabel(thread.priority);
  const location =
    thread.path === null
      ? "(general comment)"
      : thread.line === null
        ? thread.path
        : `${thread.path}:${String(thread.line)}`;
  const headline =
    thread.title === null ? location : `${thread.title} — ${location}`;
  const url = thread.url === null ? "" : `\n      ${thread.url}`;
  return `  ${severity} ${headline}${url}`;
}

/** The audit comment body, rebuilt from every dismissal recorded so far. */
export function auditCommentBody(
  entries: readonly { finding: string; reason: string }[],
): string {
  const rows = entries
    .map((entry) => `- **${entry.finding}** — ${entry.reason}`)
    .join("\n");
  return (
    `${AUDIT_MARKER}\n### Review findings dismissed by an operator\n\n` +
    `Each entry was marked resolved in the review comment after being verified ` +
    `fixed at this head or incorrect. The gate honours the resolved state, so ` +
    `this comment is the record of why.\n\n${rows}\n`
  );
}

export function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument?.startsWith("--") !== true) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    flags.set(argument.slice(2), value);
    index += 1;
  }
  return flags;
}

async function loadThreads(
  repo: string,
  prNumber: number,
  token: string,
  provider: ReviewProvider,
): Promise<{ head: string; threads: readonly ReviewThread[] }> {
  const pr = PrSchema.parse(
    await githubJson(
      "GET",
      `${GITHUB_API}/repos/${repo}/pulls/${String(prNumber)}`,
      token,
    ),
  );
  const head = pr.head.sha;
  const state = await resolveReviewState({
    repo,
    prNumber,
    token,
    provider,
    head,
    headPushedAt: null,
  });
  const result = await fetchReviewThreads({
    repo,
    number: prNumber,
    token,
    provider,
    issueComment: state.issueComment,
  });
  return { head, threads: result.threads };
}

async function listCommand(
  repo: string,
  prNumber: number,
  token: string,
  provider: ReviewProvider,
): Promise<void> {
  const { head, threads } = await loadThreads(repo, prNumber, token, provider);
  const blocking = threads.filter((thread) =>
    isBlocking(thread, provider, MAX_BLOCKING_PRIORITY),
  );
  console.log(
    `${provider.displayName} on ${repo}#${String(prNumber)} @ ${head.slice(0, 9)}`,
  );
  if (blocking.length === 0) {
    console.log("\nNothing is blocking the gate.");
    return;
  }
  console.log(`\n${String(blocking.length)} blocking finding(s):`);
  for (const thread of blocking) console.log(describeFinding(thread));
  console.log(
    `\nFix and re-request a review, or — once verified fixed or incorrect — ` +
      `dismiss with:\n  bun scripts/review-findings.ts dismiss ${String(prNumber)} --finding "<title>" --reason "<why>"`,
  );
}

async function dismissCommand(
  context: {
    repo: string;
    prNumber: number;
    token: string;
    provider: ReviewProvider;
  },
  flags: Map<string, string>,
): Promise<void> {
  const { repo, prNumber, token, provider } = context;
  const finding = flags.get("finding");
  const reason = flags.get("reason");
  if (finding === undefined || reason === undefined || reason.trim() === "") {
    throw new Error(
      'dismiss requires --finding "<title>" and a non-empty --reason "<why>".',
    );
  }
  // The edit understands Qodo's rendered-comment format specifically. Another
  // provider's comment would not match, and the "no finding titled …" error
  // that produced would be misleading — say what is actually unsupported.
  if (provider.id !== "qodo") {
    throw new Error(
      `dismiss only understands Qodo's review comment format; ${provider.displayName} findings must be resolved through their own threads (see \`resolve-thread\`).`,
    );
  }
  const state = await resolveReviewState({
    repo,
    prNumber,
    token,
    provider,
    head: PrSchema.parse(
      await githubJson(
        "GET",
        `${GITHUB_API}/repos/${repo}/pulls/${String(prNumber)}`,
        token,
      ),
    ).head.sha,
    headPushedAt: null,
  });
  const review = state.issueComment;
  if (review === null || review === undefined) {
    throw new Error(
      `${provider.displayName} has posted no review comment on ${repo}#${String(prNumber)}.`,
    );
  }
  const edited = markQodoFindingResolved(review.body, finding);
  if (edited === null) {
    throw new Error(
      `no finding titled "${finding}" in the review comment. Run \`list\` to see the exact titles.`,
    );
  }
  const commentId = commentIdFromUrl(review.url);
  await githubJson(
    "PATCH",
    `${GITHUB_API}/repos/${repo}/issues/comments/${String(commentId)}`,
    token,
    { body: edited },
  );
  await recordDismissal(repo, prNumber, token, { finding, reason });
  console.log(`Dismissed "${finding}" and recorded the reason on the PR.`);
}

/**
 * The audit comment, searched across every page.
 *
 * A single page is not enough: a long-lived PR easily passes 100 comments, and
 * missing the existing comment does not fail — it silently posts a second one,
 * splitting the dismissal record across two places just when it matters.
 */
async function findAuditComment(
  repo: string,
  prNumber: number,
  token: string,
): Promise<{ id: number; body: string } | undefined> {
  for (let page = 1; ; page += 1) {
    const batch = z
      .array(CommentSchema.loose())
      .parse(
        await githubJson(
          "GET",
          `${GITHUB_API}/repos/${repo}/issues/${String(prNumber)}/comments?per_page=100&page=${String(page)}`,
          token,
        ),
      );
    const found = batch.find((comment) => comment.body.includes(AUDIT_MARKER));
    if (found !== undefined) return found;
    if (batch.length < 100) return undefined;
  }
}

/** Append to the single audit comment, creating it on the first dismissal. */
async function recordDismissal(
  repo: string,
  prNumber: number,
  token: string,
  entry: { finding: string; reason: string },
): Promise<void> {
  const existing = await findAuditComment(repo, prNumber, token);
  const previous = (existing?.body ?? "")
    .split("\n")
    .filter((line) => line.startsWith("- **"))
    .map((line) => {
      const matched = /^- \*\*(.+?)\*\* — (.+)$/u.exec(line);
      return matched === null
        ? null
        : { finding: matched[1] ?? "", reason: matched[2] ?? "" };
    })
    .filter((value) => value !== null);
  const body = auditCommentBody([
    ...previous.filter((item) => item.finding !== entry.finding),
    entry,
  ]);
  if (existing === undefined) {
    await githubJson(
      "POST",
      `${GITHUB_API}/repos/${repo}/issues/${String(prNumber)}/comments`,
      token,
      { body },
    );
    return;
  }
  await githubJson(
    "PATCH",
    `${GITHUB_API}/repos/${repo}/issues/comments/${String(existing.id)}`,
    token,
    { body },
  );
}

async function resolveThreadCommand(
  repo: string,
  prNumber: number,
  token: string,
  flags: Map<string, string>,
): Promise<void> {
  const threadId = flags.get("thread");
  const reason = flags.get("reason");
  if (threadId === undefined || reason === undefined || reason.trim() === "") {
    throw new Error(
      'resolve-thread requires --thread <id> and a non-empty --reason "<why>".',
    );
  }
  const response = await fetch(`${GITHUB_API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        "mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }",
      variables: { id: threadId },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `resolveReviewThread failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  const failure = resolveThreadOutcome(await response.json());
  if (failure !== null) {
    throw new Error(`resolveReviewThread failed for ${threadId}: ${failure}`);
  }
  await recordDismissal(repo, prNumber, token, {
    finding: `thread ${threadId}`,
    reason,
  });
  console.log(`Resolved ${threadId} and recorded the reason on the PR.`);
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  bun scripts/review-findings.ts list <pr>",
      '  bun scripts/review-findings.ts dismiss <pr> --finding "<title>" --reason "<why>"',
      '  bun scripts/review-findings.ts resolve-thread <pr> --thread <id> --reason "<why>"',
      "",
      "GH_TOKEN is required. REVIEW_PROVIDER overrides the gate's provider.",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, prArgument, ...rest] = Bun.argv.slice(2);
  if (command === undefined || prArgument === undefined) usage();
  const prNumber = Number.parseInt(prArgument, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`"${prArgument}" is not a pull request number.`);
  }
  const repo = Bun.env["GITHUB_REPOSITORY"] ?? DEFAULT_REPO;
  const token = requireToken();
  const provider = activeProvider();
  const flags = parseFlags(rest);

  switch (command) {
    case "list":
      await listCommand(repo, prNumber, token, provider);
      return;
    case "dismiss":
      await dismissCommand({ repo, prNumber, token, provider }, flags);
      return;
    case "resolve-thread":
      await resolveThreadCommand(repo, prNumber, token, flags);
      return;
    default:
      usage();
  }
}

if (import.meta.main) {
  await main();
}
