import { describe, expect, it } from "bun:test";
import { evalGradeActivities } from "./grade.ts";
import type { Fixture } from "#shared/pr-review/eval-fixture.ts";
import type { Finding } from "#shared/pr-review/finding.ts";

const fixture: Fixture = {
  id: "test",
  category: "real-bug",
  source: {
    repo: "shepherdjerred/monorepo",
    commitSha: "a".repeat(40),
    parentSha: "b".repeat(40),
  },
  diffPath: "pr.diff",
  snapshotRef: "snapshot/test",
  expectedFindings: [
    {
      file: "src/x.ts",
      lineStart: 10,
      lineEnd: 10,
      kind: "correctness",
      severity: "critical",
      verifier: "test",
      claim: "bug",
    },
  ],
  forbiddenFindings: [],
  notes: "test",
};

const posted: Finding[] = [
  {
    id: "f1",
    file: "src/x.ts",
    lineStart: 11,
    lineEnd: 11,
    kind: "correctness",
    severity: "critical",
    verifier: "test",
    claim: "found the bug",
    evidence: "ev",
    confidence: 0.9,
  },
];

describe("prReviewEvalGrade", () => {
  it("delegates to grade() and returns the result", async () => {
    const result = await evalGradeActivities.prReviewEvalGrade({
      fixture,
      postedFindings: posted,
    });
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(0);
    expect(result.fn).toBe(0);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
  });

  it("handles empty postedFindings (recall=0)", async () => {
    const result = await evalGradeActivities.prReviewEvalGrade({
      fixture,
      postedFindings: [],
    });
    expect(result.tp).toBe(0);
    expect(result.fn).toBe(1);
    expect(result.recall).toBe(0);
  });
});
