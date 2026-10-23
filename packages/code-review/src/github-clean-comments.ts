import {
  asRecord,
  GITHUB_API_URL,
  getJsonWithLink,
  recordField,
  stringField,
} from "./github-http.ts";
import { reactionBoundToHead } from "./head-pushed-at.ts";
import { isProviderAuthor } from "./identity.ts";
import type { ReviewProvider } from "./types.ts";

function completionCandidate(
  raw: unknown,
  provider: ReviewProvider,
  marker: string,
): { body: string; updatedAt: string } | null {
  const item = asRecord(raw);
  if (item === null) return null;
  const user = recordField(item, "user");
  if (
    !isProviderAuthor(
      provider,
      user === null ? null : stringField(user, "login"),
    )
  )
    return null;
  const body = stringField(item, "body");
  if (body?.includes(marker) !== true) return null;
  const updatedAt = stringField(item, "updated_at");
  if (updatedAt === null || !Number.isFinite(Date.parse(updatedAt)))
    throw new TypeError("GitHub completion comment has no valid updated_at");
  return { body, updatedAt };
}

/**
 * Whether a reviewed commit named in a comment is `head`. Providers may name
 * an abbreviation (Codex writes ten characters); seven is Git's shortest.
 */
export function namesHead(reviewed: string | null, head: string): boolean {
  return (
    reviewed !== null &&
    reviewed.length >= 7 &&
    head.toLowerCase().startsWith(reviewed.toLowerCase())
  );
}

/** Every page of completion comments: the latest, and any for another head. */
async function scanCompletionComments(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  marker: string;
  namesOtherHead: (body: string) => boolean;
}): Promise<{
  latest: { body: string; updatedAt: string } | null;
  earlierHead: boolean;
}> {
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments?per_page=100`;
  let latest: { body: string; updatedAt: string } | null = null;
  let earlierHead = false;
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    if (!Array.isArray(payload))
      throw new TypeError(
        "GitHub clean completion comments response was not an array",
      );
    for (const raw of payload) {
      const candidate = completionCandidate(raw, input.provider, input.marker);
      if (candidate === null) continue;
      if (input.namesOtherHead(candidate.body)) earlierHead = true;
      if (
        latest === null ||
        Date.parse(candidate.updatedAt) >= Date.parse(latest.updatedAt)
      )
        latest = candidate;
    }
    url = linkNext;
  }
  return { latest, earlierHead };
}

/**
 * Find the latest provider completion comment, then bind its coverage to head.
 *
 * Also reports whether any clean completion names a different commit: the
 * provider already finished a review round on this pull request.
 */
export async function fetchCleanCompletionComment(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  head: string;
  headPushedAt: string | null;
}): Promise<{
  atHead: { reviewedAt: string } | null;
  earlierHead: boolean;
}> {
  const { completion } = input.provider;
  if (
    completion.kind !== "review-at-head" ||
    typeof completion.cleanSignal === "string"
  )
    return { atHead: null, earlierHead: false };
  const { cleanSignal } = completion;
  const { latest, earlierHead } = await scanCompletionComments({
    ...input,
    marker: cleanSignal.marker,
    namesOtherHead: (body) => {
      const reviewed = cleanSignal.parseReviewedHead(body);
      return reviewed !== null && !namesHead(reviewed, input.head);
    },
  });
  const atHead =
    latest === null ||
    !reactionBoundToHead(latest.updatedAt, input.headPushedAt) ||
    !namesHead(cleanSignal.parseReviewedHead(latest.body), input.head)
      ? null
      : { reviewedAt: latest.updatedAt };
  return { atHead, earlierHead };
}
