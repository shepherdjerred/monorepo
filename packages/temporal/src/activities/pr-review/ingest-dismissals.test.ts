import { describe, expect, test } from "bun:test";
import { ingestDismissalsImpl } from "./ingest-dismissals.ts";
import {
  extractFindingRef,
  fileTouchedInRange,
  isBotAuthored,
  type IngestOctokit,
} from "#lib/pr-review/reaction-listener-helpers.ts";
import {
  botReviewComment,
  makeFakeRedis,
  makeIngestOctokit,
  thumbsDownReaction,
  unitVector,
  type FakeRedis,
} from "./testing/fixtures.ts";

/** Module-scope no-op for activity heartbeat injection in tests. */
function noopHeartbeat(): void {
  // intentional no-op for unit tests
}

/**
 * Runs the ingest impl with the standard test wiring (bot login, frozen
 * `now`, no-op heartbeat, local embedder → `fakeVec`).
 */
function runIngest(
  fakeRedis: FakeRedis,
  octokit: IngestOctokit,
  fakeVec: number[],
) {
  return ingestDismissalsImpl(
    "o",
    "r",
    { since: "2026-05-01T00:00:00Z" },
    {
      redis: fakeRedis,
      octokit,
      embed: { voyageApiKey: "", localEmbedder: async () => fakeVec },
      now: () => new Date("2026-05-31T00:00:00Z"),
      botLogin: "pr-review-bot",
      heartbeat: noopHeartbeat,
    },
  );
}

describe("extractFindingRef", () => {
  test("parses well-formed marker", () => {
    const body = `Some review prose
<!-- pr-review-finding hash=abc1234567890 kind=correctness file=src/x.ts claim=ignores error from foo -->`;
    const ref = extractFindingRef(body);
    expect(ref).not.toBeNull();
    if (ref === null) return;
    expect(ref.hash).toBe("abc1234567890");
    expect(ref.kind).toBe("correctness");
    expect(ref.file).toBe("src/x.ts");
    expect(ref.normalizedClaim).toBe("ignores error from foo");
  });

  test("returns null on missing marker", () => {
    expect(extractFindingRef("just plain text")).toBeNull();
    expect(extractFindingRef("")).toBeNull();
    expect(extractFindingRef(null)).toBeNull();
    expect(extractFindingRef()).toBeNull();
  });

  test("rejects unknown kind values", () => {
    const body =
      "<!-- pr-review-finding hash=abc123def4567 kind=bogus file=x.ts claim=y -->";
    expect(extractFindingRef(body)).toBeNull();
  });
});

describe("isBotAuthored", () => {
  test("matches by login string", () => {
    expect(
      isBotAuthored({ login: "pr-review-bot", type: "User" }, "pr-review-bot"),
    ).toBe(true);
  });

  test("matches bot type with substring", () => {
    expect(
      isBotAuthored(
        { login: "pr-review-bot[bot]", type: "Bot" },
        "pr-review-bot",
      ),
    ).toBe(true);
  });

  test("rejects unrelated login", () => {
    expect(
      isBotAuthored({ login: "human-user", type: "User" }, "pr-review-bot"),
    ).toBe(false);
  });

  test("rejects null user", () => {
    expect(isBotAuthored(null, "pr-review-bot")).toBe(false);
  });
});

describe("fileTouchedInRange", () => {
  test("file touched in a later commit returns true", () => {
    const touched = fileTouchedInRange(
      [
        { sha: "a", files: [] },
        { sha: "b", files: ["src/x.ts"] },
        { sha: "c", files: [] },
      ],
      "a",
      "src/x.ts",
    );
    expect(touched).toBe(true);
  });

  test("file untouched after sinceSha returns false", () => {
    const touched = fileTouchedInRange(
      [
        { sha: "a", files: ["src/x.ts"] },
        { sha: "b", files: ["src/y.ts"] },
      ],
      "a",
      "src/x.ts",
    );
    expect(touched).toBe(false);
  });

  test("sinceSha not in list returns false", () => {
    const touched = fileTouchedInRange(
      [{ sha: "a", files: ["src/x.ts"] }],
      "nonexistent",
      "src/x.ts",
    );
    expect(touched).toBe(false);
  });
});

describe("ingestDismissalsImpl — fail-closed paths", () => {
  test("redis === null → returns zero counts without crashing", async () => {
    const fakeOctokit: IngestOctokit = {
      paginate: {
        iterator: async function* () {
          /* yield nothing */
        },
      },
      rest: {
        issues: { listCommentsForRepo: {}, listEventsForRepo: {} },
        pulls: {
          listReviewCommentsForRepo: {},
          get: async () => ({ data: {} }),
          listCommits: {},
        },
        reactions: {
          listForPullRequestReviewComment: {},
          listForIssueComment: {},
        },
      },
    };
    const result = await ingestDismissalsImpl(
      "o",
      "r",
      { since: "2026-05-01T00:00:00Z" },
      {
        octokit: fakeOctokit,
        redis: null,
        now: () => new Date("2026-06-01T00:00:00Z"),
      },
    );
    expect(result.thumbsDownIngested).toBe(0);
    expect(result.resolvedWithoutFollowupIngested).toBe(0);
  });

  test("octokit undefined → returns zero counts without crashing", async () => {
    const fakeRedis = makeFakeRedis();
    const result = await ingestDismissalsImpl(
      "o",
      "r",
      { since: "2026-05-01T00:00:00Z" },
      { redis: fakeRedis, now: () => new Date("2026-06-01T00:00:00Z") },
    );
    expect(result.thumbsDownIngested).toBe(0);
  });
});

describe("ingestDismissalsImpl — thumbs-down ingest", () => {
  test("bot comment with 👎 reaction is ingested", async () => {
    const fakeRedis = makeFakeRedis();
    const fakeVec = unitVector(1);
    const reviewComments = [
      botReviewComment(
        "<!-- pr-review-finding hash=01deadbeef0123 kind=correctness file=src/x.ts claim=ignores err -->",
      ),
    ];
    const reactions = [thumbsDownReaction()];

    const fakeOctokit = makeIngestOctokit({ reviewComments, reactions });

    const result = await runIngest(fakeRedis, fakeOctokit, fakeVec);
    expect(result.thumbsDownIngested).toBe(1);
    expect(fakeRedis._store.size).toBe(1);
    const key = "pr-review:dismissed:o/r:src/x.ts:correctness";
    expect(fakeRedis._store.has(key)).toBe(true);
  });

  test("bot comment without 👎 reaction is NOT ingested", async () => {
    const fakeRedis = makeFakeRedis();
    const fakeVec = unitVector(1);
    const reviewComments = [
      botReviewComment(
        "<!-- pr-review-finding hash=01 kind=correctness file=src/x.ts claim=c -->",
      ),
    ];
    const reactions = [{ content: "+1", created_at: "..." }];

    const fakeOctokit = makeIngestOctokit({ reviewComments, reactions });

    const result = await runIngest(fakeRedis, fakeOctokit, fakeVec);
    expect(result.thumbsDownIngested).toBe(0);
  });

  test("re-running over the same window does not duplicate ingestion", async () => {
    const fakeRedis = makeFakeRedis();
    const fakeVec = unitVector(1);
    const reviewComments = [
      botReviewComment(
        "<!-- pr-review-finding hash=01deadbeef0123 kind=correctness file=src/x.ts claim=c -->",
      ),
    ];
    const reactions = [
      { content: "-1", created_at: "...", user: { login: "o" } },
    ];

    const makeOcto = (): IngestOctokit =>
      makeIngestOctokit({ reviewComments, reactions });

    const first = await runIngest(fakeRedis, makeOcto(), fakeVec);
    expect(first.thumbsDownIngested).toBe(1);
    const second = await runIngest(fakeRedis, makeOcto(), fakeVec);
    expect(second.thumbsDownIngested).toBe(0);
    expect(second.skippedDuplicates).toBeGreaterThanOrEqual(1);
  });
});
