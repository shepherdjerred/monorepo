import { describe, expect, test } from "bun:test";
import { ingestDismissalsImpl } from "./ingest-dismissals.ts";
import {
  extractFindingRef,
  fileTouchedInRange,
  isBotAuthored,
  type IngestOctokit,
} from "#lib/pr-review/reaction-listener-helpers.ts";
import { EMBEDDING_DIM } from "#lib/pr-review/embedding.ts";

/** Module-scope no-op for activity heartbeat injection in tests. */
function noopHeartbeat(): void {
  // intentional no-op for unit tests
}

function unitVector(seed: number): number[] {
  const v = Array.from({ length: EMBEDDING_DIM }, () => 0);
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    v[i] = Math.sin(seed + i);
    norm += (v[i] ?? 0) * (v[i] ?? 0);
  }
  const s = Math.sqrt(norm);
  for (let i = 0; i < EMBEDDING_DIM; i++) v[i] = (v[i] ?? 0) / s;
  return v;
}

function makeFakeRedis() {
  const store = new Map<string, string[]>();
  return {
    async send(cmd: string, args: string[]): Promise<unknown> {
      const upper = cmd.toUpperCase();
      const key = args[0] ?? "";
      if (upper === "LRANGE") return store.get(key) ?? [];
      if (upper === "LPUSH") {
        const list = store.get(key) ?? [];
        const value = args[1] ?? "";
        store.set(key, [value, ...list]);
        return list.length + 1;
      }
      if (upper === "LTRIM") {
        const list = store.get(key) ?? [];
        const stop = Number.parseInt(args[2] ?? "0", 10);
        store.set(key, list.slice(0, stop + 1));
        return "OK";
      }
      if (upper === "EXPIRE") return 1;
      throw new Error(`unsupported in mock: ${cmd}`);
    },
    _store: store,
  };
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
      {
        id: 555,
        pull_request_url: "https://api.github.com/repos/o/r/pulls/42",
        body: "<!-- pr-review-finding hash=01deadbeef0123 kind=correctness file=src/x.ts claim=ignores err -->",
        created_at: "2026-05-30T10:00:00Z",
        user: { login: "pr-review-bot", type: "Bot" },
      },
    ];
    const reactions = [{ content: "-1", created_at: "2026-05-30T11:00:00Z" }];

    const ROUTE_LIST = { _id: "listReviewCommentsForRepo" };
    const ROUTE_REACTIONS = { _id: "listForPullRequestReviewComment" };
    const fakeOctokit: IngestOctokit = {
      paginate: {
        iterator: async function* (route: unknown) {
          if (route === ROUTE_LIST) {
            yield { data: reviewComments };
          } else if (route === ROUTE_REACTIONS) {
            yield { data: reactions };
          } else {
            yield { data: [] };
          }
        },
      },
      rest: {
        issues: { listCommentsForRepo: {}, listEventsForRepo: {} },
        pulls: {
          listReviewCommentsForRepo: ROUTE_LIST,
          get: async () => ({ data: { number: 42, state: "open" } }),
          listCommits: { _id: "listCommits" },
        },
        reactions: {
          listForPullRequestReviewComment: ROUTE_REACTIONS,
          listForIssueComment: {},
        },
      },
    };

    const result = await ingestDismissalsImpl(
      "o",
      "r",
      { since: "2026-05-01T00:00:00Z" },
      {
        redis: fakeRedis,
        octokit: fakeOctokit,
        embed: { voyageApiKey: "", localEmbedder: async () => fakeVec },
        now: () => new Date("2026-05-31T00:00:00Z"),
        botLogin: "pr-review-bot",
        heartbeat: noopHeartbeat,
      },
    );
    expect(result.thumbsDownIngested).toBe(1);
    expect(fakeRedis._store.size).toBe(1);
    const key = "pr-review:dismissed:o/r:src/x.ts:correctness";
    expect(fakeRedis._store.has(key)).toBe(true);
  });

  test("bot comment without 👎 reaction is NOT ingested", async () => {
    const fakeRedis = makeFakeRedis();
    const fakeVec = unitVector(1);
    const reviewComments = [
      {
        id: 555,
        pull_request_url: "https://api.github.com/repos/o/r/pulls/42",
        body: "<!-- pr-review-finding hash=01 kind=correctness file=src/x.ts claim=c -->",
        created_at: "2026-05-30T10:00:00Z",
        user: { login: "pr-review-bot", type: "Bot" },
      },
    ];
    const reactions = [{ content: "+1", created_at: "..." }];

    const ROUTE_LIST = { _id: "listReviewCommentsForRepo" };
    const fakeOctokit: IngestOctokit = {
      paginate: {
        iterator: async function* (route: unknown) {
          yield route === ROUTE_LIST
            ? { data: reviewComments }
            : { data: reactions };
        },
      },
      rest: {
        issues: { listCommentsForRepo: {}, listEventsForRepo: {} },
        pulls: {
          listReviewCommentsForRepo: ROUTE_LIST,
          get: async () => ({ data: { number: 42, state: "open" } }),
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
        redis: fakeRedis,
        octokit: fakeOctokit,
        embed: { voyageApiKey: "", localEmbedder: async () => fakeVec },
        now: () => new Date("2026-05-31T00:00:00Z"),
        botLogin: "pr-review-bot",
        heartbeat: noopHeartbeat,
      },
    );
    expect(result.thumbsDownIngested).toBe(0);
  });

  test("re-running over the same window does not duplicate ingestion", async () => {
    const fakeRedis = makeFakeRedis();
    const fakeVec = unitVector(1);
    const reviewComments = [
      {
        id: 555,
        pull_request_url: "https://api.github.com/repos/o/r/pulls/42",
        body: "<!-- pr-review-finding hash=01deadbeef0123 kind=correctness file=src/x.ts claim=c -->",
        created_at: "2026-05-30T10:00:00Z",
        user: { login: "pr-review-bot", type: "Bot" },
      },
    ];
    const reactions = [{ content: "-1", created_at: "..." }];

    const makeOcto = (): IngestOctokit => {
      const ROUTE_LIST = { _id: "lrc" };
      const ROUTE_REACTIONS = { _id: "lprc" };
      const o: IngestOctokit = {
        paginate: {
          iterator: async function* (route: unknown) {
            if (route === ROUTE_LIST) {
              yield { data: reviewComments };
            } else if (route === ROUTE_REACTIONS) {
              yield { data: reactions };
            } else {
              yield { data: [] };
            }
          },
        },
        rest: {
          issues: { listCommentsForRepo: {}, listEventsForRepo: {} },
          pulls: {
            listReviewCommentsForRepo: ROUTE_LIST,
            get: async () => ({ data: { number: 42, state: "open" } }),
            listCommits: {},
          },
          reactions: {
            listForPullRequestReviewComment: ROUTE_REACTIONS,
            listForIssueComment: {},
          },
        },
      };
      return o;
    };

    const first = await ingestDismissalsImpl(
      "o",
      "r",
      { since: "2026-05-01T00:00:00Z" },
      {
        redis: fakeRedis,
        octokit: makeOcto(),
        embed: { voyageApiKey: "", localEmbedder: async () => fakeVec },
        now: () => new Date("2026-05-31T00:00:00Z"),
        botLogin: "pr-review-bot",
        heartbeat: noopHeartbeat,
      },
    );
    expect(first.thumbsDownIngested).toBe(1);
    const second = await ingestDismissalsImpl(
      "o",
      "r",
      { since: "2026-05-01T00:00:00Z" },
      {
        redis: fakeRedis,
        octokit: makeOcto(),
        embed: { voyageApiKey: "", localEmbedder: async () => fakeVec },
        now: () => new Date("2026-05-31T00:00:00Z"),
        botLogin: "pr-review-bot",
        heartbeat: noopHeartbeat,
      },
    );
    expect(second.thumbsDownIngested).toBe(0);
    expect(second.skippedDuplicates).toBeGreaterThanOrEqual(1);
  });
});
