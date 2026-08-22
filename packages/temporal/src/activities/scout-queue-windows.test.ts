import { describe, expect, test } from "vitest";
import { nextWarningState } from "./scout-queue-windows.ts";

const FINGERPRINT = "a".repeat(64);

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
