import { describe, expect, test } from "bun:test";
import {
  classifyChecks,
  classifyReviewThreads,
  computeDodMet,
  isGreptileAuthor,
  isSoftFailureContext,
  parseReviewSeverity,
  severityBlocks,
  type NormalizedCheck,
  type NormalizedReviewThread,
} from "./dod.ts";
import type { ConflictVerdict } from "./types.ts";

describe("isSoftFailureContext", () => {
  test("matches soft Buildkite contexts", () => {
    expect(isSoftFailureContext("buildkite/monorepo/pr/scissors-knip")).toBe(
      true,
    );
    expect(
      isSoftFailureContext("buildkite/monorepo/pr/shield-trivy-scan"),
    ).toBe(true);
    expect(isSoftFailureContext("semgrep")).toBe(true);
  });
  test("does not match hard contexts", () => {
    expect(
      isSoftFailureContext(
        "buildkite/monorepo/pr/white-check-mark-ci-complete",
      ),
    ).toBe(false);
    expect(
      isSoftFailureContext("buildkite/monorepo/pr/mag-greptile-review"),
    ).toBe(false);
  });
});

const checks = (xs: [string, string][]): NormalizedCheck[] =>
  xs.map(([name, bucket]) => ({ name, bucket }));

describe("classifyChecks", () => {
  test("all pass → green", () => {
    const v = classifyChecks(
      checks([
        ["pr", "pass"],
        ["smoke", "pass"],
      ]),
    );
    expect(v.green).toBe(true);
    expect(v.failing).toEqual([]);
    expect(v.pending).toEqual([]);
    expect(v.noChecksReported).toBe(false);
  });

  test("hard failure → not green, listed in failing", () => {
    const v = classifyChecks(
      checks([
        ["pr", "fail"],
        ["smoke", "pass"],
      ]),
    );
    expect(v.green).toBe(false);
    expect(v.failing).toEqual(["pr"]);
  });

  test("soft failure ignored → still green", () => {
    const v = classifyChecks(
      checks([
        ["pr", "pass"],
        ["scissors-knip", "fail"],
      ]),
    );
    expect(v.green).toBe(true);
    expect(v.ignoredSoft).toEqual(["scissors-knip"]);
    expect(v.failing).toEqual([]);
  });

  test("pending → not green", () => {
    const v = classifyChecks(checks([["pr", "pending"]]));
    expect(v.green).toBe(false);
    expect(v.pending).toEqual(["pr"]);
  });

  test("cancel counts as failing", () => {
    const v = classifyChecks(checks([["pr", "cancel"]]));
    expect(v.green).toBe(false);
    expect(v.failing).toEqual(["pr"]);
  });

  test("skipping is treated as pass", () => {
    const v = classifyChecks(
      checks([
        ["pr", "pass"],
        ["optional", "skipping"],
      ]),
    );
    expect(v.green).toBe(true);
  });

  test("empty checks → not green (none reported yet)", () => {
    const v = classifyChecks([]);
    expect(v.green).toBe(false);
    expect(v.noChecksReported).toBe(true);
    expect(v.failing).toEqual([]);
    expect(v.pending).toEqual([]);
  });

  test("required context present + passing → green", () => {
    const v = classifyChecks(checks([["ci-complete", "pass"]]), [
      "ci-complete",
    ]);
    expect(v.green).toBe(true);
    expect(v.missingRequired).toEqual([]);
  });

  test("required context not yet registered → not green (partial checks)", () => {
    // A fast check passed, but the required build-completion check has not
    // registered yet — must NOT read green.
    const v = classifyChecks(checks([["fast", "pass"]]), ["ci-complete"]);
    expect(v.green).toBe(false);
    expect(v.missingRequired).toEqual(["ci-complete"]);
  });

  test("required context pending → not green", () => {
    const v = classifyChecks(checks([["ci-complete", "pending"]]), [
      "ci-complete",
    ]);
    expect(v.green).toBe(false);
    expect(v.missingRequired).toEqual(["ci-complete"]);
  });
});

describe("parseReviewSeverity", () => {
  test("parses each P-level", () => {
    expect(parseReviewSeverity("P0 critical")).toBe("P0");
    expect(parseReviewSeverity("this is a P3 nit")).toBe("P3");
  });
  test("returns the most severe when multiple appear", () => {
    expect(parseReviewSeverity("was P3, now escalated to P1")).toBe("P1");
  });
  test("undefined when no severity token", () => {
    expect(parseReviewSeverity("just a comment")).toBeUndefined();
    expect(parseReviewSeverity(null)).toBeUndefined();
    expect(parseReviewSeverity("P5 is not a level")).toBeUndefined();
  });
});

describe("severityBlocks", () => {
  test("P1 blocks at P3 threshold", () => {
    expect(severityBlocks("P1", "P3")).toBe(true);
  });
  test("P3 blocks at P3 threshold", () => {
    expect(severityBlocks("P3", "P3")).toBe(true);
  });
  test("nothing below P3 since P3 is the lowest", () => {
    expect(severityBlocks("P3", "P2")).toBe(false);
  });
});

describe("isGreptileAuthor", () => {
  test("matches greptile bot logins", () => {
    expect(isGreptileAuthor("greptile-apps[bot]")).toBe(true);
    expect(isGreptileAuthor("Greptile")).toBe(true);
  });
  test("does not match others", () => {
    expect(isGreptileAuthor("shepherdjerred")).toBe(false);
    expect(isGreptileAuthor(null)).toBe(false);
  });
});

const thread = (
  over: Partial<NormalizedReviewThread>,
): NormalizedReviewThread => ({
  id: "T1",
  isResolved: false,
  author: "greptile-apps[bot]",
  body: "P2 fix this",
  ...over,
});

describe("classifyReviewThreads", () => {
  test("resolved threads are ignored", () => {
    const v = classifyReviewThreads([thread({ isResolved: true })], "P3");
    expect(v.allResolved).toBe(true);
    expect(v.blocking).toEqual([]);
  });

  test("unresolved P2 blocks at P3 threshold", () => {
    const v = classifyReviewThreads(
      [thread({ id: "T2", body: "P2 bug" })],
      "P3",
    );
    expect(v.allResolved).toBe(false);
    expect(v.blocking).toHaveLength(1);
    expect(v.blocking[0]?.severity).toBe("P2");
    expect(v.blocking[0]?.isGreptile).toBe(true);
  });

  test("unresolved thread without severity is advisory, not blocking", () => {
    const v = classifyReviewThreads(
      [thread({ id: "T3", body: "what about this?", author: "someone" })],
      "P3",
    );
    expect(v.allResolved).toBe(true);
    expect(v.blocking).toEqual([]);
    expect(v.advisory).toHaveLength(1);
  });
});

describe("computeDodMet", () => {
  const clean: ConflictVerdict = { clean: true, paths: [], baseRef: "main" };
  test("met when green, clean, resolved, open", () => {
    expect(
      computeDodMet(
        {
          green: true,
          failing: [],
          pending: [],
          ignoredSoft: [],
          noChecksReported: false,
          missingRequired: [],
        },
        clean,
        { allResolved: true, blocking: [], advisory: [] },
        "open",
      ),
    ).toBe(true);
  });
  test("not met if CI not green", () => {
    expect(
      computeDodMet(
        {
          green: false,
          failing: ["pr"],
          pending: [],
          ignoredSoft: [],
          noChecksReported: false,
          missingRequired: [],
        },
        clean,
        { allResolved: true, blocking: [], advisory: [] },
        "open",
      ),
    ).toBe(false);
  });
  test("not met if PR not open", () => {
    expect(
      computeDodMet(
        {
          green: true,
          failing: [],
          pending: [],
          ignoredSoft: [],
          noChecksReported: false,
          missingRequired: [],
        },
        clean,
        { allResolved: true, blocking: [], advisory: [] },
        "merged",
      ),
    ).toBe(false);
  });
});
