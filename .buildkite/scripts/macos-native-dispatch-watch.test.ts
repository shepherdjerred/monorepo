import { describe, expect, test } from "vitest";
import {
  dispatchDecision,
  parseNativeJobs,
  type NativeJob,
} from "./macos-native-dispatch-watch.ts";

function job(
  stepKey: string,
  state: string,
  startedAt: string | null,
): NativeJob {
  return {
    id: `${stepKey}-${state}`,
    name: stepKey,
    state,
    startedAt,
    stepKey,
  };
}

describe("native macOS dispatch watch", () => {
  test("parses only native PR jobs", () => {
    expect(
      parseNativeJobs({
        jobs: [
          {
            id: "quota",
            name: "QuotaBar",
            state: "scheduled",
            started_at: null,
            step_key: "quotabar-macos-pr",
          },
          {
            id: "verify",
            name: "verify",
            state: "passed",
            started_at: "2026-08-24T00:00:00Z",
            step_key: "verify",
          },
        ],
      }),
    ).toEqual([
      {
        id: "quota",
        name: "QuotaBar",
        state: "scheduled",
        startedAt: null,
        stepKey: "quotabar-macos-pr",
      },
    ]);
  });

  test("rejects malformed matching jobs", () => {
    expect(() =>
      parseNativeJobs({
        jobs: [
          {
            id: "quota",
            name: "QuotaBar",
            state: "scheduled",
            started_at: 42,
            step_key: "quotabar-macos-pr",
          },
        ],
      }),
    ).toThrow("quotabar-macos-pr.started_at must be a string");
  });

  test("completes after every selected attempt starts or terminates", () => {
    expect(
      dispatchDecision(
        [
          job("quotabar-macos-pr", "passed", "2026-08-24T00:00:00Z"),
          job("tasknotes-native-pr", "skipped", null),
        ],
        10_000,
        null,
      ),
    ).toEqual({ kind: "complete" });
  });

  test("pauses the idle clock while the serial Mac is running another job", () => {
    expect(
      dispatchDecision(
        [
          job("quotabar-macos-pr", "running", "2026-08-24T00:00:00Z"),
          job("tasknotes-native-pr", "scheduled", null),
        ],
        400_000,
        0,
        300_000,
      ),
    ).toEqual({ kind: "waiting", idleSinceMs: null });
  });

  test("fails after a bounded idle queue wait", () => {
    const jobs = [job("quotabar-macos-pr", "scheduled", null)];
    expect(dispatchDecision(jobs, 100, null, 300_000)).toEqual({
      kind: "waiting",
      idleSinceMs: 100,
    });
    expect(dispatchDecision(jobs, 300_100, 100, 300_000)).toEqual({
      kind: "timed-out",
      pending: jobs,
    });
  });
});
