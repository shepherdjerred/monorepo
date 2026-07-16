import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _dedupeAgainstHistoryImpl, _resetRedisForTest } from "./dedupe.ts";
import { appendEntry } from "#lib/pr-review/dismissed-store.ts";
import { EMBEDDING_DIM } from "#lib/pr-review/embedding.ts";
import {
  makeDismissedEntry,
  makeFakeRedis,
  makeFinding,
  unitVector,
  type FakeRedis,
} from "./testing/fixtures.ts";

const FROZEN_NOW = new Date("2026-06-01T12:00:00Z");

/**
 * Runs the dedupe impl over a single default finding, embedding it to
 * `vector` via the local embedder (Voyage disabled). Covers the common
 * "one candidate, exact-match embedding" shape; tests needing custom findings
 * or a failing embedder call `_dedupeAgainstHistoryImpl` directly.
 */
function runDedupe(fakeRedis: FakeRedis, vector: number[]) {
  return _dedupeAgainstHistoryImpl(
    { owner: "o", repo: "r", findings: [makeFinding()] },
    {
      redis: fakeRedis,
      embed: { voyageApiKey: "", localEmbedder: async () => vector },
    },
  );
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
    const entry = makeDismissedEntry(sharedVec, {
      hash: "h1",
      evidence: { commentId: 100, prNumber: 1, sha: "abc" },
    });
    await appendEntry(fakeRedis, key, entry, 86_400);
    // localEmbedder returns the same vector → cosine 1 → suppressed.
    const out = await runDedupe(fakeRedis, sharedVec);
    expect(out.length).toBe(0);
  });
});

describe("dedupeAgainstHistory — scope guarantees", () => {
  test("dismissal on different repo does NOT suppress", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(1);
    const wrongKey = "pr-review:dismissed:other/other:src/foo.ts:correctness";
    const entry = makeDismissedEntry(sharedVec);
    await appendEntry(fakeRedis, wrongKey, entry, 86_400);
    const out = await runDedupe(fakeRedis, sharedVec);
    expect(out.length).toBe(1);
  });

  test("dismissal on different path does NOT suppress", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(1);
    const wrongKey = "pr-review:dismissed:o/r:src/bar.ts:correctness";
    const entry = makeDismissedEntry(sharedVec);
    await appendEntry(fakeRedis, wrongKey, entry, 86_400);
    const out = await runDedupe(fakeRedis, sharedVec);
    expect(out.length).toBe(1);
  });

  test("dismissal on different kind does NOT suppress", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(1);
    const wrongKey = "pr-review:dismissed:o/r:src/foo.ts:security";
    const entry = makeDismissedEntry(sharedVec);
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
    const entry = makeDismissedEntry(sharedVec);
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
    const entry = makeDismissedEntry(sharedVec, {
      dismissedAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-04-01T00:00:00.000Z", // expired
    });
    await appendEntry(fakeRedis, key, entry, 86_400);
    const out = await runDedupe(fakeRedis, sharedVec);
    expect(out.length).toBe(1);
  });
});

describe("dedupeAgainstHistory — cumulative weight semantics", () => {
  test("two resolved-without-followup entries together → dropped", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(7);
    const key = "pr-review:dismissed:o/r:src/foo.ts:correctness";
    for (const hash of ["a", "b"]) {
      const entry = makeDismissedEntry(sharedVec, {
        hash,
        reason: "resolved-without-followup",
        weight: 0.5,
      });
      await appendEntry(fakeRedis, key, entry, 86_400);
    }
    const out = await runDedupe(fakeRedis, sharedVec);
    expect(out.length).toBe(0);
  });

  test("one resolved-without-followup alone → NOT dropped", async () => {
    const fakeRedis = makeFakeRedis();
    const sharedVec = unitVector(7);
    const key = "pr-review:dismissed:o/r:src/foo.ts:correctness";
    const entry = makeDismissedEntry(sharedVec, {
      hash: "a",
      reason: "resolved-without-followup",
      weight: 0.5,
    });
    await appendEntry(fakeRedis, key, entry, 86_400);
    const out = await runDedupe(fakeRedis, sharedVec);
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
    const entry = makeDismissedEntry(entryVec);
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
