import { z } from "zod";
import type { Pipeline } from "#src/schemas.ts";

const REVIEW_PAGE_SIZE = 100;
const MAX_REVIEW_PAGES = 10;
const DECISION_REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "DISMISSED",
]);

const ReviewSchema = z.object({
  id: z.number(),
  commit_id: z.string(),
  state: z.string(),
  submitted_at: z.string().nullish(),
  user: z.object({ login: z.string() }).nullable(),
});

const ReviewsSchema = z.array(ReviewSchema);

export type GitHubApprovalOptions = {
  readonly repo: string;
  readonly token: string;
  readonly reviewer: string;
  readonly fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
};

export function pullRequestNumber(pipeline: Pipeline): number {
  const match = /^refs\/pull\/(?<number>[1-9]\d*)\/head$/u.exec(pipeline.ref);
  const value = match?.groups?.["number"];
  if (value === undefined) {
    throw new Error("hosted automation pipeline has no pull request ref");
  }
  return Number(value);
}

/**
 * Require the reviewer's latest effective review to approve this exact head.
 *
 * GitHub retains old reviews after a new push. Matching commit_id prevents an
 * approval for one dependency payload from authorizing code Renovate pushed
 * afterward. A later dismissal or changes-requested review also wins.
 */
export async function hasExactHeadApproval(
  pipeline: Pipeline,
  options: GitHubApprovalOptions,
): Promise<boolean> {
  const requestNumber = pullRequestNumber(pipeline);
  const reviews: z.infer<typeof ReviewSchema>[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let page = 1; page <= MAX_REVIEW_PAGES; page += 1) {
    const url = new URL(
      `https://api.github.com/repos/${options.repo}/pulls/${requestNumber.toString()}/reviews`,
    );
    url.searchParams.set("per_page", REVIEW_PAGE_SIZE.toString());
    url.searchParams.set("page", page.toString());
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(
        `GitHub review lookup failed (${response.status.toString()})`,
      );
    }
    const pageReviews = ReviewsSchema.parse(await response.json());
    reviews.push(...pageReviews);
    if (pageReviews.length < REVIEW_PAGE_SIZE) break;
    if (page === MAX_REVIEW_PAGES) {
      throw new Error("GitHub review lookup exceeded the pagination bound");
    }
  }

  const latest = reviews
    .flatMap((review) => {
      const submittedAt = review.submitted_at;
      return typeof submittedAt === "string" &&
        review.user?.login === options.reviewer &&
        DECISION_REVIEW_STATES.has(review.state)
        ? [{ ...review, submitted_at: submittedAt }]
        : [];
    })
    .toSorted((left, right) => {
      const submitted = left.submitted_at.localeCompare(right.submitted_at);
      return submitted === 0 ? left.id - right.id : submitted;
    })
    .at(-1);

  return latest?.state === "APPROVED" && latest.commit_id === pipeline.commit;
}
