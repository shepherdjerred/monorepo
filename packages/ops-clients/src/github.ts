import { z } from "zod";
import { bearer, type Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { postGraphql } from "@shepherdjerred/ops-clients/graphql.ts";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

const ActorSchema = z
  .object({ login: z.string(), __typename: z.string() })
  .nullable();

const RollupStateSchema = z.enum([
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "PENDING",
  "EXPECTED",
]);

const OpenPullRequestSchema = z.object({
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
});

const MergedPullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.url(),
  author: ActorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
});

const CommitSchema = z.object({
  oid: z.string(),
  messageHeadline: z.string(),
  committedDate: z.string(),
  url: z.url(),
});

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
  labels: string[];
  checks: CheckRollup;
};

export type MergedPullRequest = {
  number: number;
  title: string;
  url: string;
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

function toAuthor(actor: z.infer<typeof ActorSchema>): Author {
  if (actor === null) {
    return undefined;
  }
  return {
    login: actor.login,
    kind: actor.__typename === "Bot" ? "bot" : "user",
  };
}

const OPEN_PULL_REQUESTS = `
query OpenPullRequests($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft createdAt updatedAt reviewDecision mergeable headRefName
        author { login __typename }
        labels(first: 20) { nodes { name } }
        commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      }
    }
  }
}`;

const MERGED_PULL_REQUESTS = `
query MergedPullRequests($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 100, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { number title url createdAt updatedAt mergedAt author { login __typename } }
    }
  }
}`;

const PATH_HISTORY = `
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

const BRANCH_HEAD = `
query BranchHead($owner: String!, $name: String!, $ref: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target {
        ... on Commit { oid messageHeadline committedDate url statusCheckRollup { state } }
      }
    }
  }
}`;

const ISSUE_SEARCH = `
query IssueSearch($query: String!) {
  search(query: $query, type: ISSUE, first: 5) {
    nodes { ... on Issue { number title url body } }
  }
}`;

function connection<T extends z.ZodType>(item: T) {
  return z.object({ pageInfo: PageInfoSchema, nodes: z.array(item) });
}

const MAX_PAGES = 20;

/** Read-only GitHub GraphQL client for one repository. */
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

  async openPullRequests(): Promise<OpenPullRequest[]> {
    const schema = z.object({
      repository: z.object({ pullRequests: connection(OpenPullRequestSchema) }),
    });
    const results: OpenPullRequest[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: z.infer<typeof schema> = await this.#query(
        OPEN_PULL_REQUESTS,
        { ...this.#repository(), after },
        schema,
      );
      const { nodes, pageInfo } = data.repository.pullRequests;
      for (const pr of nodes) {
        results.push({
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
          labels: pr.labels.nodes.map((label) => label.name),
          checks:
            pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "NONE",
        });
      }
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
    const schema = z.object({
      repository: z.object({
        pullRequests: connection(MergedPullRequestSchema),
      }),
    });
    const results: MergedPullRequest[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: z.infer<typeof schema> = await this.#query(
        MERGED_PULL_REQUESTS,
        { ...this.#repository(), after },
        schema,
      );
      const { nodes, pageInfo } = data.repository.pullRequests;
      for (const pr of nodes) {
        if (Date.parse(pr.updatedAt) < since.getTime()) {
          return results;
        }
        if (
          pr.mergedAt !== null &&
          Date.parse(pr.mergedAt) >= since.getTime()
        ) {
          results.push({
            number: pr.number,
            title: pr.title,
            url: pr.url,
            author: toAuthor(pr.author),
            createdAt: pr.createdAt,
            mergedAt: pr.mergedAt,
          });
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
    const schema = z.object({
      repository: z.object({
        ref: z
          .object({ target: z.object({ history: connection(CommitSchema) }) })
          .nullable(),
      }),
    });
    const results: Commit[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: z.infer<typeof schema> = await this.#query(
        PATH_HISTORY,
        {
          ...this.#repository(),
          ref: `refs/heads/${input.branch}`,
          path: input.path,
          since: input.since.toISOString(),
          after,
        },
        schema,
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
    const schema = z.object({
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
      schema,
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
    const schema = z.object({
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
      schema,
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
}
