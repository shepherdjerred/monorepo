import { z } from "zod";
import {
  bearer,
  fetchJson,
  UpstreamError,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";
import { postGraphql } from "@shepherdjerred/ops-clients/graphql.ts";
import {
  BRANCH_HEAD,
  CommitSchema,
  connection,
  GRAPHQL_RATE_LIMIT,
  GraphqlRateLimitSchema,
  isExactHeadApproved,
  ISSUE_SEARCH,
  MERGED_PULL_REQUESTS,
  MergedPullRequestSchema,
  OPEN_PULL_REQUESTS,
  OpenPullRequestSchema,
  PATH_HISTORY,
  PULL_REQUEST_BODY,
  PullRequestBodySchema,
  RestCompareSchema,
  RestRateLimitSchema,
  RestReleaseSchema,
  RollupStateSchema,
  toAuthor,
} from "@shepherdjerred/ops-clients/github-schemas.ts";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_GRAPHQL_URL = `${GITHUB_API_URL}/graphql`;
const MAX_PAGES = 20;
const RELEASES_PER_PAGE = 100;

export type AuthorKind = "user" | "bot";

export type Author = { login: string; kind: AuthorKind } | undefined;

export type CheckRollup = z.infer<typeof RollupStateSchema> | "NONE";

export type OpenPullRequest = {
  number: number;
  title: string;
  url: string;
  author: Author;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  branch: string;
  baseRefName: string;
  headOid: string | undefined;
  exactHeadApproved: boolean;
  labels: string[];
  checks: CheckRollup;
};

export type MergedPullRequest = {
  number: number;
  title: string;
  url: string;
  branch?: string;
  author: Author;
  createdAt: string;
  mergedAt: string;
};

export type Commit = {
  oid: string;
  headline: string;
  committedAt: string;
  url: string;
};

export type BranchHead = Commit & { checks: CheckRollup };

export type IssueBody = { number: number; url: string; body: string };

export type RateLimitWindow = {
  limit: number;
  remaining: number;
  used: number;
  resetAt: string;
  cost?: number;
};

export type PullRequestBody = {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  url: string;
};

export type GitHubReleaseNote = {
  tagName: string;
  name: string;
  body: string;
  url: string;
  prerelease: boolean;
  publishedAt: string | null;
};

export type CommitComparison = {
  aheadBy: number;
  htmlUrl: string;
  commits: { sha: string; headline: string; committedAt: string }[];
};

function toOpenPullRequest(
  pr: z.infer<typeof OpenPullRequestSchema>,
): OpenPullRequest {
  const headCommit = pr.commits.nodes[0]?.commit;
  const headOid = headCommit?.oid;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: toAuthor(pr.author),
    draft: pr.isDraft,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    reviewDecision: pr.reviewDecision,
    mergeable: pr.mergeable,
    branch: pr.headRefName,
    baseRefName: pr.baseRefName,
    headOid,
    exactHeadApproved: isExactHeadApproved(headOid, pr.reviews.nodes),
    labels: pr.labels.nodes.map((label) => label.name),
    checks: headCommit?.statusCheckRollup?.state ?? "NONE",
  };
}

function toMergedPullRequest(
  pr: z.infer<typeof MergedPullRequestSchema>,
  mergedAt: string,
): MergedPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    ...(pr.headRefName === undefined ? {} : { branch: pr.headRefName }),
    author: toAuthor(pr.author),
    createdAt: pr.createdAt,
    mergedAt,
  };
}

/** Read-only GitHub GraphQL + REST client for repository and upstream delta reads. */
export class GitHubClient {
  readonly #owner: string;
  readonly #name: string;
  readonly #token: () => Promise<string>;
  readonly #fetch: Fetch;

  constructor(options: {
    owner: string;
    name: string;
    token: () => Promise<string>;
    fetch?: Fetch;
  }) {
    this.#owner = options.owner;
    this.#name = options.name;
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  #repository(): { owner: string; name: string } {
    return { owner: this.#owner, name: this.#name };
  }

  async #query<T extends z.ZodType>(
    query: string,
    variables: Record<string, unknown>,
    schema: T,
  ): Promise<z.infer<T>> {
    return await postGraphql(
      this.#fetch,
      {
        upstream: "github",
        url: GITHUB_GRAPHQL_URL,
        headers: bearer(await this.#token()),
        query,
        variables,
      },
      schema,
    );
  }

  async #restGet<T extends z.ZodType>(
    path: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const token = await this.#token();
    return await fetchJson(
      this.#fetch,
      {
        upstream: "github",
        url: `${GITHUB_API_URL}${path}`,
        init: {
          headers: {
            accept: "application/vnd.github+json",
            ...bearer(token),
          },
        },
      },
      schema,
    );
  }

  async openPullRequests(): Promise<OpenPullRequest[]> {
    const Schema = z.object({
      repository: z.object({ pullRequests: connection(OpenPullRequestSchema) }),
    });
    const results: OpenPullRequest[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: z.infer<typeof Schema> = await this.#query(
        OPEN_PULL_REQUESTS,
        { ...this.#repository(), after },
        Schema,
      );
      const { nodes, pageInfo } = data.repository.pullRequests;
      results.push(...nodes.map((pr) => toOpenPullRequest(pr)));
      if (!pageInfo.hasNextPage) {
        return results;
      }
      after = pageInfo.endCursor;
    }
    throw new Error(
      `GitHub open pull requests exceeded ${String(MAX_PAGES)} pages`,
    );
  }

  /**
   * Pull requests merged at or after `since`. Walks merged PRs by update
   * time, newest first, and stops at the first one last updated before
   * `since` (a PR cannot be merged after its last update).
   */
  async mergedPullRequests(since: Date): Promise<MergedPullRequest[]> {
    const Schema = z.object({
      repository: z.object({
        pullRequests: connection(MergedPullRequestSchema),
      }),
    });
    const sinceMs = since.getTime();
    const results: MergedPullRequest[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: z.infer<typeof Schema> = await this.#query(
        MERGED_PULL_REQUESTS,
        { ...this.#repository(), after },
        Schema,
      );
      const { nodes, pageInfo } = data.repository.pullRequests;
      for (const pr of nodes) {
        if (Date.parse(pr.updatedAt) < sinceMs) {
          return results;
        }
        if (pr.mergedAt !== null && Date.parse(pr.mergedAt) >= sinceMs) {
          results.push(toMergedPullRequest(pr, pr.mergedAt));
        }
      }
      if (!pageInfo.hasNextPage) {
        return results;
      }
      after = pageInfo.endCursor;
    }
    throw new Error(
      `GitHub merged pull requests exceeded ${String(MAX_PAGES)} pages`,
    );
  }

  /** Commits on `branch` since `since` that touched `path`. */
  async commitsTouching(input: {
    branch: string;
    path: string;
    since: Date;
  }): Promise<Commit[]> {
    const Schema = z.object({
      repository: z.object({
        ref: z
          .object({ target: z.object({ history: connection(CommitSchema) }) })
          .nullable(),
      }),
    });
    const results: Commit[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: z.infer<typeof Schema> = await this.#query(
        PATH_HISTORY,
        {
          ...this.#repository(),
          ref: `refs/heads/${input.branch}`,
          path: input.path,
          since: input.since.toISOString(),
          after,
        },
        Schema,
      );
      if (data.repository.ref === null) {
        throw new Error(`GitHub branch ${input.branch} does not exist`);
      }
      const { nodes, pageInfo } = data.repository.ref.target.history;
      results.push(
        ...nodes.map((commit) => ({
          oid: commit.oid,
          headline: commit.messageHeadline,
          committedAt: commit.committedDate,
          url: commit.url,
        })),
      );
      if (!pageInfo.hasNextPage) {
        return results;
      }
      after = pageInfo.endCursor;
    }
    throw new Error(`GitHub path history exceeded ${String(MAX_PAGES)} pages`);
  }

  /** The head commit of a branch with its combined check state. */
  async branchHead(branch: string): Promise<BranchHead> {
    const Schema = z.object({
      repository: z.object({
        ref: z
          .object({
            target: CommitSchema.extend({
              statusCheckRollup: z
                .object({ state: RollupStateSchema })
                .nullable(),
            }),
          })
          .nullable(),
      }),
    });
    const data = await this.#query(
      BRANCH_HEAD,
      { ...this.#repository(), ref: `refs/heads/${branch}` },
      Schema,
    );
    const target = data.repository.ref?.target;
    if (target === undefined) {
      throw new Error(`GitHub branch ${branch} does not exist`);
    }
    return {
      oid: target.oid,
      headline: target.messageHeadline,
      committedAt: target.committedDate,
      url: target.url,
      checks: target.statusCheckRollup?.state ?? "NONE",
    };
  }

  /** The single open issue in this repository whose title is exactly `title`. */
  async openIssueByTitle(title: string): Promise<IssueBody> {
    const Schema = z.object({
      search: z.object({
        nodes: z.array(
          z.object({
            number: z.number().int(),
            title: z.string(),
            url: z.url(),
            body: z.string(),
          }),
        ),
      }),
    });
    const data = await this.#query(
      ISSUE_SEARCH,
      {
        query: `repo:${this.#owner}/${this.#name} is:issue is:open in:title "${title}"`,
      },
      Schema,
    );
    const matches = data.search.nodes.filter((issue) => issue.title === title);
    const [issue] = matches;
    if (issue === undefined || matches.length > 1) {
      throw new Error(
        `Expected one open issue titled "${title}", found ${String(matches.length)}`,
      );
    }
    return { number: issue.number, url: issue.url, body: issue.body };
  }

  /** GraphQL and REST core rate limit windows for the configured token. */
  async rateLimits(): Promise<{
    graphql: RateLimitWindow;
    core: RateLimitWindow;
  }> {
    const [graphqlData, restData] = await Promise.all([
      this.#query(GRAPHQL_RATE_LIMIT, {}, GraphqlRateLimitSchema),
      this.#restGet("/rate_limit", RestRateLimitSchema),
    ]);
    const gql = graphqlData.rateLimit;
    const core = restData.resources.core;
    return {
      graphql: {
        limit: gql.limit,
        remaining: gql.remaining,
        used: gql.used,
        resetAt: gql.resetAt,
        cost: gql.cost,
      },
      core: {
        limit: core.limit,
        remaining: core.remaining,
        used: core.used,
        resetAt: new Date(core.reset * 1000).toISOString(),
      },
    };
  }

  /** Read one pull request's full body and head branch. */
  async pullRequestBody(number: number): Promise<PullRequestBody> {
    const data = await this.#query(
      PULL_REQUEST_BODY,
      { ...this.#repository(), number },
      PullRequestBodySchema,
    );
    const pr = data.repository.pullRequest;
    if (pr === null) {
      throw new UpstreamError("github", `PR #${String(number)} not found`, 404);
    }
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      headRefName: pr.headRefName,
      url: pr.url,
    };
  }

  /** Published releases of an upstream repository, newest pages first. */
  async releasesBetween(input: {
    owner: string;
    name: string;
    maxPages?: number;
  }): Promise<GitHubReleaseNote[]> {
    const maxPages = Math.min(Math.max(input.maxPages ?? 3, 1), MAX_PAGES);
    const PageSchema = z.array(RestReleaseSchema);
    const releases: GitHubReleaseNote[] = [];
    const repoPath = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/releases`;
    for (let page = 1; page <= maxPages; page += 1) {
      const items = await this.#restGet(
        `${repoPath}?per_page=${String(RELEASES_PER_PAGE)}&page=${String(page)}`,
        PageSchema,
      );
      for (const release of items) {
        if (!release.draft) {
          releases.push({
            tagName: release.tag_name,
            name: release.name ?? release.tag_name,
            body: release.body ?? "",
            url: release.html_url,
            prerelease: release.prerelease,
            publishedAt: release.published_at ?? release.created_at,
          });
        }
      }
      if (items.length < RELEASES_PER_PAGE) {
        break;
      }
    }
    return releases;
  }

  /** Compare `base...head` commits on an upstream GitHub repository. */
  async compareCommits(input: {
    owner: string;
    name: string;
    base: string;
    head: string;
  }): Promise<CommitComparison> {
    const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}`;
    const data = await this.#restGet(path, RestCompareSchema);
    return {
      aheadBy: data.ahead_by,
      htmlUrl: data.html_url,
      commits: data.commits.map((entry) => ({
        sha: entry.sha,
        headline: (entry.commit.message.split("\n")[0] ?? "").trim(),
        committedAt:
          entry.commit.committer?.date ?? entry.commit.author?.date ?? "",
      })),
    };
  }
}
