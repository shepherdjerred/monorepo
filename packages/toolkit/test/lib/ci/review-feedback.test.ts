import { afterEach, expect, test, vi } from "vitest";
import { listReviewFeedback } from "#lib/review/feedback.ts";
import { ciFixture, CI_HEAD } from "./fixtures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const thread = (id: string, resolved: boolean, outdated: boolean) => ({
  id,
  isResolved: resolved,
  isOutdated: outdated,
  path: "src/file.ts",
  line: 12,
  comments: {
    nodes: [
      {
        databaseId: 23,
        body: "Please handle the null value",
        url: "https://github.com/shepherdjerred/monorepo/pull/99#discussion_r23",
        author: { login: "alice" },
      },
    ],
  },
});

test("human feedback preserves contents and raw handles across thread pages", async () => {
  let pages = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = new URL(input);
      if (url.pathname === "/graphql") {
        pages++;
        return Response.json({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: pages % 2 === 1, endCursor: "next" },
                  nodes:
                    pages % 2 === 1
                      ? [thread("open", false, false)]
                      : [
                          thread("resolved", true, false),
                          thread("old", false, true),
                        ],
                },
              },
            },
          },
        });
      }
      if (url.pathname.endsWith("/reviews"))
        return Response.json([
          {
            id: 5,
            node_id: "review5",
            user: { login: "bob", type: "User" },
            body: "Review summary",
            html_url:
              "https://github.com/shepherdjerred/monorepo/pull/99#pullrequestreview-5",
            state: "COMMENTED",
            submitted_at: "2026-10-04T00:00:00Z",
            commit_id: CI_HEAD,
          },
        ]);
      if (url.pathname.endsWith("/comments"))
        return Response.json([
          {
            id: 6,
            user: { login: "alice", type: "User" },
            body: "General question",
            html_url:
              "https://github.com/shepherdjerred/monorepo/pull/99#issuecomment-6",
          },
          {
            id: 7,
            user: { login: "alice", type: "User" },
            body: "<!-- gs:navigation comment -->",
            html_url:
              "https://github.com/shepherdjerred/monorepo/pull/99#issuecomment-7",
          },
        ]);
      return Response.json(ciFixture().pr);
    }),
  );
  const report = await listReviewFeedback({
    repo: "shepherdjerred/monorepo",
    number: 99,
    token: "test",
  });
  expect(report.findings).toHaveLength(3);
  expect(report.findings[0]).toMatchObject({
    author: "alice",
    priority: null,
    contents: "Please handle the null value",
    rawCommand:
      "toolkit gh api repos/shepherdjerred/monorepo/pulls/comments/23",
  });
  expect(report.findings[1]?.rawCommand).toContain("pulls/reviews/5");
  expect(report.findings[2]?.rawCommand).toContain("issues/comments/6");
  const all = await listReviewFeedback({
    repo: "shepherdjerred/monorepo",
    number: 99,
    token: "test",
    all: true,
  });
  expect(all.findings).toHaveLength(5);
});

test("review API errors fail explicitly rather than producing an empty success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 403 })),
  );
  await expect(
    listReviewFeedback({
      repo: "shepherdjerred/monorepo",
      number: 99,
      token: "test",
    }),
  ).rejects.toThrow("403");
});
