import { describe, expect, it } from "bun:test";
import {
  FindingSchema,
  FindingArraySchema,
  FindingSeveritySchema,
  FindingKindSchema,
  FindingVerifierSchema,
  type Finding,
} from "./finding.ts";

const VALID_FINDING: Finding = {
  id: "f1",
  file: "packages/temporal/src/worker.ts",
  lineStart: 42,
  lineEnd: 44,
  kind: "correctness",
  severity: "warning",
  verifier: "typecheck",
  claim: "missing await on async call",
  evidence: "fooBar() returns Promise<void> but is not awaited at line 42",
  confidence: 0.9,
};

describe("foundation: FindingSchema", () => {
  it("accepts a complete finding without votes", () => {
    const parsed = FindingSchema.parse(VALID_FINDING);
    expect(parsed.id).toBe("f1");
    expect(parsed.votes).toBeUndefined();
  });

  it("accepts a finding with consensus votes attached", () => {
    const parsed = FindingSchema.parse({
      ...VALID_FINDING,
      votes: {
        withinSpecialist: 3,
        withinSpecialistTotal: 3,
        acrossSpecialists: 2,
      },
    });
    expect(parsed.votes?.withinSpecialist).toBe(3);
    expect(parsed.votes?.acrossSpecialists).toBe(2);
  });

  it("rejects findings with non-positive line numbers", () => {
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, lineStart: 0 }),
    ).toThrow();
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, lineEnd: -1 }),
    ).toThrow();
  });

  it("rejects findings with confidence outside 0..1", () => {
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, confidence: 1.5 }),
    ).toThrow();
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, confidence: -0.1 }),
    ).toThrow();
  });

  it("rejects findings with unknown kind/severity/verifier values", () => {
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, kind: "bogus" }),
    ).toThrow();
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, severity: "high" }),
    ).toThrow();
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, verifier: "smoke" }),
    ).toThrow();
  });

  it("rejects findings with empty file / claim / evidence", () => {
    expect(() => FindingSchema.parse({ ...VALID_FINDING, file: "" })).toThrow();
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, claim: "" }),
    ).toThrow();
    expect(() =>
      FindingSchema.parse({ ...VALID_FINDING, evidence: "" }),
    ).toThrow();
  });

  it("parses an array of findings", () => {
    const parsed = FindingArraySchema.parse([VALID_FINDING, VALID_FINDING]);
    expect(parsed.length).toBe(2);
  });

  it("enum schemas cover all expected values", () => {
    expect(FindingSeveritySchema.options).toEqual([
      "critical",
      "warning",
      "nit",
    ]);
    expect(FindingKindSchema.options).toEqual([
      "correctness",
      "security",
      "performance",
      "convention",
      "deps",
    ]);
    expect(FindingVerifierSchema.options).toEqual([
      "typecheck",
      "eslint",
      "grep",
      "test",
      "none",
    ]);
  });
});
