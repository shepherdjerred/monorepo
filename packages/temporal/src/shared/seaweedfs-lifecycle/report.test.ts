import { describe, expect, test } from "vitest";
import { deletesAllowedFor, ruleReport, summarizeRun } from "./report.ts";
import {
  emptyAccumulator,
  type BucketReport,
  type LifecyclePolicyView,
} from "./types.ts";

const NOW = Date.UTC(2026, 10, 26);
const DAY = 86_400_000;

const policy = (
  overrides: Partial<LifecyclePolicyView> = {},
): LifecyclePolicyView => ({
  mode: "delete",
  maxDeletes: 100,
  buckets: "*",
  provenance: { mode: "flag", maxDeletes: "default", buckets: "default" },
  ...overrides,
});

describe("deletesAllowedFor", () => {
  test("report mode never allows deletes", () => {
    expect(deletesAllowedFor(policy({ mode: "report" }), "b", false)).toBe(
      false,
    );
  });

  test("dryRun overrides a delete mode", () => {
    expect(deletesAllowedFor(policy(), "b", true)).toBe(false);
    expect(deletesAllowedFor(policy(), "b", false)).toBe(true);
  });

  test("* allows every bucket and a list allows only its members", () => {
    expect(deletesAllowedFor(policy({ buckets: "*" }), "any", false)).toBe(
      true,
    );
    const listed = policy({ buckets: ["ci-handoff", "cook"] });
    expect(deletesAllowedFor(listed, "ci-handoff", false)).toBe(true);
    expect(deletesAllowedFor(listed, "sjer-red", false)).toBe(false);
    expect(deletesAllowedFor(listed, "ci-handoff-2", false)).toBe(false);
  });
});

describe("ruleReport", () => {
  test("turns candidate timestamps into oldest and newest ages in days", () => {
    const report = ruleReport({
      rule: { id: "r", prefix: "p/", days: 30 },
      accumulator: {
        ...emptyAccumulator(),
        candidates: 2,
        candidateBytes: 5,
        oldestModifiedMs: NOW - 42 * DAY,
        newestModifiedMs: NOW - 31.04 * DAY,
      },
      mode: "report",
      status: "complete",
      nowMs: NOW,
    });
    expect(report).toMatchObject({
      ruleId: "r",
      prefix: "p/",
      days: 30,
      oldestCandidateAgeDays: 42,
      newestCandidateAgeDays: 31,
    });
  });

  test("has no ages without candidates", () => {
    expect(
      ruleReport({
        rule: { id: "r", prefix: "", days: 1 },
        accumulator: emptyAccumulator(),
        mode: "report",
        status: "complete",
        nowMs: NOW,
      }),
    ).toMatchObject({
      oldestCandidateAgeDays: null,
      newestCandidateAgeDays: null,
    });
  });
});

describe("summarizeRun", () => {
  test("totals candidates, bytes, deletes, unsupported rules and failed buckets", () => {
    const rule = (candidates: number, deleted: number) =>
      ruleReport({
        rule: { id: "r", prefix: "", days: 1 },
        accumulator: {
          ...emptyAccumulator(),
          candidates,
          candidateBytes: candidates * 10,
          deleted,
          deletedBytes: deleted * 10,
        },
        mode: "delete",
        status: "complete",
        nowMs: NOW,
      });
    const buckets: BucketReport[] = [
      {
        bucket: "a",
        deletesAllowed: true,
        rules: [rule(3, 3), rule(2, 1)],
        unsupported: [{ id: "t", reason: "tags" }],
        disabledRules: 0,
      },
      {
        bucket: "b",
        deletesAllowed: false,
        rules: [],
        unsupported: [],
        disabledRules: 0,
        error: "boom",
      },
    ];
    expect(
      summarizeRun({
        startedAt: new Date(NOW),
        policy: policy(),
        dryRun: false,
        buckets,
        withoutLifecycle: ["c"],
      }),
    ).toMatchObject({
      startedAt: "2026-11-26T00:00:00.000Z",
      configuredMode: "delete",
      withoutLifecycle: ["c"],
      totals: {
        candidates: 5,
        candidateBytes: 50,
        deleted: 4,
        deletedBytes: 40,
        unsupportedRules: 1,
        failedBuckets: 1,
      },
    });
  });
});
