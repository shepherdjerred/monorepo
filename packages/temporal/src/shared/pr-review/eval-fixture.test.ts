import { describe, expect, it } from "bun:test";
import { FixtureSchema, grade, type Fixture } from "./eval-fixture.ts";
import type { Finding } from "./finding.ts";

// Minimal Finding constructor — the eval grader ignores id/evidence/
// confidence/votes, but the Zod schema demands them, so default them
// sensibly.
function makeFinding(
  partial: Partial<Finding> & Pick<Finding, "file" | "lineStart" | "claim">,
): Finding {
  return {
    id: partial.id ?? `${partial.file}:${String(partial.lineStart)}`,
    file: partial.file,
    lineStart: partial.lineStart,
    lineEnd: partial.lineEnd ?? partial.lineStart,
    kind: partial.kind ?? "correctness",
    severity: partial.severity ?? "warning",
    verifier: partial.verifier ?? "none",
    claim: partial.claim,
    evidence: partial.evidence ?? "evidence string",
    confidence: partial.confidence ?? 0.9,
    votes: partial.votes,
  };
}

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  const base: Fixture = {
    id: "test-fixture",
    category: "real-bug",
    source: {
      repo: "shepherdjerred/monorepo",
      commitSha: "a".repeat(40),
      parentSha: "b".repeat(40),
    },
    diffPath: "pr.diff",
    snapshotRef: "snapshot/test-fixture",
    expectedFindings: [],
    forbiddenFindings: [],
    notes: "test fixture",
  };
  return { ...base, ...overrides };
}

describe("FixtureSchema", () => {
  it("accepts a minimal real-bug fixture", () => {
    const parsed = FixtureSchema.parse(makeFixture());
    expect(parsed.id).toBe("test-fixture");
    expect(parsed.category).toBe("real-bug");
  });

  it("rejects an invalid commit SHA", () => {
    const result = FixtureSchema.safeParse(
      makeFixture({
        source: {
          repo: "shepherdjerred/monorepo",
          commitSha: "not-a-sha",
          parentSha: "b".repeat(40),
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("requires Pattern to have at least claimSubstring or claimRegex", () => {
    const result = FixtureSchema.safeParse(
      makeFixture({
        forbiddenFindings: [{ file: "x.ts" }],
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("grade", () => {
  it("scores precision=recall=1 when bot exactly matches expected findings", () => {
    const fixture = makeFixture({
      expectedFindings: [
        {
          file: "src/foo.ts",
          lineStart: 10,
          lineEnd: 10,
          kind: "correctness",
          severity: "critical",
          verifier: "typecheck",
          claim: "missing await",
        },
      ],
    });
    const posted = [
      makeFinding({
        file: "src/foo.ts",
        lineStart: 11, // same cluster (bucket 7)
        claim: "promise not awaited",
      }),
    ];
    const result = grade(fixture, posted);
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(0);
    expect(result.fn).toBe(0);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
  });

  it("counts unmatched expected as FN", () => {
    const fixture = makeFixture({
      expectedFindings: [
        {
          file: "src/foo.ts",
          lineStart: 10,
          lineEnd: 10,
          kind: "correctness",
          severity: "warning",
          verifier: "none",
          claim: "x",
        },
      ],
    });
    const result = grade(fixture, []);
    expect(result.tp).toBe(0);
    expect(result.fn).toBe(1);
    expect(result.recall).toBe(0);
    expect(result.fnDetails).toHaveLength(1);
  });

  it("counts forbidden-pattern matches as FP", () => {
    const fixture = makeFixture({
      category: "hallucination-target",
      forbiddenFindings: [{ claimSubstring: "precision loss" }],
    });
    const posted = [
      makeFinding({
        file: "src/cast.ts",
        lineStart: 5,
        claim: "this f64 cast introduces precision loss",
      }),
    ];
    const result = grade(fixture, posted);
    expect(result.fp).toBe(1);
    expect(result.tp).toBe(0);
    expect(result.precision).toBe(0);
    expect(result.fpDetails[0]?.matchedPattern).toContain("substring");
  });

  it("honors `file` scoping on patterns", () => {
    const fixture = makeFixture({
      category: "hallucination-target",
      forbiddenFindings: [{ claimSubstring: "regression", file: "src/a.ts" }],
    });
    const posted = [
      makeFinding({
        file: "src/b.ts", // different file — pattern should not match
        lineStart: 10,
        claim: "this looks like a regression",
      }),
    ];
    const result = grade(fixture, posted);
    // No expected, no forbidden match (file mismatch), so the comment falls
    // under maxComments. Hallucination-target has default maxComments=0,
    // so this counts as FP.
    expect(result.fp).toBe(1);
    expect(result.fpDetails[0]?.matchedPattern).toContain("beyond maxComments");
  });

  it("supports regex patterns", () => {
    const fixture = makeFixture({
      category: "hallucination-target",
      forbiddenFindings: [{ claimRegex: "swallows.+error" }],
    });
    const posted = [
      makeFinding({
        file: "src/x.ts",
        lineStart: 5,
        claim: "the catch block swallows the error silently",
      }),
    ];
    const result = grade(fixture, posted);
    expect(result.fp).toBe(1);
    expect(result.fpDetails[0]?.matchedPattern).toMatch(/regex/);
  });

  it("refactor category tolerates 1 unexpected comment by default", () => {
    const fixture = makeFixture({ category: "refactor" });
    const posted = [
      makeFinding({
        file: "src/foo.ts",
        lineStart: 5,
        claim: "minor style nit",
      }),
    ];
    const result = grade(fixture, posted);
    expect(result.fp).toBe(0); // within maxComments=1 default
    expect(result.precision).toBe(1);
  });

  it("refactor category flags excess comments as FP", () => {
    const fixture = makeFixture({ category: "refactor" });
    const posted = [
      makeFinding({ file: "src/foo.ts", lineStart: 5, claim: "nit 1" }),
      makeFinding({ file: "src/foo.ts", lineStart: 50, claim: "nit 2" }),
    ];
    const result = grade(fixture, posted);
    expect(result.fp).toBe(1); // first within tolerance, second counts
    expect(result.fpDetails[0]?.claim).toBe("nit 2");
  });

  it("collapses cluster members into a single TP", () => {
    const fixture = makeFixture({
      expectedFindings: [
        {
          file: "src/foo.ts",
          lineStart: 10,
          lineEnd: 10,
          kind: "correctness",
          severity: "critical",
          verifier: "typecheck",
          claim: "missing await",
        },
      ],
    });
    const posted = [
      makeFinding({
        file: "src/foo.ts",
        lineStart: 10,
        kind: "correctness",
        claim: "promise not awaited",
      }),
      makeFinding({
        file: "src/foo.ts",
        lineStart: 12,
        kind: "security",
        claim: "race condition risk",
      }),
    ];
    // Both findings share cluster src/foo.ts|7 — they collapse into 1 TP.
    const result = grade(fixture, posted);
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(0);
    expect(result.tpDetails).toHaveLength(1);
  });

  it("returns precision=1 and recall=1 when both expected and posted are empty", () => {
    const fixture = makeFixture();
    const result = grade(fixture, []);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
  });

  it("explicit tolerances.maxComments overrides category default", () => {
    const fixture = makeFixture({
      category: "real-bug", // default maxComments = 0
      tolerances: { maxComments: 2 },
    });
    const posted = [
      makeFinding({ file: "src/a.ts", lineStart: 5, claim: "extra 1" }),
      makeFinding({ file: "src/a.ts", lineStart: 50, claim: "extra 2" }),
      makeFinding({ file: "src/a.ts", lineStart: 500, claim: "extra 3" }),
    ];
    const result = grade(fixture, posted);
    expect(result.fp).toBe(1); // first two within tolerance; third is FP
  });
});

describe("grade — adversarial-robustness", () => {
  it("counts a posted cluster as BOTH TP (correct cluster) and FP (forbidden claim)", () => {
    // A bot that lands on the right cluster but says something the corpus
    // forbids must be flagged. Bot-trained-on-folklore example: "removing
    // --force-with-lease is safer" — right line, wrong diagnosis. Without
    // this rule, a single expected cluster shields any number of
    // hallucinated claims.
    const fixture = makeFixture({
      expectedFindings: [
        {
          file: "src/foo.ts",
          lineStart: 10,
          lineEnd: 10,
          kind: "correctness",
          severity: "warning",
          verifier: "none",
          claim: "expected diagnosis",
        },
      ],
      forbiddenFindings: [{ claimSubstring: "is safer" }],
    });
    const posted = [
      makeFinding({
        file: "src/foo.ts",
        lineStart: 10, // matches expected cluster
        claim: "removing this is safer for the repo",
      }),
    ];
    const result = grade(fixture, posted);
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(1);
    expect(result.fn).toBe(0);
    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(1);
    expect(result.fpDetails[0]?.matchedPattern).toContain('"is safer"');
  });
});
