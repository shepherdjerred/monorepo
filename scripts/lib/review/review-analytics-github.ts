/**
 * GitHub reads behind `scripts/review/review-analytics.ts`: listing pull requests,
 * reconstructing each provider review of each head, and blaming the line a
 * finding points at.
 *
 * Split from the command layer so the script that prints the tables stays under
 * the repo's max-lines cap, and so the parsing rules — which decide what counts
 * as a round — can be read on their own.
 */

import { PROVIDERS, type ReviewProvider } from "@shepherdjerred/code-review";
import { z } from "zod";

export const DEFAULT_REPO = "shepherdjerred/monorepo";
export const GITHUB_API = "https://api.github.com";

export type ProviderId = "qodo" | "codex";

/** A provider review of one head: which provider, when, and what it flagged. */
export type Round = {
  provider: ProviderId;
  head: string;
  at: string;
  findings: {
    priority: number | null;
    path: string | null;
    line: number | null;
  }[];
};

export type PrRounds = {
  number: number;
  title: string;
  author: string;
  state: string;
  createdAt: string;
  rounds: Round[];
};

export function requireToken(): string {
  const token = Bun.env["GH_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new Error("GH_TOKEN is required (GH_TOKEN=$(gh auth token)).");
  }
  return token;
}

export async function ghAll(path: string, token: string): Promise<unknown[]> {
  let url: string | null = `${GITHUB_API}${path}`;
  const out: unknown[] = [];
  while (url !== null) {
    const response: Response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(
        `GET ${url} failed: ${String(response.status)} ${response.statusText}`,
      );
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new TypeError(`GET ${url} did not return an array`);
    }
    const items: unknown[] = payload;
    out.push(...items);
    const link = response.headers.get("link") ?? "";
    const next = /<([^>]+)>;\s*rel="next"/u.exec(link);
    url = next?.[1] ?? null;
  }
  return out;
}

export async function graphql(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const response = await fetch(`${GITHUB_API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload: unknown = await response.json();
  const parsed = z
    .object({
      errors: z.array(z.object({ message: z.string() }).loose()).optional(),
    })
    .loose()
    .parse(payload);
  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  }
  return payload;
}

export const PrSchema = z.object({
  number: z.number(),
  title: z.string(),
  user: z.object({ login: z.string() }).nullable(),
  state: z.string(),
  draft: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  created_at: z.string(),
});

const ReviewSchema = z.object({
  id: z.number(),
  commit_id: z.string().nullable(),
  submitted_at: z.string().nullable(),
  user: z.object({ login: z.string() }).nullable(),
});

const ReviewCommentSchema = z.object({
  pull_request_review_id: z.number().nullable(),
  body: z.string(),
  path: z.string().nullable(),
  original_line: z.number().nullable(),
  line: z.number().nullable(),
});

export const IssueCommentSchema = z.object({
  body: z.string(),
  created_at: z.string(),
  user: z.object({ login: z.string() }).nullable(),
});

/** The two providers the required gate runs; Greptile is dormant. */
const CI_PROVIDERS: readonly (readonly [ProviderId, ReviewProvider])[] = [
  ["qodo", PROVIDERS.qodo],
  ["codex", PROVIDERS.codex],
];

/** Strip the REST `[bot]` suffix and resolve to a provider we model, or null. */
function providerFor(login: string | null): ProviderId | null {
  if (login === null) return null;
  const bare = login.replace(/\[bot\]$/u, "").toLowerCase();
  for (const [id, provider] of CI_PROVIDERS) {
    if (provider.authorLogins.some((known) => known.toLowerCase() === bare)) {
      return id;
    }
  }
  return null;
}

/** Severity of one finding, via the provider's own badge parser. */
function severityOf(providerId: ProviderId, body: string): number | null {
  return PROVIDERS[providerId].parseSeverity(body);
}

export async function fetchPrRounds(
  repo: string,
  pr: z.infer<typeof PrSchema>,
  token: string,
): Promise<PrRounds> {
  const [rawReviews, rawComments] = await Promise.all([
    ghAll(
      `/repos/${repo}/pulls/${String(pr.number)}/reviews?per_page=100`,
      token,
    ),
    ghAll(
      `/repos/${repo}/pulls/${String(pr.number)}/comments?per_page=100`,
      token,
    ),
  ]);
  const reviews = rawReviews.map((item) => ReviewSchema.parse(item));
  const comments = rawComments.map((item) => ReviewCommentSchema.parse(item));

  const byReview = new Map<number, typeof comments>();
  for (const comment of comments) {
    if (comment.pull_request_review_id === null) continue;
    const bucket = byReview.get(comment.pull_request_review_id) ?? [];
    bucket.push(comment);
    byReview.set(comment.pull_request_review_id, bucket);
  }

  const rounds: Round[] = [];
  for (const review of reviews.toSorted((left, right) =>
    (left.submitted_at ?? "").localeCompare(right.submitted_at ?? ""),
  )) {
    const provider = providerFor(review.user?.login ?? null);
    if (provider === null || review.commit_id === null) continue;
    const own = byReview.get(review.id) ?? [];
    rounds.push({
      provider,
      head: review.commit_id,
      at: review.submitted_at ?? "",
      findings: own.map((comment) => ({
        priority: severityOf(provider, comment.body),
        path: comment.path,
        line: comment.original_line ?? comment.line,
      })),
    });
  }

  return {
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? "unknown",
    state: pr.merged_at == null ? pr.state : "merged",
    createdAt: pr.created_at,
    rounds,
  };
}

/** One pull request by number, for `--pr`. */
export async function fetchPr(
  repo: string,
  number: number,
  token: string,
): Promise<z.infer<typeof PrSchema>> {
  const response = await fetch(
    `${GITHUB_API}/repos/${repo}/pulls/${String(number)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Could not read PR #${String(number)}: ${String(response.status)} ${response.statusText}`,
    );
  }
  return PrSchema.parse(await response.json());
}

export async function listPrs(
  repo: string,
  limit: number,
  token: string,
): Promise<z.infer<typeof PrSchema>[]> {
  const raw = await ghAll(
    `/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=${String(Math.min(limit, 100))}`,
    token,
  );
  return raw.slice(0, limit).map((item) => PrSchema.parse(item));
}

export const BLAME_QUERY = `
query($owner: String!, $name: String!, $expression: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      ... on Commit {
        blame(path: $path) {
          ranges { startingLine endingLine commit { committedDate } }
        }
      }
    }
  }
}`;

export const BlameSchema = z.object({
  data: z.object({
    repository: z
      .object({
        object: z
          .object({
            blame: z.object({
              ranges: z.array(
                z.object({
                  startingLine: z.number(),
                  endingLine: z.number(),
                  commit: z.object({ committedDate: z.string() }),
                }),
              ),
            }),
          })
          .nullable(),
      })
      .nullable(),
  }),
});

/**
 * What share of findings flag a line that did not exist when the pull request
 * was first reviewed — i.e. code the review loop's own fix churn introduced.
 */
