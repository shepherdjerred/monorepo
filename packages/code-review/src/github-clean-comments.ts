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

/** Find the latest provider completion comment, then bind its coverage to head. */
export async function fetchCleanCompletionComment(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  head: string;
  headPushedAt: string | null;
}): Promise<{ reviewedAt: string } | null> {
  const { completion } = input.provider;
  if (
    completion.kind !== "review-at-head" ||
    typeof completion.cleanSignal === "string"
  )
    return null;
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments?per_page=100`;
  let latest: { body: string; updatedAt: string } | null = null;
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    if (!Array.isArray(payload))
      throw new TypeError(
        "GitHub clean completion comments response was not an array",
      );
    for (const raw of payload) {
      const candidate = completionCandidate(
        raw,
        input.provider,
        completion.cleanSignal.marker,
      );
      if (candidate === null) continue;
      const { updatedAt } = candidate;
      if (
        latest === null ||
        Date.parse(updatedAt) >= Date.parse(latest.updatedAt)
      )
        latest = candidate;
    }
    url = linkNext;
  }
  return latest === null ||
    !reactionBoundToHead(latest.updatedAt, input.headPushedAt) ||
    completion.cleanSignal.parseReviewedHead(latest.body) !== input.head
    ? null
    : { reviewedAt: latest.updatedAt };
}
