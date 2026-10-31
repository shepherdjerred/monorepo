/**
 * Detecting a provider-side block that makes review impossible (quota /
 * usage-limit exhaustion). The provider answers with an issue comment instead
 * of a review, so completion never arrives and the gate would poll to its
 * deadline and time out. A matched block is a FAILING terminal state — no
 * review happened — reported with the provider's remediation, never a pass.
 */

import {
  asRecord,
  eachIssueComment,
  getJsonWithLink,
  GITHUB_API_URL,
  recordField,
  stringField,
} from "./github-http.ts";
import { reactionBoundToHead } from "./head-pushed-at.ts";
import { isProviderAuthor } from "./identity.ts";
import { isCoderabbitRateLimitedStatus } from "./providers/coderabbit.ts";
import type { BlockedSignalStrategy, ReviewProvider } from "./types.ts";

/** True when `body` carries every marker of the provider's blocked signal. */
export function matchesBlockedSignal(
  strategy: BlockedSignalStrategy,
  body: string | null,
): boolean {
  return (
    body !== null && strategy.matches.every((match) => body.includes(match))
  );
}

/**
 * True when one issue comment is the provider telling us this head cannot be
 * reviewed: authored by the provider itself (exact match, so a lookalike login
 * quoting the notice cannot trip it), carrying the blocked signal, and posted
 * at/after the head push.
 */
function isBoundBlockedComment(input: {
  strategy: BlockedSignalStrategy;
  provider: ReviewProvider;
  login: string | null;
  body: string | null;
  updatedAt: string | null;
  headPushedAt: string | null;
}): boolean {
  return (
    isProviderAuthor(input.provider, input.login) &&
    matchesBlockedSignal(input.strategy, input.body) &&
    // The binding rule is the one the clean-review 👍 shares: a commit-less
    // signal only answers for a head it postdates.
    reactionBoundToHead(input.updatedAt, input.headPushedAt)
  );
}

function parseStatusRecords(payload: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const r = asRecord(item);
      if (r !== null) records.push(r);
    }
    return records;
  }
  const rec = asRecord(payload);
  if (rec !== null && "statuses" in rec && Array.isArray(rec["statuses"])) {
    for (const item of rec["statuses"]) {
      const r = asRecord(item);
      if (r !== null) records.push(r);
    }
  }
  return records;
}

async function fetchHeadSha(input: {
  repo: string;
  number: number;
  token: string;
  headSha?: string | null | undefined;
}): Promise<string | null> {
  if (input.headSha !== undefined && input.headSha !== null) {
    return input.headSha;
  }
  try {
    const { payload } = await getJsonWithLink(
      `${GITHUB_API_URL}/repos/${input.repo}/pulls/${String(input.number)}`,
      input.token,
    );
    const pr = asRecord(payload);
    if (pr !== null) {
      const head = recordField(pr, "head");
      if (head !== null) {
        return stringField(head, "sha");
      }
    }
  } catch {
    // Tolerant on fetch failures
  }
  return null;
}

async function fetchCommitStatuses(input: {
  repo: string;
  headSha: string;
  token: string;
}): Promise<Record<string, unknown>[]> {
  for (const endpoint of ["statuses", "status"]) {
    try {
      const { payload } = await getJsonWithLink(
        `${GITHUB_API_URL}/repos/${input.repo}/commits/${input.headSha}/${endpoint}`,
        input.token,
      );
      const records = parseStatusRecords(payload);
      if (records.length > 0) return records;
    } catch {
      // Try next endpoint
    }
  }
  return [];
}

async function checkIssueCommentBlocked(
  input: {
    repo: string;
    number: number;
    token: string;
    provider: ReviewProvider;
    headPushedAt: string | null;
  },
  blocked: readonly BlockedSignalStrategy[],
): Promise<string | null> {
  for await (const item of eachIssueComment(input)) {
    const user = recordField(item, "user");
    for (const strategy of blocked) {
      if (
        isBoundBlockedComment({
          strategy,
          provider: input.provider,
          login: user === null ? null : stringField(user, "login"),
          body: stringField(item, "body"),
          updatedAt:
            stringField(item, "updated_at") ?? stringField(item, "created_at"),
          headPushedAt: input.headPushedAt,
        })
      ) {
        return strategy.reason;
      }
    }
  }
  return null;
}

async function checkCommitStatusRateLimit(input: {
  repo: string;
  token: string;
  headSha: string;
}): Promise<string | null> {
  const statuses = await fetchCommitStatuses(input);
  for (const status of statuses) {
    const context = stringField(status, "context");
    const description = stringField(status, "description");
    if (isCoderabbitRateLimitedStatus(context, description)) {
      return "usage-limited";
    }
  }
  return null;
}

/**
 * The provider's blocked reason for this head, or null when no block applies.
 *
 * Only a provider-authored match posted at/after the head push answers for this
 * head: a limit notice left for an earlier head must not pin a newer one, and
 * an unknown push time leaves the signal unbound (keep waiting) rather than
 * risk a false block. Providers without a blocked signal return null without
 * fetching.
 */
export async function fetchBlockedReason(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  headPushedAt: string | null;
  headSha?: string | null | undefined;
}): Promise<string | null> {
  const blocked = input.provider.detectBlocked;
  if (blocked === null) return null;

  const commentReason = await checkIssueCommentBlocked(input, blocked);
  if (commentReason !== null) return commentReason;

  const headSha = await fetchHeadSha(input);
  if (headSha !== null) {
    return checkCommitStatusRateLimit({
      repo: input.repo,
      token: input.token,
      headSha,
    });
  }

  return null;
}
