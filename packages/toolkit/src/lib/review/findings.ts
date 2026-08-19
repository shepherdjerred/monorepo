/**
 * Reading and clearing a code-review provider's findings on a pull request.
 *
 * A provider may render the same finding on more than one surface — Qodo posts
 * each one both inside its persistent review comment and as an addressable
 * thread on the offending line — and each surface is cleared through a
 * different API. `@shepherdjerred/code-review` already merges them into one
 * finding carrying both handles; this turns that into something a person can
 * act on in a single step.
 */

import {
  isProviderAuthor,
  resolveRequiredReviewProvider,
  type ReviewProvider,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import {
  fetchReviewThreads,
  resolveReviewState,
  type ReviewStateResult,
} from "@shepherdjerred/code-review/github";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import { markQodoFindingResolved } from "@shepherdjerred/code-review/qodo";
import { z } from "zod";

const GITHUB_API = "https://api.github.com";

const PrHeadSchema = z.object({ head: z.object({ sha: z.string() }) });
const CommentSchema = z.object({ id: z.number(), body: z.string() });

export type Finding = {
  key: string;
  title: string | null;
  priority: number | null;
  path: string | null;
  line: number | null;
  isResolved: boolean;
  threadId: string | null;
  commentId: number | null;
  url: string | null;
};

/** Every provider finding on the PR, deduplicated across surfaces. */
export async function listFindings(input: {
  repo: string;
  number: number;
  token: string;
  provider?: ReviewProvider | undefined;
  head?: string | undefined;
}): Promise<{
  head: string;
  findings: Finding[];
  reviewState: ReviewStateResult;
}> {
  const provider = input.provider ?? resolveRequiredReviewProvider();
  const head = input.head ?? (await fetchHeadSha(input));
  const state = await resolveReviewState({
    provider,
    repo: input.repo,
    head,
    prNumber: input.number,
    token: input.token,
    headPushedAt: await fetchHeadPushedAt({
      repo: input.repo,
      sha: head,
      prNumber: input.number,
      token: input.token,
    }),
  });
  const { threads } = await fetchReviewThreads({
    repo: input.repo,
    number: input.number,
    token: input.token,
    provider,
    issueComment: state.issueComment,
  });
  const findings = threads
    .filter(
      (thread) =>
        isProviderAuthor(provider, thread.authorLogin) && !thread.isOutdated,
    )
    .map((thread, index) => toFinding(thread, provider, index));
  return { head, findings, reviewState: state };
}

/**
 * Whether the provider has finished reviewing this exact head, and how it said
 * so. The harvest rule needs both: a gate that failed while the review was
 * still running is stale, one that failed with no review at all is not.
 */
export async function reviewStateFor(input: {
  repo: string;
  number: number;
  token: string;
  head: string;
  provider?: ReviewProvider;
}): Promise<{ reviewedAtHead: boolean; completionSignal: string }> {
  const provider = input.provider ?? resolveRequiredReviewProvider();
  const state = await resolveReviewState({
    provider,
    repo: input.repo,
    head: input.head,
    prNumber: input.number,
    token: input.token,
    headPushedAt: await fetchHeadPushedAt({
      repo: input.repo,
      sha: input.head,
      prNumber: input.number,
      token: input.token,
    }),
  });
  return {
    reviewedAtHead: state.reviewedCommit === input.head,
    completionSignal: state.completionSignal,
  };
}

/**
 * A key for a finding the provider cannot identify.
 *
 * `resolve` re-lists the findings before matching the key it was given, so a
 * purely positional key names whatever finding happens to be in that slot the
 * second time — a reordered list would clear the wrong thread. A GitHub node id
 * names one exact surface forever, so it is preferred wherever one exists.
 *
 * Two unidentifiable findings inside the same review comment do collapse to the
 * same key, and that is the safe direction: `resolve` refuses an ambiguous key
 * rather than picking one. The positional last resort is reached only by a
 * finding with neither handle, which `resolveFinding` cannot act on at all.
 */
export function fallbackKey(thread: ReviewThread, index: number): string {
  if (thread.threadId !== null) return `thread:${thread.threadId}`;
  if (thread.commentId !== null) return `comment:${String(thread.commentId)}`;
  return `#${String(index + 1)}`;
}

function toFinding(
  thread: ReviewThread,
  provider: ReviewProvider,
  index: number,
): Finding {
  return {
    key: provider.findingKey?.(thread) ?? fallbackKey(thread, index),
    title: thread.title,
    priority: thread.priority,
    path: thread.path,
    line: thread.line,
    isResolved: thread.isResolved,
    threadId: thread.threadId,
    commentId: thread.commentId,
    url: thread.url,
  };
}

export type ResolveOutcome = {
  chippedComment: boolean;
  resolvedThread: boolean;
};

/**
 * Clear one finding on every surface it appears on.
 *
 * Both surfaces are cleared even though the gate now treats either as
 * sufficient: leaving one behind means the next reader still sees the finding
 * open, and the point of this command is that a finding is one thing.
 */
export async function resolveFinding(input: {
  repo: string;
  number: number;
  token: string;
  finding: Finding;
  evidence: string;
}): Promise<ResolveOutcome> {
  const outcome: ResolveOutcome = {
    chippedComment: false,
    resolvedThread: false,
  };

  if (input.finding.commentId !== null && input.finding.title !== null) {
    outcome.chippedComment = await chipComment({
      repo: input.repo,
      token: input.token,
      commentId: input.finding.commentId,
      title: input.finding.title,
    });
  }

  // Asking first is what makes this idempotent, and it is what `chipComment`
  // already does by comparing the body it would write. Resolving unconditionally
  // posted a second copy of the evidence on a thread that was already resolved,
  // and reported "resolved the review thread" for work it had not done.
  if (
    input.finding.threadId !== null &&
    !(await threadIsResolved(input.token, input.finding.threadId))
  ) {
    await replyToThread(input.token, input.finding.threadId, input.evidence);
    await resolveThread(input.token, input.finding.threadId);
    outcome.resolvedThread = true;
  }

  return outcome;
}

/** Append the resolved chip to a finding in the provider's review comment. */
async function chipComment(input: {
  repo: string;
  token: string;
  commentId: number;
  title: string;
}): Promise<boolean> {
  const url = `${GITHUB_API}/repos/${input.repo}/issues/comments/${String(input.commentId)}`;
  const current = CommentSchema.parse(await getJson(url, input.token));
  const marked = markQodoFindingResolved(current.body, input.title);
  if (marked === null) {
    throw new Error(
      `No finding titled "${input.title}" in comment ${String(input.commentId)}`,
    );
  }
  if (marked === current.body) return false;
  await sendJson("PATCH", url, { body: marked }, input.token);
  return true;
}

async function replyToThread(
  token: string,
  threadId: string,
  body: string,
): Promise<void> {
  await graphql(
    token,
    `
      mutation ($t: ID!, $b: String!) {
        addPullRequestReviewThreadReply(
          input: { pullRequestReviewThreadId: $t, body: $b }
        ) {
          clientMutationId
        }
      }
    `,
    { t: threadId, b: body },
  );
}

const ThreadStateSchema = z.object({
  data: z.object({ node: z.object({ isResolved: z.boolean() }) }),
});

/**
 * Whether the review thread is already resolved.
 *
 * Asked before resolving so the outcome the CLI prints describes what this run
 * did. `resolveReviewThread` is idempotent and reports the state after the
 * mutation, so it cannot answer this on its own.
 */
async function threadIsResolved(
  token: string,
  threadId: string,
): Promise<boolean> {
  const payload = await sendJson(
    "POST",
    `${GITHUB_API}/graphql`,
    {
      query: `
        query ($t: ID!) {
          node(id: $t) {
            ... on PullRequestReviewThread {
              isResolved
            }
          }
        }
      `,
      variables: { t: threadId },
    },
    token,
  );
  assertGraphQlOk(payload);
  return ThreadStateSchema.parse(payload).data.node.isResolved;
}

async function resolveThread(token: string, threadId: string): Promise<void> {
  await graphql(
    token,
    `
      mutation ($t: ID!) {
        resolveReviewThread(input: { threadId: $t }) {
          thread {
            isResolved
          }
        }
      }
    `,
    { t: threadId },
  );
}

export async function fetchHeadSha(input: {
  repo: string;
  number: number;
  token: string;
}): Promise<string> {
  const payload = await getJson(
    `${GITHUB_API}/repos/${input.repo}/pulls/${String(input.number)}`,
    input.token,
  );
  return PrHeadSchema.parse(payload).head.sha;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, { headers: headers(token) });
  if (!response.ok) {
    throw new Error(
      `GET ${url} failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  return response.json();
}

async function sendJson(
  method: string,
  url: string,
  body: unknown,
  token: string,
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${method} ${url} failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  return response.json();
}

const GraphQlSchema = z.object({ errors: z.array(z.unknown()).optional() });

/**
 * Throw unless the payload says the mutation succeeded.
 *
 * GraphQL answers 200 with an `errors` array, so the HTTP status proves
 * nothing. A payload this cannot read is not a success either: `resolveFinding`
 * reports `resolvedThread` from the mere absence of a throw, and the CLI prints
 * "resolved the review thread" from that — so swallowing an unreadable response
 * told an operator a finding was cleared when the outcome was unknown, and left
 * it blocking the gate.
 */
export function assertGraphQlOk(payload: unknown): void {
  const parsed = GraphQlSchema.parse(payload);
  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(parsed.errors)}`);
  }
}

async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<void> {
  assertGraphQlOk(
    await sendJson(
      "POST",
      `${GITHUB_API}/graphql`,
      { query, variables },
      token,
    ),
  );
}
