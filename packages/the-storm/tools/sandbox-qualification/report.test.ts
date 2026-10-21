import { describe, expect, it } from "vitest";
import {
  QualificationReportSchema,
  type QualificationReport,
} from "./report.ts";

const suite = {
  name: "e2e",
  command: "bun run test:e2e",
  target: { host: "storm-e2e.mc-sandbox.svc", gamePort: 25_565 },
  outcome: "failed",
  exitCode: 1,
  startedAt: "2026-10-21T12:00:00.000Z",
  finishedAt: "2026-10-21T12:20:00.000Z",
  durationMs: 1_200_000,
  tests: { total: 4, passed: 2, failed: 1, skipped: 1, todo: 0 },
  failures: [
    {
      file: "tests/e2e/rwf.e2e.test.ts",
      test: "rwf > records the match",
      messages: ["AssertionError: expected 0 to be 1"],
      durationMs: 4500,
    },
  ],
  skipped: [
    { file: "tests/e2e/enforcement.e2e.test.ts", test: "active enforcement" },
  ],
  error: null,
} satisfies QualificationReport["suites"][number];

const report = {
  schemaVersion: 1,
  sourceRevision: "0123456789abcdef0123456789abcdef01234567",
  serverImage: `docker.io/shepherdjerred/the-storm-server@sha256:${"c".repeat(64)}`,
  outcome: "failed",
  startedAt: "2026-10-21T12:00:00.000Z",
  finishedAt: "2026-10-21T12:20:00.000Z",
  durationMs: 1_200_000,
  suites: [suite],
} satisfies QualificationReport;

function issues(value: unknown): string[] {
  const parsed = QualificationReportSchema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message);
}

describe("qualification report schema", () => {
  it("accepts a consistent report", () => {
    expect(issues(report)).toEqual([]);
  });

  it("rejects counts that do not add up or unlisted failures and skips", () => {
    expect(
      issues({
        ...report,
        suites: [
          {
            ...suite,
            tests: { total: 5, passed: 2, failed: 2, skipped: 0, todo: 0 },
          },
        ],
      }),
    ).toEqual([
      "tests.total must equal passed + failed + skipped + todo",
      "every failed test must be listed in failures",
      "every skipped test must be listed in skipped",
    ]);
  });

  it("rejects a pass that hides failures or an outcome that disagrees", () => {
    expect(
      issues({
        ...report,
        outcome: "passed",
        suites: [{ ...suite, outcome: "passed" }],
      }),
    ).toEqual([
      "a passed suite exits 0 with at least one passing test, no failures and no error",
    ]);
    expect(issues({ ...report, outcome: "passed" })).toEqual([
      "the run passes exactly when every suite passed",
    ]);
    expect(
      issues({
        ...report,
        suites: [
          {
            ...suite,
            outcome: "error",
            failures: [],
            tests: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
            skipped: [],
          },
        ],
      }),
    ).toEqual([
      "a suite that did not pass names a failure or an error",
      "an errored suite says why",
    ]);
  });

  it("rejects another image, a short revision, unknown fields and repeated suites", () => {
    expect(
      issues({
        ...report,
        serverImage: `docker.io/itzg/minecraft-server@sha256:${"c".repeat(64)}`,
      }),
    ).toHaveLength(1);
    expect(issues({ ...report, sourceRevision: "0123456" })).toHaveLength(1);
    expect(issues({ ...report, rconPassword: "leaked" })).toHaveLength(1);
    expect(issues({ ...report, suites: [suite, suite] })).toEqual([
      "a suite runs only once",
    ]);
  });
});
