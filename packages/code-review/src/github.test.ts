import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchLatestProviderReview, parsePullRequestAuthor } from "./github.ts";
import {
  assembleProviderThreads,
  fetchSharedProviderThreads,
} from "./github-review-snapshot.ts";
import {
  coderabbitProvider,
  CODERABBIT_LOGIN,
} from "./providers/coderabbit.ts";
import { codexProvider } from "./providers/codex.ts";

describe("parsePullRequestAuthor", () => {
  test("parses a GitHub App bot author", () => {
    expect(
      parsePullRequestAuthor({
        user: { login: "long-summer-intern[bot]", type: "Bot" },
      }),
    ).toEqual({ login: "long-summer-intern[bot]", type: "Bot" });
  });

  test("parses a human author", () => {
    expect(
      parsePullRequestAuthor({
        user: { login: "shepherdjerred", type: "User" },
      }),
    ).toEqual({ login: "shepherdjerred", type: "User" });
  });

  test("preserves an unknown non-empty account type for fail-closed policy", () => {
    expect(
      parsePullRequestAuthor({
        user: { login: "future-service", type: "ServiceAccount" },
      }),
    ).toEqual({ login: "future-service", type: "ServiceAccount" });
  });

  test.each([
    ["non-object response", null],
    ["missing user", {}],
    ["non-object user", { user: "long-summer-intern[bot]" }],
    ["missing login", { user: { type: "Bot" } }],
    ["empty login", { user: { login: "", type: "Bot" } }],
    ["missing type", { user: { login: "long-summer-intern[bot]" } }],
    ["empty type", { user: { login: "long-summer-intern[bot]", type: "" } }],
  ])("rejects %s", (_description, payload) => {
    expect(() => parsePullRequestAuthor(payload)).toThrow();
  });
});

/** Shared listing fixtures: an empty thread page plus one CodeRabbit review. */
const REVIEW_COMMIT = "abc123";
const LIVE_HEAD = "live456";

function threadListing(headRefOid: string | null): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          headRefOid,
          reviewThreads: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  };
}

const BODY =
  "<details>\n" +
  "<summary>package.json (1)</summary><blockquote>\n" +
  "\n" +
  "`1-2`: _⚠️ Potential issue_ | _🟡 Minor_ | _⚡ Quick win_\n" +
  "\n" +
  "**Root file finding.**\n" +
  "\n" +
  "</blockquote></details>\n";

function reviewListing(commitOid: string | null): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: "R1",
                submittedAt: "2026-09-27T05:00:00Z",
                author: { login: CODERABBIT_LOGIN },
                body: BODY,
                commit: commitOid === null ? null : { oid: commitOid },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  };
}

function assembledBodyFinding(evaluateHead?: string | null) {
  const { threads } = assembleProviderThreads({
    provider: coderabbitProvider,
    threadPayloads: [threadListing(LIVE_HEAD)],
    reviewPayloads: [reviewListing(REVIEW_COMMIT)],
    headRefOid: LIVE_HEAD,
    evaluateHead,
    issueComment: null,
  });
  if (threads.length !== 1) throw new Error("expected one body finding");
  return threads[0];
}

describe("assembleProviderThreads", () => {
  test("marks body findings against the evaluated head, not the live head", () => {
    // The build under evaluation targets the reviewed commit even though the
    // PR has since advanced: the finding is current for that build's gate.
    expect(assembledBodyFinding(REVIEW_COMMIT)?.isOutdated).toBe(false);
    // A different evaluated head really did supersede the review.
    expect(assembledBodyFinding("other789")?.isOutdated).toBe(true);
    // Without an evaluated head the live head stays the comparison basis.
    expect(assembledBodyFinding()?.isOutdated).toBe(true);
  });
});

describe("fetchSharedProviderThreads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("partitions one listing per provider with a single query round", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (...args: unknown[]) => {
        const init: unknown = args[1];
        const rawBody =
          typeof init === "object" && init !== null && "body" in init
            ? init.body
            : undefined;
        const body = typeof rawBody === "string" ? rawBody : "";
        return Response.json(
          body.includes("reviewThreads(")
            ? threadListing(LIVE_HEAD)
            : reviewListing(REVIEW_COMMIT),
        );
      });
    const { byProvider, headRefOid } = await fetchSharedProviderThreads({
      repo: "shepherdjerred/monorepo",
      number: 3189,
      token: "token",
      providers: [codexProvider, coderabbitProvider],
      evaluateHead: REVIEW_COMMIT,
    });
    // One threads query plus one reviews query total — not one round per
    // provider — so every provider partitions the same snapshot.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(headRefOid).toBe(LIVE_HEAD);
    expect(byProvider.get(codexProvider.id)).toEqual([]);
    const rabbit = byProvider.get(coderabbitProvider.id);
    if (rabbit?.length !== 1) throw new Error("expected one body finding");
    expect(rabbit[0]?.isOutdated).toBe(false);
    expect(rabbit[0]?.path).toBe("package.json");
  });
});

function mockRestReviews(
  reviews: {
    state: string;
    submitted_at: string | null;
    commit_id: string | null;
  }[],
): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json(
      reviews.map((review, index) => ({
        id: 1000 + index,
        user: { login: "chatgpt-codex-connector" },
        state: review.state,
        submitted_at: review.submitted_at,
        commit_id: review.commit_id,
      })),
    ),
  );
}

describe("fetchLatestProviderReview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const input = {
    repo: "shepherdjerred/monorepo",
    number: 3189,
    token: "token",
    provider: codexProvider,
  };

  test("skips dismissed reviews for an older live one", async () => {
    mockRestReviews([
      {
        state: "DISMISSED",
        submitted_at: "2026-09-27T06:00:00Z",
        commit_id: "abc123",
      },
      {
        state: "COMMENTED",
        submitted_at: "2026-09-27T05:00:00Z",
        commit_id: "abc123",
      },
    ]);
    // The dismissed review is withdrawn even though it is newer: completion
    // falls through to the older live review at head.
    await expect(fetchLatestProviderReview(input)).resolves.toEqual({
      commitId: "abc123",
      submittedAt: "2026-09-27T05:00:00Z",
    });
  });

  test("returns null when every review is dismissed", async () => {
    mockRestReviews([
      {
        state: "DISMISSED",
        submitted_at: "2026-09-27T06:00:00Z",
        commit_id: "abc123",
      },
    ]);
    await expect(fetchLatestProviderReview(input)).resolves.toBeNull();
  });
});
