import { describe, expect, test } from "vitest";
import {
  dispatchDecision,
  parseNativeJobs,
  parseOtherRunningNativeJobs,
  type NativeJob,
} from "./macos-native-dispatch-watch.ts";

function job(
  stepKey: string,
  state: string,
  startedAt: string | null,
  retried = false,
): NativeJob {
  return {
    id: `${stepKey}-${state}`,
    name: stepKey,
    retried,
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
            retried: false,
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
        retried: false,
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
            retried: false,
            state: "scheduled",
            started_at: 42,
            step_key: "quotabar-macos-pr",
          },
        ],
      }),
    ).toThrow("quotabar-macos-pr.started_at must be a string");
  });

  test("completes only after every selected current attempt succeeds", () => {
    expect(
      dispatchDecision(
        [
          job("quotabar-macos-pr", "passed", "2026-08-24T00:00:00Z"),
          job("tasknotes-native-pr", "skipped", null),
        ],
        { idleSinceMs: null, nowMs: 10_000 },
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
        { idleSinceMs: 0, maxIdleMs: 300_000, nowMs: 400_000 },
      ),
    ).toEqual({ kind: "waiting", idleSinceMs: null });
  });

  test("pauses while another build owns the native concurrency slot", () => {
    expect(
      dispatchDecision([job("quotabar-macos-pr", "limited", null)], {
        idleSinceMs: 0,
        maxIdleMs: 300_000,
        nowMs: 400_000,
        otherBuildRunning: true,
      }),
    ).toEqual({ kind: "waiting", idleSinceMs: null });
  });

  test("fails after a bounded idle queue wait", () => {
    const jobs = [job("quotabar-macos-pr", "scheduled", null)];
    expect(
      dispatchDecision(jobs, {
        idleSinceMs: null,
        maxIdleMs: 300_000,
        nowMs: 100,
      }),
    ).toEqual({
      kind: "waiting",
      idleSinceMs: 100,
    });
    expect(
      dispatchDecision(jobs, {
        idleSinceMs: 100,
        maxIdleMs: 300_000,
        nowMs: 300_100,
      }),
    ).toEqual({
      kind: "timed-out",
      pending: jobs,
    });
  });

  test("does not trust an assignment that the agent never accepted", () => {
    const jobs = [job("quotabar-macos-pr", "assigned", null)];
    expect(
      dispatchDecision(jobs, {
        idleSinceMs: 0,
        maxIdleMs: 300_000,
        nowMs: 300_000,
      }),
    ).toEqual({
      kind: "timed-out",
      pending: jobs,
    });
  });

  test("keeps watching the current automatic retry", () => {
    const previous = job(
      "quotabar-macos-pr",
      "failed",
      "2026-08-24T00:00:00Z",
      true,
    );
    const retry = job("quotabar-macos-pr", "scheduled", null);
    expect(
      dispatchDecision([previous, retry], {
        idleSinceMs: 0,
        maxIdleMs: 300_000,
        nowMs: 300_000,
      }),
    ).toEqual({
      kind: "timed-out",
      pending: [retry],
    });
  });

  test("keeps watching while Buildkite creates the automatic retry", () => {
    const previous = job(
      "quotabar-macos-pr",
      "failed",
      "2026-08-24T00:00:00Z",
      true,
    );
    expect(
      dispatchDecision([previous], {
        idleSinceMs: null,
        maxIdleMs: 300_000,
        nowMs: 100,
      }),
    ).toEqual({
      kind: "waiting",
      idleSinceMs: 100,
    });
  });

  test("finds native work running in another build", () => {
    expect(
      parseOtherRunningNativeJobs(
        [
          {
            number: 100,
            jobs: [
              {
                name: "TaskNotes main",
                state: "running",
                step_key: "tasknotes-native-main",
              },
              {
                name: "verify",
                state: "running",
                step_key: "verify",
              },
            ],
          },
          {
            number: 101,
            jobs: [
              {
                name: "QuotaBar current",
                state: "running",
                step_key: "quotabar-macos-pr",
              },
            ],
          },
        ],
        101,
      ),
    ).toEqual([
      {
        buildNumber: 100,
        name: "TaskNotes main",
        stepKey: "tasknotes-native-main",
      },
    ]);
  });
});
