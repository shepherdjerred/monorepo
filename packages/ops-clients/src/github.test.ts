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
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "MERGEABLE",
  headRefName: "agent-identity",
  labels: { nodes: [{ name: "agent" }] },
  commits: {
    nodes: [
      { commit: { oid: "abc", statusCheckRollup: { state: "SUCCESS" } } },
    ],
  },
};

function merged(number: number, updatedAt: string, mergedAt: string) {
  return {
    number,
    title: `PR ${String(number)}`,
    url: `https://github.com/shepherdjerred/monorepo/pull/${String(number)}`,
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

describe("GitHubClient", () => {
  test("pages open pull requests and flattens checks", async () => {
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
                  commits: { nodes: [] },
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
    });
    expect(prs[1]).toMatchObject({ author: undefined, checks: "NONE" });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer gh-token");
    expect(requests[1]?.body).toMatchObject({
      variables: { owner: "shepherdjerred", name: "monorepo", after: "c1" },
    });
  });

  test("stops merged pagination at the first PR updated before the window", async () => {
    const since = new Date("2026-09-17T00:00:00Z");
    const { client, requests } = github({
      data: {
        repository: {
          pullRequests: page(
            [
              merged(10, "2026-09-24T00:00:00Z", "2026-09-23T00:00:00Z"),
              // Updated inside the window but merged before it.
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

  test("reads the path history and the branch head", async () => {
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
  });

  test("requires exactly one open issue with the exact title", async () => {
    const found = github({
      data: {
        search: {
          nodes: [
            issue("Dependency Dashboard"),
            issue("Not the Dependency Dashboard"),
          ],
        },
      },
    });
    await expect(
      found.client.openIssueByTitle("Dependency Dashboard"),
    ).resolves.toMatchObject({ number: 481, body: "body" });

    const missing = github({ data: { search: { nodes: [] } } });
    await expect(
      missing.client.openIssueByTitle("Dependency Dashboard"),
    ).rejects.toThrow(/found 0/);
  });
});
