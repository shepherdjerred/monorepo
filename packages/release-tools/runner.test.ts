import { CommitExclude } from "release-please/build/src/util/commit-exclude.js";
import { describe, expect, test } from "vitest";

import {
  applyExcludedPathsToConfig,
  hasMergedPendingReleasePullRequest,
  validateReleaseCandidatePaths,
} from "./runner.ts";

test("applies the same component exclusions to the in-memory manifest", () => {
  const repositoryConfig = {
    "packages/webring": {},
    "packages/astro-opengraph-images": {
      excludePaths: ["packages/astro-opengraph-images/typedoc.json"],
    },
  };
  applyExcludedPathsToConfig(repositoryConfig, ["packages/webring"]);
  expect(repositoryConfig).toEqual({
    "packages/webring": { excludePaths: ["packages/webring/"] },
    "packages/astro-opengraph-images": {
      excludePaths: ["packages/astro-opengraph-images/typedoc.json"],
    },
  });
});

test("component exclusions cover descendant files in release-please", () => {
  const repositoryConfig = {
    "packages/webring": {
      excludePaths: [],
    },
  };
  applyExcludedPathsToConfig(repositoryConfig, ["packages/webring"]);
  const commitExclude = new CommitExclude(repositoryConfig);

  const filtered = commitExclude.excludeCommits({
    "packages/webring": [
      {
        sha: "a".repeat(40),
        message: "docs: update API reference",
        files: ["packages/webring/typedoc.json"],
      },
      {
        sha: "b".repeat(40),
        message: "fix: render component",
        files: ["packages/webring/src/index.ts"],
      },
      {
        sha: "c".repeat(40),
        message: "chore: update release runner",
        files: [
          "packages/webring/typedoc.json",
          "packages/release-tools/runner.ts",
        ],
      },
    ],
  });

  expect(filtered["packages/webring"]).toHaveLength(0);
});

describe("release-please candidate validation", () => {
  test("accepts candidates for eligible packages", () => {
    expect(() =>
      validateReleaseCandidatePaths(
        ["packages/webring"],
        ["packages/astro-opengraph-images"],
      ),
    ).not.toThrow();
  });

  test("rejects candidates for excluded packages", () => {
    expect(() =>
      validateReleaseCandidatePaths(
        ["packages/webring", "packages/astro-opengraph-images"],
        ["packages/astro-opengraph-images"],
      ),
    ).toThrow("proposed ineligible package");
  });
});

describe("hasMergedPendingReleasePullRequest", () => {
  const repository = { owner: "shepherdjerred", repo: "monorepo" };

  test("queries GitHub pulls API for closed PRs and ignores unmerged or differently labeled PRs", async () => {
    const capturedUrls: string[] = [];
    let capturedHeaders: RequestInit["headers"];
    const result = await hasMergedPendingReleasePullRequest(
      repository,
      "secret-token",
      "main",
      async (url, init) => {
        capturedUrls.push(url);
        capturedHeaders = init?.headers;
        return Response.json([
          {
            number: 10,
            merged_at: null,
            labels: [{ name: "autorelease: pending" }],
          },
          {
            number: 11,
            merged_at: "2026-11-21T10:00:00Z",
            labels: [{ name: "autorelease: tagged" }],
          },
        ]);
      },
    );

    expect(result).toBe(false);
    expect(capturedUrls).toEqual([
      "https://api.github.com/repos/shepherdjerred/monorepo/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=1",
    ]);
    expect(capturedHeaders).toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer secret-token",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  });

  function makeMergedPulls(count: number, startNumber: number) {
    const emptyLabels: readonly { readonly name: string }[] = [];
    return Array.from({ length: count }, (_, index) => ({
      number: startNumber + index,
      merged_at: "2026-11-21T10:00:00Z",
      labels: emptyLabels,
    }));
  }

  async function queryWithPages(pages: readonly unknown[]) {
    const capturedUrls: string[] = [];
    const result = await hasMergedPendingReleasePullRequest(
      repository,
      "secret-token",
      "main",
      async (url) => {
        capturedUrls.push(url);
        const pageParam = new URL(url).searchParams.get("page");
        const pageIndex = Number(pageParam ?? "1") - 1;
        return Response.json(pages[pageIndex] ?? []);
      },
    );
    return { result, capturedUrls };
  }

  test("paginates across pages and returns true when a merged autorelease: pending PR is on page 2", async () => {
    const { result, capturedUrls } = await queryWithPages([
      makeMergedPulls(100, 1),
      [
        {
          number: 201,
          merged_at: "2026-11-21T09:00:00Z",
          labels: [{ name: "autorelease: pending" }],
        },
      ],
    ]);
    expect(result).toBe(true);
    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[1]).toContain("&page=2");
  });

  test("counts merged PRs rather than unmerged closed PRs toward the 200-PR scan limit", async () => {
    const unmergedAnd99Merged = [
      { number: 1, merged_at: null, labels: [] },
      ...makeMergedPulls(99, 2),
    ];
    const { result, capturedUrls } = await queryWithPages([
      unmergedAnd99Merged,
      makeMergedPulls(100, 101),
      [
        {
          number: 201,
          merged_at: "2026-11-21T09:00:00Z",
          labels: [{ name: "autorelease: pending" }],
        },
      ],
    ]);

    expect(result).toBe(true);
    expect(capturedUrls).toHaveLength(3);
    expect(capturedUrls[2]).toContain("&page=3");
  });

  test("stops right at 200 merged PRs without inspecting the 201st merged PR or fetching another page", async () => {
    const { result, capturedUrls } = await queryWithPages([
      [{ number: 1, merged_at: null, labels: [] }, ...makeMergedPulls(99, 2)],
      makeMergedPulls(100, 101),
      [
        ...makeMergedPulls(1, 201),
        {
          number: 202,
          merged_at: "2026-11-21T09:00:00Z",
          labels: [{ name: "autorelease: pending" }],
        },
      ],
    ]);

    expect(result).toBe(false);
    expect(capturedUrls).toHaveLength(3);
  });

  test("honors GitHub Link rel=next header across short pages and stops without rel=next", async () => {
    const capturedUrls: string[] = [];
    const result = await hasMergedPendingReleasePullRequest(
      repository,
      "secret-token",
      "main",
      async (url) => {
        capturedUrls.push(url);
        if (url.endsWith("&page=1")) {
          return Response.json([{ number: 1, merged_at: null, labels: [] }], {
            headers: {
              Link: '<https://api.github.com/repositories/1/pulls?page=2>; rel="next", <https://api.github.com/repositories/1/pulls?page=2>; rel="last"',
            },
          });
        }
        return Response.json(
          Array.from({ length: 100 }, (_, index) => ({
            number: index + 2,
            merged_at: null,
            labels: [],
          })),
          {
            headers: {
              Link: '<https://api.github.com/repositories/1/pulls?page=1>; rel="prev", <https://api.github.com/repositories/1/pulls?page=1>; rel="first"',
            },
          },
        );
      },
    );

    expect(result).toBe(false);
    expect(capturedUrls).toHaveLength(2);
  });

  test("fails closed on non-2xx GitHub API responses", async () => {
    await expect(
      hasMergedPendingReleasePullRequest(
        repository,
        "secret-token",
        "main",
        async () =>
          new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
      ),
    ).rejects.toThrow(
      "Could not query merged release pull requests on GitHub (403 Forbidden)",
    );
  });

  test.each([
    { label: "null payload", body: null },
    { label: "object payload", body: { items: [] } },
    { label: "null entry", body: [null] },
    {
      label: "non-string merged_at",
      body: [{ merged_at: 123, labels: [] }],
    },
    {
      label: "missing labels array",
      body: [{ merged_at: "2026-11-21T10:00:00Z" }],
    },
    {
      label: "malformed label object",
      body: [{ merged_at: "2026-11-21T10:00:00Z", labels: [{}] }],
    },
  ])("fails closed on malformed pulls response ($label)", async ({ body }) => {
    await expect(
      hasMergedPendingReleasePullRequest(
        repository,
        "secret-token",
        "main",
        async () => Response.json(body),
      ),
    ).rejects.toThrow("GitHub returned");
  });
});
