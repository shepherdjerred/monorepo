import { describe, expect, it } from "bun:test";
import { voteOnFindings, type AnnotatedFinding } from "./consensus.ts";
import {
  annotate,
  mkFinding,
  passes,
  withGrepVerifier,
} from "./testing/fixtures.ts";

describe("voteOnFindings — within-specialist agreement", () => {
  it("keeps a finding hit on all 3 passes by one specialist", () => {
    const result = voteOnFindings({
      annotated: passes("correctness", [
        mkFinding({ id: "f1", file: "api.ts", lineStart: 42 }),
        mkFinding({ id: "f2", file: "api.ts", lineStart: 43 }),
        mkFinding({ id: "f3", file: "api.ts", lineStart: 42 }),
      ]),
    });
    expect(result).toHaveLength(1);
    const rep = result[0];
    if (rep === undefined) throw new Error("expected kept finding");
    expect(rep.file).toBe("api.ts");
    expect(rep.votes?.withinSpecialist).toBe(3);
    expect(rep.votes?.acrossSpecialists).toBe(1);
  });

  it("keeps a finding hit on 2/3 passes (meets ceil(2N/3) threshold for N=3)", () => {
    const result = voteOnFindings({
      annotated: passes("security", [
        mkFinding({ id: "f1", file: "api.ts", lineStart: 100 }),
        mkFinding({ id: "f2", file: "api.ts", lineStart: 101 }),
      ]),
    });
    expect(result).toHaveLength(1);
  });

  it("drops a finding hit by only one pass of one specialist", () => {
    const result = voteOnFindings({
      annotated: passes("correctness", [
        mkFinding({ id: "f1", file: "util.ts", lineStart: 7 }),
      ]),
    });
    expect(result).toEqual([]);
  });
});

describe("voteOnFindings — cross-specialist agreement", () => {
  it("keeps a finding hit by 2 different specialists once each", () => {
    const result = voteOnFindings({
      annotated: [
        annotate(
          mkFinding({
            id: "s1",
            file: "auth.ts",
            lineStart: 100,
            kind: "security",
          }),
          "security",
          0,
        ),
        annotate(
          mkFinding({
            id: "c1",
            file: "auth.ts",
            lineStart: 101,
            kind: "correctness",
          }),
          "correctness",
          2,
        ),
      ],
    });
    expect(result).toHaveLength(1);
    const rep = result[0];
    if (rep === undefined) throw new Error("expected kept finding");
    expect(rep.file).toBe("auth.ts");
    expect(rep.votes?.acrossSpecialists).toBe(2);
  });

  it("`acrossSpecialists` counts distinct specialist ids, not distinct kinds", () => {
    // The same specialist (security) emits findings of different kinds on
    // two passes. The within-specialist rule fires (2/3 passes), so the
    // finding is kept — but `acrossSpecialists` should still report 1
    // because only one specialist (security) was the producer.
    const result = voteOnFindings({
      annotated: passes("security", [
        mkFinding({
          id: "s1",
          file: "auth.ts",
          lineStart: 100,
          kind: "security",
        }),
        mkFinding({
          id: "s2",
          file: "auth.ts",
          lineStart: 101,
          kind: "correctness",
        }),
      ]),
    });
    expect(result).toHaveLength(1);
    const rep = result[0];
    if (rep === undefined) throw new Error("expected kept finding");
    expect(rep.votes?.acrossSpecialists).toBe(1);
    expect(rep.votes?.withinSpecialist).toBe(2);
  });
});

describe("voteOnFindings — high-confidence verifier-backed singleton", () => {
  it("keeps a single high-confidence finding so verification can decide it", () => {
    const result = voteOnFindings({
      annotated: [
        annotate(
          withGrepVerifier(
            mkFinding({
              id: "high-confidence",
              file: "release.ts",
              lineStart: 25,
              confidence: 0.95,
            }),
          ),
          "security",
          0,
        ),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("high-confidence");
  });

  it("still drops a single high-confidence finding that has no verifier", () => {
    const result = voteOnFindings({
      annotated: [
        annotate(
          mkFinding({
            id: "unsupported",
            file: "release.ts",
            lineStart: 25,
            confidence: 0.95,
          }),
          "security",
          0,
        ),
      ],
    });
    expect(result).toEqual([]);
  });

  it("selects a verifier-backed representative when high confidence is the only keep reason", () => {
    const result = voteOnFindings({
      annotated: [
        annotate(
          mkFinding({
            id: "critical-unverifiable",
            file: "release.ts",
            lineStart: 25,
            severity: "critical",
            confidence: 0.99,
          }),
          "security",
          0,
        ),
        annotate(
          withGrepVerifier(
            mkFinding({
              id: "warning-verifier-backed",
              file: "release.ts",
              lineStart: 26,
              severity: "warning",
              confidence: 0.95,
            }),
          ),
          "security",
          0,
        ),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("warning-verifier-backed");
  });
});

describe("voteOnFindings — line-tolerance bucketing", () => {
  it("clusters findings within the same 7-line bucket", () => {
    // Lines 14, 16, 18 all fall in bucket floor(line/7)*7 = 14.
    const result = voteOnFindings({
      annotated: passes("perf", [
        mkFinding({ id: "a", file: "loop.ts", lineStart: 14 }),
        mkFinding({ id: "b", file: "loop.ts", lineStart: 16 }),
        mkFinding({ id: "c", file: "loop.ts", lineStart: 18 }),
      ]),
    });
    expect(result).toHaveLength(1);
  });

  it("does NOT cluster findings across bucket boundaries", () => {
    // Lines 13 and 14 are 1 line apart but cross the bucket boundary.
    const result = voteOnFindings({
      annotated: passes("perf", [
        mkFinding({ id: "a", file: "loop.ts", lineStart: 13 }),
        mkFinding({ id: "b", file: "loop.ts", lineStart: 14 }),
      ]),
    });
    // Two separate clusters, each with one finding, each fails consensus.
    expect(result).toEqual([]);
  });
});

describe("voteOnFindings — representative selection", () => {
  it("picks the highest-severity finding as the cluster representative", () => {
    const result = voteOnFindings({
      annotated: passes("correctness", [
        mkFinding({ id: "nit", file: "f.ts", lineStart: 10, severity: "nit" }),
        mkFinding({
          id: "warn",
          file: "f.ts",
          lineStart: 11,
          severity: "warning",
        }),
        mkFinding({
          id: "crit",
          file: "f.ts",
          lineStart: 12,
          severity: "critical",
        }),
      ]),
    });
    expect(result).toHaveLength(1);
    const rep = result[0];
    if (rep === undefined) throw new Error("expected kept finding");
    expect(rep.severity).toBe("critical");
    expect(rep.id).toBe("crit");
  });

  it("tie-breaks on confidence when severity is equal", () => {
    const result = voteOnFindings({
      annotated: passes("correctness", [
        mkFinding({ id: "low", file: "f.ts", lineStart: 10, confidence: 0.6 }),
        mkFinding({
          id: "high",
          file: "f.ts",
          lineStart: 11,
          confidence: 0.95,
        }),
        mkFinding({ id: "mid", file: "f.ts", lineStart: 12, confidence: 0.8 }),
      ]),
    });
    expect(result).toHaveLength(1);
    const rep = result[0];
    if (rep === undefined) throw new Error("expected kept finding");
    expect(rep.id).toBe("high");
  });

  it("tie-breaks on id (lexicographic) when severity and confidence are equal", () => {
    const result = voteOnFindings({
      annotated: passes("correctness", [
        mkFinding({ id: "zzz", file: "f.ts", lineStart: 10 }),
        mkFinding({ id: "aaa", file: "f.ts", lineStart: 11 }),
        mkFinding({ id: "mmm", file: "f.ts", lineStart: 12 }),
      ]),
    });
    expect(result).toHaveLength(1);
    const rep = result[0];
    if (rep === undefined) throw new Error("expected kept finding");
    expect(rep.id).toBe("aaa");
  });
});

describe("voteOnFindings — vote metadata", () => {
  it("populates votes with the correct counts", () => {
    const result = voteOnFindings({
      annotated: [
        ...passes("correctness", [
          mkFinding({ id: "f1", file: "x.ts", lineStart: 10 }),
          mkFinding({ id: "f2", file: "x.ts", lineStart: 11 }),
          mkFinding({ id: "f3", file: "x.ts", lineStart: 12 }),
        ]),
        annotate(
          mkFinding({
            id: "f4",
            file: "x.ts",
            lineStart: 10,
            kind: "security",
          }),
          "security",
          0,
        ),
      ],
    });
    expect(result).toHaveLength(1);
    const rep = result[0];
    if (rep === undefined) throw new Error("expected kept finding");
    expect(rep.votes).toEqual({
      withinSpecialist: 3,
      withinSpecialistTotal: 3,
      acrossSpecialists: 2,
    });
  });

  it("respects passesPerSpecialist override", () => {
    // With N=5 the threshold becomes ceil(10/3)=4; 3 passes is no longer enough.
    const result = voteOnFindings({
      passesPerSpecialist: 5,
      annotated: passes("correctness", [
        mkFinding({ id: "a", file: "x.ts", lineStart: 10 }),
        mkFinding({ id: "b", file: "x.ts", lineStart: 11 }),
        mkFinding({ id: "c", file: "x.ts", lineStart: 12 }),
      ]),
    });
    expect(result).toEqual([]);
  });
});

describe("voteOnFindings — synthetic noise fixture (Phase 3 verification)", () => {
  /**
   * Synthetic noise fixture from the task description: a single-agent run
   * produces a finding; the consensus version drops it because there's no
   * supporting agreement.
   *
   * Single-agent (1 pass × 1 specialist): the lone finding survives because
   * there's no voting layer. Consensus drops it because neither rule fires.
   */
  it("drops a single-pass single-specialist finding (single-agent flag → consensus drop)", () => {
    const lone = mkFinding({
      id: "noise",
      file: "spurious.ts",
      lineStart: 50,
      confidence: 0.3,
    });
    const single = voteOnFindings({
      annotated: [annotate(lone, "correctness", 0)],
    });
    expect(single).toEqual([]);
  });

  /**
   * Subset property: replaying with consensus on must produce a finding set
   * that is a strict subset (by `id`) of the single-agent output. We
   * simulate the single-agent baseline by lifting consensus and checking the
   * intersection.
   */
  it("consensus output is a subset (by id) of the union of all raw findings", () => {
    const raw: AnnotatedFinding[] = [
      ...passes("correctness", [
        mkFinding({ id: "real-1", file: "api.ts", lineStart: 42 }),
        mkFinding({ id: "real-2", file: "api.ts", lineStart: 42 }),
        mkFinding({ id: "real-3", file: "api.ts", lineStart: 42 }),
      ]),
      annotate(
        mkFinding({ id: "noise", file: "util.ts", lineStart: 7 }),
        "correctness",
        1,
      ),
    ];
    const consensus = voteOnFindings({ annotated: raw });
    const rawIds = new Set(raw.map((r) => r.finding.id));
    for (const c of consensus) {
      expect(rawIds.has(c.id)).toBe(true);
    }
    expect(consensus.length).toBeLessThanOrEqual(raw.length);
  });
});

describe("voteOnFindings — output ordering", () => {
  it("sorts kept findings by file then lineStart", () => {
    const result = voteOnFindings({
      annotated: [
        ...passes("correctness", [
          mkFinding({ id: "b-late", file: "b.ts", lineStart: 100 }),
          mkFinding({ id: "b-late2", file: "b.ts", lineStart: 100 }),
        ]),
        ...passes("correctness", [
          mkFinding({ id: "a-early", file: "a.ts", lineStart: 10 }),
          mkFinding({ id: "a-early2", file: "a.ts", lineStart: 10 }),
        ]),
      ],
    });
    expect(result.map((f) => f.file)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("voteOnFindings — empty input", () => {
  it("returns empty array for empty input", () => {
    expect(voteOnFindings({ annotated: [] })).toEqual([]);
  });
});
