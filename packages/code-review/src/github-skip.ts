import { eachIssueComment, recordField, stringField } from "./github-http.ts";
import { reactionBoundToHead } from "./head-pushed-at.ts";
import { isProviderAuthor } from "./identity.ts";
import type { ReviewProvider, ReviewState, SkipStrategy } from "./types.ts";

function matchesSkipComment(
  item: Record<string, unknown>,
  provider: ReviewProvider,
  skip: SkipStrategy,
  headPushedAt: string | null | undefined,
): string | null {
  const user = recordField(item, "user");
  const login = user === null ? null : stringField(user, "login");
  if (!isProviderAuthor(provider, login)) {
    return null;
  }
  if (
    headPushedAt !== undefined &&
    !reactionBoundToHead(
      stringField(item, "updated_at") ?? stringField(item, "created_at"),
      headPushedAt,
    )
  ) {
    return null;
  }
  const body = stringField(item, "body");
  if (body?.includes(skip.marker) !== true) {
    return null;
  }
  for (const { match, reason } of skip.reasons) {
    if (body.includes(match)) {
      return reason;
    }
  }
  return null;
}

export async function findSkipReason(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  headPushedAt?: string | null | undefined;
}): Promise<string | null> {
  const skip = input.provider.detectSkip;
  if (skip === null) {
    return null;
  }
  for await (const item of eachIssueComment(input)) {
    const matched = matchesSkipComment(
      item,
      input.provider,
      skip,
      input.headPushedAt,
    );
    if (matched !== null) {
      return matched;
    }
  }
  return null;
}

export async function resolveUnblockedSkip(input: {
  blockedReason: string | null;
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  headPushedAt: string | null;
}): Promise<string | null> {
  if (input.blockedReason !== null) {
    return null;
  }
  return findSkipReason({
    repo: input.repo,
    number: input.number,
    token: input.token,
    provider: input.provider,
    headPushedAt: input.headPushedAt,
  });
}

export function skipStateForReason(skipReason: string | null): ReviewState {
  return skipReason === null ? "reviewing" : "reviewed";
}
