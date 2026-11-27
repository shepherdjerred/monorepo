import { z } from "zod";

export const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

export const ActorSchema = z
  .object({ login: z.string(), __typename: z.string() })
  .nullable();

export const RollupStateSchema = z.enum([
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "PENDING",
  "EXPECTED",
]);

export const ReviewNodeSchema = z.object({
  state: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  commit: z.object({ oid: z.string() }).nullable(),
});

export const OpenPullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.url(),
  author: ActorSchema,
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  reviewDecision: z
    .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
    .nullable(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  headRefName: z.string(),
  baseRefName: z.string().default("main"),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          oid: z.string(),
          statusCheckRollup: z.object({ state: RollupStateSchema }).nullable(),
        }),
      }),
    ),
  }),
  reviews: z
    .object({ nodes: z.array(ReviewNodeSchema.nullable()) })
    .default({ nodes: [] }),
});

export const MergedPullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.url(),
  headRefName: z.string().optional(),
  author: ActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
});

export const CommitSchema = z.object({
  oid: z.string(),
  messageHeadline: z.string(),
  committedDate: z.string(),
  url: z.url(),
});

export const GraphqlRateLimitSchema = z.object({
  rateLimit: z.object({
    limit: z.number().int().nonnegative(),
    cost: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    resetAt: z.string(),
    used: z.number().int().nonnegative(),
  }),
});

export const RestRateLimitSchema = z.object({
  resources: z.object({
    core: z.object({
      limit: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      used: z.number().int().nonnegative(),
      reset: z.number().int().nonnegative(),
    }),
  }),
});

export const PullRequestBodySchema = z.object({
  repository: z.object({
    pullRequest: z
      .object({
        number: z.number().int(),
        title: z.string(),
        body: z.string(),
        headRefName: z.string(),
        url: z.url(),
      })
      .nullable(),
  }),
});

export const RestReleaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable().optional(),
  html_url: z.url(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  created_at: z.string(),
});

type GitHubReleaseNote = {
  tagName: string;
  name: string;
  body: string;
  url: string;
  prerelease: boolean;
  publishedAt: string | null;
};

export function toGitHubReleaseNote(
  release: z.infer<typeof RestReleaseSchema>,
): GitHubReleaseNote {
  return {
    tagName: release.tag_name,
    name: release.name ?? release.tag_name,
    body: release.body ?? "",
    url: release.html_url,
    prerelease: release.prerelease,
    publishedAt: release.published_at ?? release.created_at,
  };
}

export const RestCompareSchema = z.object({
  ahead_by: z.number().int().nonnegative(),
  html_url: z.url(),
  commits: z.array(
    z.object({
      sha: z.string(),
      commit: z.object({
        message: z.string(),
        committer: z
          .object({ date: z.string().optional() })
          .nullable()
          .optional(),
        author: z.object({ date: z.string().optional() }).nullable().optional(),
      }),
    }),
  ),
});

const EXACT_APPROVER_LOGIN = "shepherdjerred";

export function toAuthor(
  actor: z.infer<typeof ActorSchema>,
): { login: string; kind: "user" | "bot" } | undefined {
  return actor === null
    ? undefined
    : {
        login: actor.login,
        kind: actor.__typename === "Bot" ? "bot" : "user",
      };
}

export function isExactHeadApproved(
  headOid: string | undefined,
  reviews: readonly (z.infer<typeof ReviewNodeSchema> | null)[],
): boolean {
  if (headOid === undefined) {
    return false;
  }
  let approvedOnHead = false;
  for (const review of reviews) {
    if (review?.author?.login !== EXACT_APPROVER_LOGIN) {
      continue;
    }
    if (review.state === "APPROVED") {
      approvedOnHead = review.commit?.oid === headOid;
    } else if (
      review.state === "CHANGES_REQUESTED" ||
      review.state === "DISMISSED"
    ) {
      approvedOnHead = false;
    }
  }
  return approvedOnHead;
}

export function connection<T extends z.ZodType>(item: T) {
  return z.object({ pageInfo: PageInfoSchema, nodes: z.array(item) });
}

export const OPEN_PULL_REQUESTS = `
query OpenPullRequests($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft createdAt updatedAt reviewDecision mergeable headRefName baseRefName
        author { login __typename }
        labels(first: 20) { nodes { name } }
        commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
        reviews(last: 20) { nodes { state author { login } commit { oid } } }
      }
    }
  }
}`;

export const MERGED_PULL_REQUESTS = `
query MergedPullRequests($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 100, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { number title url headRefName createdAt updatedAt mergedAt author { login __typename } }
    }
  }
}`;

export const PATH_HISTORY = `
query PathHistory($owner: String!, $name: String!, $ref: String!, $path: String!, $since: GitTimestamp!, $after: String) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target {
        ... on Commit {
          history(path: $path, since: $since, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { oid messageHeadline committedDate url }
          }
        }
      }
    }
  }
}`;

export const BRANCH_HEAD = `
query BranchHead($owner: String!, $name: String!, $ref: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target {
        ... on Commit { oid messageHeadline committedDate url statusCheckRollup { state } }
      }
    }
  }
}`;

export const ISSUE_SEARCH = `
query IssueSearch($query: String!) {
  search(query: $query, type: ISSUE, first: 5) {
    nodes { ... on Issue { number title url body } }
  }
}`;

export const PULL_REQUEST_BODY = `
query PullRequestBody($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title body headRefName url
    }
  }
}`;

export const GRAPHQL_RATE_LIMIT = `
query RateLimit {
  rateLimit { limit cost remaining resetAt used }
}`;
