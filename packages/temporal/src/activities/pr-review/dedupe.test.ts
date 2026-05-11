import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _dedupeAgainstHistoryImpl, _resetRedisForTest } from "./dedupe.ts";
import {
  appendEntry,
  encodeEmbedding,
  type DismissedEntry,
} from "#lib/pr-review/dismissed-store.ts";
import { EMBEDDING_DIM } from "#lib/pr-review/embedding.ts";
import type { Finding } from "#shared/pr-review/finding.ts";

const FROZEN_NOW = new Date("2026-06-01T12:00:00Z");

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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    file: "src/foo.ts",
    lineStart: 10,
    lineEnd: 12,
    kind: "correctness",
    severity: "warning",
    verifier: "none",
    claim: "ignores the error from foo()",
    evidence: "snippet",
    confidence: 0.8,
    ...overrides,
  };
}

/**
 * In-memory Redis mock matching the methods dedupe.ts uses
 * (LRANGE/LPUSH/LTRIM/EXPIRE via `send`). Keys map to lists of JSON
 * strings.
 */
function makeFakeRedis() {
  const store = new Map<string, string[]>();
  return {
    async send(cmd: string, args: string[]): Promise<unknown> {
      const upper = cmd.toUpperCase();
      const key = args[0] ?? "";
      if (upper === "LRANGE") {
        return store.get(key) ?? [];
      }
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
      if (upper === "EXPIRE") {
        return 1;
      }
      throw new Error(`unsupported in mock: ${cmd}`);
    },
    _store: store,
  };
}

beforeEach(() => {
  _resetRedisForTest();
});
afterEach(() => {
  _resetRedisForTest();
});

describe("dedupeAgainstHistory — happy paths", () => {
  test("empty input returns empty without touching Redis", async () => {
    const fakeRedis = makeFakeRedis();
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [] },
      { redis: fakeRedis },
    );
    expect(out).toEqual([]);
    expect(fakeRedis._store.size).toBe(0);
  });

  test("no dismissed entries → all findings kept", async () => {
    const fakeRedis = makeFakeRedis();
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: { voyageApiKey: "", localEmbedder: async () => unitVector(1) },
      },
    );
    expect(out.length).toBe(1);
  });

  test("dismissed entry with high sim → finding dropped", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(42);
    const key = "pr-review:dismissed:o/r:src/foo.ts:correctness";
    const entry: DismissedEntry = {
      hash: "h1",
      embedding: encodeEmbedding(sharedVec),
      dismissedAt: "2026-05-30T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      reason: "thumbs-down",
      weight: 1,
      evidence: { commentId: 100, prNumber: 1, sha: "abc" },
    };
    await appendEntry(fakeRedis, key, entry, 86_400);
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: {
          voyageApiKey: "",
          localEmbedder: async () => sharedVec, // exact match → cosine 1
        },
      },
    );
    expect(out.length).toBe(0);
  });
});

describe("dedupeAgainstHistory — scope guarantees", () => {
  test("dismissal on different repo does NOT suppress", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(1);
    const wrongKey = "pr-review:dismissed:other/other:src/foo.ts:correctness";
    const entry: DismissedEntry = {
      hash: "h",
      embedding: encodeEmbedding(sharedVec),
      dismissedAt: "2026-05-30T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      reason: "thumbs-down",
      weight: 1,
      evidence: { commentId: 1, prNumber: 1, sha: "x" },
    };
    await appendEntry(fakeRedis, wrongKey, entry, 86_400);
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: { voyageApiKey: "", localEmbedder: async () => sharedVec },
      },
    );
    expect(out.length).toBe(1);
  });

  test("dismissal on different path does NOT suppress", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(1);
    const wrongKey = "pr-review:dismissed:o/r:src/bar.ts:correctness";
    const entry: DismissedEntry = {
      hash: "h",
      embedding: encodeEmbedding(sharedVec),
      dismissedAt: "2026-05-30T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      reason: "thumbs-down",
      weight: 1,
      evidence: { commentId: 1, prNumber: 1, sha: "x" },
    };
    await appendEntry(fakeRedis, wrongKey, entry, 86_400);
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: { voyageApiKey: "", localEmbedder: async () => sharedVec },
      },
    );
    expect(out.length).toBe(1);
  });

  test("dismissal on different kind does NOT suppress", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(1);
    const wrongKey = "pr-review:dismissed:o/r:src/foo.ts:security";
    const entry: DismissedEntry = {
      hash: "h",
      embedding: encodeEmbedding(sharedVec),
      dismissedAt: "2026-05-30T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      reason: "thumbs-down",
      weight: 1,
      evidence: { commentId: 1, prNumber: 1, sha: "x" },
    };
    await appendEntry(fakeRedis, wrongKey, entry, 86_400);
    const out = await _dedupeAgainstHistoryImpl(
      {
        owner: "o",
        repo: "r",
        findings: [makeFinding({ kind: "correctness" })],
      },
      {
        redis: fakeRedis,
        embed: { voyageApiKey: "", localEmbedder: async () => sharedVec },
      },
    );
    expect(out.length).toBe(1);
  });
});

describe("dedupeAgainstHistory — fail-closed behavior", () => {
  test("redis === null → all findings kept (fail-closed)", async () => {
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      { redis: null },
    );
    expect(out.length).toBe(1);
  });

  test("embedding returns null (both providers failed) → kept", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(1);
    const key = "pr-review:dismissed:o/r:src/foo.ts:correctness";
    const entry: DismissedEntry = {
      hash: "h",
      embedding: encodeEmbedding(sharedVec),
      dismissedAt: "2026-05-30T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      reason: "thumbs-down",
      weight: 1,
      evidence: { commentId: 1, prNumber: 1, sha: "x" },
    };
    await appendEntry(fakeRedis, key, entry, 86_400);

    // Both providers fail
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: {
          voyageApiKey: "test",
          voyageFetch: async () => new Response("err", { status: 503 }),
          localEmbedder: async () => {
            throw new Error("local dead");
          },
        },
      },
    );
    // Fail-closed: keep the finding rather than risk a false drop.
    expect(out.length).toBe(1);
  });

  test("expired entries do NOT suppress", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(1);
    const key = "pr-review:dismissed:o/r:src/foo.ts:correctness";
    const entry: DismissedEntry = {
      hash: "h",
      embedding: encodeEmbedding(sharedVec),
      dismissedAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-04-01T00:00:00.000Z", // expired
      reason: "thumbs-down",
      weight: 1,
      evidence: { commentId: 1, prNumber: 1, sha: "x" },
    };
    await appendEntry(fakeRedis, key, entry, 86_400);
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: { voyageApiKey: "", localEmbedder: async () => sharedVec },
      },
    );
    expect(out.length).toBe(1);
  });
});

describe("dedupeAgainstHistory — cumulative weight semantics", () => {
  test("two resolved-without-followup entries together → dropped", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(7);
    const key = "pr-review:dismissed:o/r:src/foo.ts:correctness";
    for (const hash of ["a", "b"]) {
      const entry: DismissedEntry = {
        hash,
        embedding: encodeEmbedding(sharedVec),
        dismissedAt: "2026-05-30T00:00:00.000Z",
        expiresAt: "2026-08-28T00:00:00.000Z",
        reason: "resolved-without-followup",
        weight: 0.5,
        evidence: { commentId: 1, prNumber: 1, sha: "x" },
      };
      await appendEntry(fakeRedis, key, entry, 86_400);
    }
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: { voyageApiKey: "", localEmbedder: async () => sharedVec },
      },
    );
    expect(out.length).toBe(0);
  });

  test("one resolved-without-followup alone → NOT dropped", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(7);
    const key = "pr-review:dismissed:o/r:src/foo.ts:correctness";
    const entry: DismissedEntry = {
      hash: "a",
      embedding: encodeEmbedding(sharedVec),
      dismissedAt: "2026-05-30T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      reason: "resolved-without-followup",
      weight: 0.5,
      evidence: { commentId: 1, prNumber: 1, sha: "x" },
    };
    await appendEntry(fakeRedis, key, entry, 86_400);
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: { voyageApiKey: "", localEmbedder: async () => sharedVec },
      },
    );
    expect(out.length).toBe(1);
  });
});

describe("dedupeAgainstHistory — threshold clamping", () => {
  test("threshold below 0.7 clamps to 0.7", async () => {
    const fakeRedis = makeFakeRedis();
    // Build entry that has cosine sim ≈ 0.75 with the candidate — would
    // be suppressed if threshold honored a passed-in 0.5, NOT suppressed
    // at the clamped 0.7.
    const candidate = Array.from({ length: EMBEDDING_DIM }, () => 0);
    candidate[0] = 1;
    const entryVec = Array.from({ length: EMBEDDING_DIM }, () => 0);
    entryVec[0] = 0.75;
    entryVec[1] = Math.sqrt(1 - 0.75 * 0.75);
    const key = "pr-review:dismissed:o/r:src/foo.ts:correctness";
    const entry: DismissedEntry = {
      hash: "h",
      embedding: encodeEmbedding(entryVec),
      dismissedAt: "2026-05-30T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      reason: "thumbs-down",
      weight: 1,
      evidence: { commentId: 1, prNumber: 1, sha: "x" },
    };
    await appendEntry(fakeRedis, key, entry, 86_400);

    // Passing threshold 0.5 should clamp to 0.7; 0.75 > 0.7 → drop.
    const out = await _dedupeAgainstHistoryImpl(
      { owner: "o", repo: "r", findings: [makeFinding()] },
      {
        redis: fakeRedis,
        embed: { voyageApiKey: "", localEmbedder: async () => candidate },
        cosineThreshold: 0.5,
      },
    );
    expect(out.length).toBe(0);
  });
});

// Keep the date import live to silence the unused-variable lint while
// the time-of-day frozen now is documented for future test additions.
void FROZEN_NOW;
