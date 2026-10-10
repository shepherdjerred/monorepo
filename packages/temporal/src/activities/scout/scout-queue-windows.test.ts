import { describe, expect, test } from "vitest";
import { nextWarningState } from "./scout-queue-windows.ts";
import { queueWarningFinding } from "./scout-queue-windows-report.ts";

const FINGERPRINT = "a".repeat(64);

describe("queue warning identity", () => {
  test("keeps observation counts and ages outside the identity", () => {
    const first = queueWarningFinding({
      kind: "window-too-young",
      queue: "urf",
      message: "Window is 1 day old with 100 matches",
      total: 100,
    });
    const next = queueWarningFinding({
      kind: "window-too-young",
      queue: "urf",
      message: "Window is 2 days old with 250 matches",
      total: 250,
    });
    expect(first.id).toBe(next.id);
    expect(first.summary).not.toBe(next.summary);
    expect(
      queueWarningFinding({
        kind: "window-too-young",
        queue: "arena",
        message: "Young",
      }).id,
    ).not.toBe(first.id);
    expect(
      queueWarningFinding({
        kind: "sparse-no-close",
        queue: "urf",
        message: "Sparse",
      }).id,
    ).not.toBe(first.id);
  });

  test("requires known warning identities and preserves unknown warning text", () => {
    expect(() =>
      queueWarningFinding({ kind: "no-volume-baseline", message: "Missing" }),
    ).toThrow("has no queue identity");
    expect(
      queueWarningFinding({ kind: "new-kind", message: "New failure" }),
    ).toEqual({
      summary: "new-kind: New failure",
    });
  });
});

describe("Scout queue warning state", () => {
  test("does not count an activity retry as another consecutive run", () => {
    const firstAttempt = nextWarningState(undefined, FINGERPRINT, "run-1");
    const retry = nextWarningState(firstAttempt, FINGERPRINT, "run-1");

    expect(retry).toEqual(firstAttempt);
  });

  test("increments the count for a later workflow run with the same warning", () => {
    const prior = nextWarningState(undefined, FINGERPRINT, "run-1");
    const nextRun = nextWarningState(prior, FINGERPRINT, "run-2");

    expect(nextRun.consecutiveRuns).toBe(2);
    expect(nextRun.lastWorkflowRunId).toBe("run-2");
  });

  test("resets the count when warnings clear or change", () => {
    const prior = nextWarningState(undefined, FINGERPRINT, "run-1");
    const cleared = nextWarningState(prior, undefined, "run-2");
    const changed = nextWarningState(cleared, "b".repeat(64), "run-3");

    expect(cleared).toMatchObject({ fingerprint: null, consecutiveRuns: 0 });
    expect(changed.consecutiveRuns).toBe(1);
  });

  test("increments legacy state once before recording its workflow run", () => {
    const migrated = nextWarningState(
      {
        schemaVersion: 1,
        fingerprint: FINGERPRINT,
        consecutiveRuns: 3,
      },
      FINGERPRINT,
      "run-4",
    );

    expect(migrated).toMatchObject({
      consecutiveRuns: 4,
      lastWorkflowRunId: "run-4",
    });
  });
});
