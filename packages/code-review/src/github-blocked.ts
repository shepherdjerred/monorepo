/**
 * Detecting a provider-side block that makes review impossible (quota /
 * usage-limit exhaustion). The provider answers with an issue comment instead
 * of a review, so completion never arrives and the gate would poll to its
 * deadline and time out. A matched block is a FAILING terminal state — no
 * review happened — reported with the provider's remediation, never a pass.
 */

import { eachIssueComment, recordField, stringField } from "./github-http.ts";
import { reactionBoundToHead } from "./head-pushed-at.ts";
import { isProviderAuthor } from "./identity.ts";
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
}): Promise<string | null> {
  const blocked = input.provider.detectBlocked;
  if (blocked === null) return null;
  for await (const item of eachIssueComment(input)) {
    const user = recordField(item, "user");
    if (
      isBoundBlockedComment({
        strategy: blocked,
        provider: input.provider,
        login: user === null ? null : stringField(user, "login"),
        body: stringField(item, "body"),
        updatedAt:
          stringField(item, "updated_at") ?? stringField(item, "created_at"),
        headPushedAt: input.headPushedAt,
      })
    ) {
      return blocked.reason;
    }
  }
  return null;
}
