import { describe, expect, test } from "bun:test";
import {
  decodeEmbedding,
  dismissalKey,
  encodeEmbedding,
  entryAlreadyPresent,
  parseEntries,
  scanSimilarity,
  type DismissedEntry,
} from "./dismissed-store.ts";
import { EMBEDDING_DIM, cosineSimilarity } from "./embedding.ts";

function makeEntry(overrides: Partial<DismissedEntry> = {}): DismissedEntry {
  const vec = Array.from({ length: EMBEDDING_DIM }, () => 0);
  vec[0] = 1;
  return {
    hash: "deadbeef",
    embedding: encodeEmbedding(vec),
    dismissedAt: "2026-05-10T00:00:00.000Z",
    expiresAt: "2026-08-08T00:00:00.000Z",
    reason: "thumbs-down",
    weight: 1,
    evidence: { commentId: 1, prNumber: 100, sha: "abc1234" },
    ...overrides,
  };
}

describe("dismissalKey — scope isolation", () => {
  test("distinct repos do NOT collide", () => {
    const a = dismissalKey("org", "repo-a", "src/foo.ts", "correctness");
    const b = dismissalKey("org", "repo-b", "src/foo.ts", "correctness");
    expect(a).not.toBe(b);
  });

  test("distinct paths do NOT collide", () => {
    const a = dismissalKey("org", "repo", "src/foo.ts", "correctness");
    const b = dismissalKey("org", "repo", "src/bar.ts", "correctness");
    expect(a).not.toBe(b);
  });

  test("distinct kinds do NOT collide", () => {
    const a = dismissalKey("org", "repo", "src/foo.ts", "correctness");
    const b = dismissalKey("org", "repo", "src/foo.ts", "security");
    expect(a).not.toBe(b);
  });

  test("identical (repo, path, kind) DOES collide (lookups are scoped)", () => {
    const a = dismissalKey("org", "repo", "src/foo.ts", "correctness");
    const b = dismissalKey("org", "repo", "src/foo.ts", "correctness");
    expect(a).toBe(b);
  });

  test("repo with slash in name is captured (owner/name pair)", () => {
    const a = dismissalKey("acme", "monorepo", "x.ts", "deps");
    expect(a).toBe("pr-review:dismissed:acme/monorepo:x.ts:deps");
  });
});

describe("encodeEmbedding / decodeEmbedding", () => {
  test("round-trips a 384-d vector", () => {
    const vec = Array.from({ length: EMBEDDING_DIM }, (_, i) => Math.sin(i));
    const decoded = decodeEmbedding(encodeEmbedding(vec));
    expect(decoded).not.toBeNull();
    if (decoded === null) return;
    expect(decoded.length).toBe(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(Math.abs((decoded[i] ?? 0) - (vec[i] ?? 0))).toBeLessThan(1e-6);
    }
  });

  test("encode rejects wrong dim", () => {
    expect(() => encodeEmbedding([1, 2, 3])).toThrow(/embedding dim/);
  });

  test("decode returns null for wrong byte length", () => {
    const result = decodeEmbedding("AAAA");
    expect(result).toBeNull();
  });
});

describe("scanSimilarity — cumulative weight", () => {
  const candidate = (() => {
    const v = Array.from({ length: EMBEDDING_DIM }, () => 0);
    v[0] = 1;
    return v;
  })();

  test("single thumbs-down entry at high sim → cumulative weight 1.0", () => {
    const entry = makeEntry({ weight: 1, reason: "thumbs-down" });
    const scan = scanSimilarity({
      entries: [entry],
      candidate,
      cosineThreshold: 0.85,
      cosine: cosineSimilarity,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(scan.cumulativeWeight).toBe(1);
    expect(scan.matchedCount).toBe(1);
    expect(scan.bestSim).toBeGreaterThan(0.99);
  });

  test("one resolved-without-followup at high sim → cumulative 0.5 (NOT dismissed)", () => {
    const entry = makeEntry({
      weight: 0.5,
      reason: "resolved-without-followup",
    });
    const scan = scanSimilarity({
      entries: [entry],
      candidate,
      cosineThreshold: 0.85,
      cosine: cosineSimilarity,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(scan.cumulativeWeight).toBe(0.5);
  });

  test("two resolved-without-followup at high sim → cumulative 1.0 (dismissed)", () => {
    const entries = [
      makeEntry({
        weight: 0.5,
        reason: "resolved-without-followup",
        hash: "a",
      }),
      makeEntry({
        weight: 0.5,
        reason: "resolved-without-followup",
        hash: "b",
      }),
    ];
    const scan = scanSimilarity({
      entries: entries,
      candidate,
      cosineThreshold: 0.85,
      cosine: cosineSimilarity,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(scan.cumulativeWeight).toBe(1);
    expect(scan.matchedCount).toBe(2);
  });

  test("mixed thumbs-down + resolved-without-followup → cumulative 1.5", () => {
    const entries = [
      makeEntry({ weight: 1, reason: "thumbs-down", hash: "a" }),
      makeEntry({
        weight: 0.5,
        reason: "resolved-without-followup",
        hash: "b",
      }),
    ];
    const scan = scanSimilarity({
      entries: entries,
      candidate,
      cosineThreshold: 0.85,
      cosine: cosineSimilarity,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(scan.cumulativeWeight).toBe(1.5);
  });

  test("expired entries are excluded from the sum", () => {
    const expired = makeEntry({
      weight: 1,
      hash: "old",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    const active = makeEntry({
      weight: 0.5,
      reason: "resolved-without-followup",
      hash: "new",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });
    const scan = scanSimilarity({
      entries: [expired, active],
      candidate,
      cosineThreshold: 0.85,
      cosine: cosineSimilarity,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(scan.cumulativeWeight).toBe(0.5);
    expect(scan.matchedCount).toBe(1);
  });

  test("entry below cosine threshold does NOT contribute", () => {
    // Make an orthogonal embedding (cosine = 0)
    const orthogonal = Array.from({ length: EMBEDDING_DIM }, () => 0);
    orthogonal[1] = 1;
    const entry = makeEntry({
      weight: 1,
      embedding: encodeEmbedding(orthogonal),
    });
    const scan = scanSimilarity({
      entries: [entry],
      candidate,
      cosineThreshold: 0.85,
      cosine: cosineSimilarity,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(scan.cumulativeWeight).toBe(0);
    expect(scan.matchedCount).toBe(0);
  });

  test("threshold edge: sim just above 0.85 contributes", () => {
    // Build a vector with controlled cosine ≈ 0.86 relative to (1,0,...).
    const target = Array.from({ length: EMBEDDING_DIM }, () => 0);
    target[0] = 0.86;
    target[1] = Math.sqrt(1 - 0.86 * 0.86);
    const entry = makeEntry({ weight: 1, embedding: encodeEmbedding(target) });
    const scan = scanSimilarity({
      entries: [entry],
      candidate,
      cosineThreshold: 0.85,
      cosine: cosineSimilarity,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(scan.cumulativeWeight).toBe(1);
  });

  test("threshold edge: sim just below 0.85 does NOT contribute", () => {
    const target = Array.from({ length: EMBEDDING_DIM }, () => 0);
    target[0] = 0.84;
    target[1] = Math.sqrt(1 - 0.84 * 0.84);
    const entry = makeEntry({ weight: 1, embedding: encodeEmbedding(target) });
    const scan = scanSimilarity({
      entries: [entry],
      candidate,
      cosineThreshold: 0.85,
      cosine: cosineSimilarity,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(scan.cumulativeWeight).toBe(0);
  });
});

describe("parseEntries — malformed input handling", () => {
  test("drops invalid JSON without throwing", () => {
    const parsed = parseEntries(["not json", JSON.stringify(makeEntry())]);
    expect(parsed.length).toBe(1);
  });

  test("drops schema-mismatched JSON without throwing", () => {
    const parsed = parseEntries([
      JSON.stringify({ foo: "bar" }),
      JSON.stringify(makeEntry()),
    ]);
    expect(parsed.length).toBe(1);
  });

  test("returns empty list when given an empty input", () => {
    expect(parseEntries([])).toEqual([]);
  });
});

describe("entryAlreadyPresent — hash-based idempotency", () => {
  test("matches by hash regardless of timestamp / weight", () => {
    const a = makeEntry({ hash: "same", weight: 1 });
    const b = makeEntry({
      hash: "same",
      weight: 0.5,
      dismissedAt: "2027-01-01T00:00:00.000Z",
    });
    expect(entryAlreadyPresent([a], b.hash)).toBe(true);
  });

  test("misses on different hash", () => {
    const a = makeEntry({ hash: "a" });
    expect(entryAlreadyPresent([a], "b")).toBe(false);
  });

  test("returns false on empty list", () => {
    expect(entryAlreadyPresent([], "x")).toBe(false);
  });
});
