import { describe, expect, test } from "vitest";
import { fetchCommitContext } from "@shepherdjerred/ops-clients/github-commit.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

const oid = "a".repeat(40);

function commit(pulls: unknown[]) {
  return {
    data: {
      repository: {
        object: {
          oid,
          messageHeadline: "feat(delivery): hub",
          messageBody: "Why\n\nBecause.",
          committedDate: "2026-10-18T00:00:00Z",
          url: `https://github.com/shepherdjerred/monorepo/commit/${oid}`,
          author: { name: "Jerred", user: { login: "shepherdjerred" } },
          associatedPullRequests: { nodes: pulls },
        },
      },
    },
  };
}

describe("fetchCommitContext", () => {
  test("returns the commit author and its pull request", async () => {
    const { fetch, requests } = sequence(
      commit([
        {
          number: 3913,
          title: "feat(delivery): hub",
          url: "https://github.com/shepherdjerred/monorepo/pull/3913",
          mergedAt: "2026-10-18T01:00:00Z",
          author: { login: "shepherdjerred" },
        },
      ]),
    );
    const context = await fetchCommitContext({
      owner: "shepherdjerred",
      name: "monorepo",
      oid,
      token: "gh",
      fetch,
    });
    expect(context).toMatchObject({
      headline: "feat(delivery): hub",
      authorLogin: "shepherdjerred",
      pullRequest: { number: 3913, mergedAt: "2026-10-18T01:00:00Z" },
    });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer gh");
    expect(requests[0]?.body).toMatchObject({ variables: { oid } });
  });

  test("a commit without a pull request has none", async () => {
    const { fetch } = sequence(commit([]));
    const context = await fetchCommitContext({
      owner: "shepherdjerred",
      name: "monorepo",
      oid,
      token: "gh",
      fetch,
    });
    expect(context.pullRequest).toBeUndefined();
  });

  test("a missing commit fails loudly", async () => {
    const { fetch } = sequence({ data: { repository: { object: null } } });
    await expect(
      fetchCommitContext({
        owner: "shepherdjerred",
        name: "monorepo",
        oid,
        token: "gh",
        fetch,
      }),
    ).rejects.toThrow("does not exist");
  });
});
