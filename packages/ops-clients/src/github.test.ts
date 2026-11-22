import { describe, expect, test } from "vitest";
import { GitHubClient } from "@shepherdjerred/ops-clients/github.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

function github(...bodies: unknown[]) {
  const fake = sequence(...bodies);
  return {
    ...fake,
    client: new GitHubClient({
      owner: "shepherdjerred",
      name: "monorepo",
      token: () => Promise.resolve("gh-token"),
      fetch: fake.fetch,
    }),
  };
}

function page<T>(nodes: T[], endCursor: string | null) {
  return { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes };
}

const openPr = {
  number: 3067,
  title: "feat: agent identity",
  url: "https://github.com/shepherdjerred/monorepo/pull/3067",
  author: { login: "derrej", __typename: "User" },
  isDraft: false,
  createdAt: "2026-09-20T00:00:00Z",
  updatedAt: "2026-09-24T00:00:00Z",
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  headRefName: "agent-identity",
  baseRefName: "main",
  labels: { nodes: [{ name: "agent" }] },
  commits: {
    nodes: [
      { commit: { oid: "abc", statusCheckRollup: { state: "SUCCESS" } } },
    ],
  },
  reviews: {
    nodes: [
      {
        state: "APPROVED",
        author: { login: "shepherdjerred" },
        commit: { oid: "abc" },
      },
      {
        state: "COMMENTED",
        author: { login: "shepherdjerred" },
        commit: { oid: "abc" },
      },
    ],
  },
};

function merged(
  number: number,
  updatedAt: string,
  mergedAt: string,
  headRefName?: string,
) {
  return {
    number,
    title: `PR ${String(number)}`,
    url: `https://github.com/shepherdjerred/monorepo/pull/${String(number)}`,
    ...(headRefName === undefined ? {} : { headRefName }),
    author: { login: "renovate", __typename: "Bot" },
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt,
    mergedAt,
  };
}

function issue(title: string) {
  return {
    number: 481,
    title,
    url: "https://github.com/shepherdjerred/monorepo/issues/481",
    body: "body",
  };
}

describe("GitHubClient pull requests and history", () => {
  test("pages open pull requests, flattens checks, and checks exact-head approval", async () => {
    const { client, requests } = github(
      { data: { repository: { pullRequests: page([openPr], "c1") } } },
      {
        data: {
          repository: {
            pullRequests: page(
              [
                {
                  ...openPr,
                  number: 1,
                  author: null,
                  baseRefName: "release",
                  commits: {
                    nodes: [
                      { commit: { oid: "new-head", statusCheckRollup: null } },
                    ],
                  },
                  reviews: {
                    nodes: [
                      {
                        state: "APPROVED",
                        author: { login: "shepherdjerred" },
                        commit: { oid: "old-head" },
                      },
                    ],
                  },
                },
                {
                  ...openPr,
                  number: 2,
                  commits: { nodes: [] },
                  reviews: { nodes: [] },
                },
              ],
              null,
            ),
          },
        },
      },
    );
    const prs = await client.openPullRequests();
    expect(prs[0]).toMatchObject({
      number: 3067,
      author: { login: "derrej", kind: "user" },
      checks: "SUCCESS",
      labels: ["agent"],
      draft: false,
      baseRefName: "main",
      headOid: "abc",
      exactHeadApproved: true,
    });
    expect(prs[1]).toMatchObject({
      author: undefined,
      checks: "NONE",
      baseRefName: "release",
      headOid: "new-head",
      exactHeadApproved: false,
    });
    expect(prs[2]).toMatchObject({
      headOid: undefined,
      exactHeadApproved: false,
    });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer gh-token");
    expect(requests[1]?.body).toMatchObject({
      variables: { owner: "shepherdjerred", name: "monorepo", after: "c1" },
    });
  });

  test("subsequent CHANGES_REQUESTED clears exactHeadApproved", async () => {
    const { client } = github({
      data: {
        repository: {
          pullRequests: page(
            [
              {
                ...openPr,
                reviews: {
                  nodes: [
                    {
                      state: "APPROVED",
                      author: { login: "shepherdjerred" },
                      commit: { oid: "abc" },
                    },
                    {
                      state: "CHANGES_REQUESTED",
                      author: { login: "shepherdjerred" },
                      commit: { oid: "abc" },
                    },
                  ],
                },
              },
            ],
            null,
          ),
        },
      },
    });
    const prs = await client.openPullRequests();
    expect(prs[0]?.exactHeadApproved).toBe(false);
  });

  test("stops merged pagination at the first PR updated before the window and maps branch", async () => {
    const since = new Date("2026-09-17T00:00:00Z");
    const { client, requests } = github({
      data: {
        repository: {
          pullRequests: page(
            [
              merged(
                10,
                "2026-09-24T00:00:00Z",
                "2026-09-23T00:00:00Z",
                "renovate/react-19.x",
              ),
              merged(9, "2026-09-20T00:00:00Z", "2026-09-10T00:00:00Z"),
              merged(8, "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z"),
            ],
            "more",
          ),
        },
      },
    });
    const prs = await client.mergedPullRequests(since);
    expect(prs.map((pr) => pr.number)).toEqual([10]);
    expect(prs[0]?.author).toEqual({ login: "renovate", kind: "bot" });
    expect(prs[0]?.branch).toBe("renovate/react-19.x");
    expect(requests).toHaveLength(1);
  });

  test("a GraphQL errors array fails even with partial data", async () => {
    const { client } = github({
      data: null,
      errors: [{ message: "Resource not accessible by integration" }],
    });
    await expect(client.openPullRequests()).rejects.toThrow(
      "github: GraphQL error (1): Resource not accessible by integration",
    );
  });
});

describe("GitHubClient history and issues", () => {
  test("reads path history, branch head, and open issue by title", async () => {
    const commit = {
      oid: "d34db33f",
      messageHeadline: "chore: bump image pins",
      committedDate: "2026-09-24T09:00:00Z",
      url: "https://github.com/shepherdjerred/monorepo/commit/d34db33f",
    };
    const { client, requests } = github(
      {
        data: {
          repository: {
            ref: { target: { history: page([commit], null) } },
          },
        },
      },
      {
        data: {
          repository: {
            ref: {
              target: { ...commit, statusCheckRollup: { state: "FAILURE" } },
            },
          },
        },
      },
      {
        data: {
          search: {
            nodes: [
              issue("Dependency Dashboard"),
              issue("Not the Dependency Dashboard"),
            ],
          },
        },
      },
    );
    await expect(
      client.commitsTouching({
        branch: "main",
        path: "packages/version-catalog/src/catalog.json",
        since: new Date("2026-09-23T00:00:00Z"),
      }),
    ).resolves.toEqual([
      {
        oid: "d34db33f",
        headline: "chore: bump image pins",
        committedAt: "2026-09-24T09:00:00Z",
        url: commit.url,
      },
    ]);
    expect(requests[0]?.body).toMatchObject({
      variables: {
        ref: "refs/heads/main",
        since: "2026-09-23T00:00:00.000Z",
      },
    });
    await expect(client.branchHead("main")).resolves.toMatchObject({
      oid: "d34db33f",
      checks: "FAILURE",
    });
    await expect(
      client.openIssueByTitle("Dependency Dashboard"),
    ).resolves.toMatchObject({ number: 481, body: "body" });

    const missing = github({ data: { search: { nodes: [] } } });
    await expect(
      missing.client.openIssueByTitle("Dependency Dashboard"),
    ).rejects.toThrow(/found 0/u);
  });
});

describe("GitHubClient rate limits and release deltas", () => {
  test("fetches GraphQL and REST core rate limits", async () => {
    const { client, requests } = github(
      {
        data: {
          rateLimit: {
            limit: 5000,
            cost: 1,
            remaining: 4800,
            used: 200,
            resetAt: "2026-09-24T13:00:00Z",
          },
        },
      },
      {
        resources: {
          core: {
            limit: 5000,
            remaining: 4950,
            used: 50,
            reset: 1_790_254_800,
          },
        },
      },
    );
    const limits = await client.rateLimits();
    expect(limits).toEqual({
      graphql: {
        limit: 5000,
        remaining: 4800,
        used: 200,
        resetAt: "2026-09-24T13:00:00Z",
        cost: 1,
      },
      core: {
        limit: 5000,
        remaining: 4950,
        used: 50,
        resetAt: new Date(1_790_254_800 * 1000).toISOString(),
      },
    });
    expect(requests[1]?.url).toBe("https://api.github.com/rate_limit");
  });

  test("fetches pull request body, release notes, and commit comparisons", async () => {
    const { client, requests } = github(
      {
        data: {
          repository: {
            pullRequest: {
              number: 42,
              title: "chore(deps): bump foo",
              body: "Release notes...",
              headRefName: "renovate/foo-2.x",
              url: "https://github.com/shepherdjerred/monorepo/pull/42",
            },
          },
        },
      },
      [
        {
          tag_name: "v2.0.0",
          name: "2.0.0",
          body: "Breaking changes",
          html_url: "https://github.com/acme/foo/releases/tag/v2.0.0",
          draft: false,
          prerelease: false,
          published_at: "2026-09-20T00:00:00Z",
          created_at: "2026-09-20T00:00:00Z",
        },
        {
          tag_name: "v2.1.0-draft",
          name: null,
          body: null,
          html_url: "https://github.com/acme/foo/releases/tag/v2.1.0-draft",
          draft: true,
          prerelease: false,
          published_at: null,
          created_at: "2026-09-21T00:00:00Z",
        },
      ],
      {
        ahead_by: 2,
        html_url: "https://github.com/acme/foo/compare/v1.0.0...v2.0.0",
        commits: [
          {
            sha: "111",
            commit: {
              message: "feat!: v2\n\nDetails",
              committer: { date: "2026-09-19T12:00:00Z" },
            },
          },
        ],
      },
    );

    await expect(client.pullRequestBody(42)).resolves.toEqual({
      number: 42,
      title: "chore(deps): bump foo",
      body: "Release notes...",
      headRefName: "renovate/foo-2.x",
      url: "https://github.com/shepherdjerred/monorepo/pull/42",
    });

    await expect(
      client.releasesBetween({ owner: "acme", name: "foo", maxPages: 2 }),
    ).resolves.toEqual([
      {
        tagName: "v2.0.0",
        name: "2.0.0",
        body: "Breaking changes",
        url: "https://github.com/acme/foo/releases/tag/v2.0.0",
        prerelease: false,
        publishedAt: "2026-09-20T00:00:00Z",
      },
    ]);
    expect(requests[1]?.url).toBe(
      "https://api.github.com/repos/acme/foo/releases?per_page=100&page=1",
    );

    await expect(
      client.compareCommits({
        owner: "acme",
        name: "foo",
        base: "v1.0.0",
        head: "v2.0.0",
      }),
    ).resolves.toEqual({
      aheadBy: 2,
      htmlUrl: "https://github.com/acme/foo/compare/v1.0.0...v2.0.0",
      commits: [
        {
          sha: "111",
          headline: "feat!: v2",
          committedAt: "2026-09-19T12:00:00Z",
        },
      ],
    });
    expect(requests[2]?.url).toBe(
      "https://api.github.com/repos/acme/foo/compare/v1.0.0...v2.0.0",
    );
  });
});
