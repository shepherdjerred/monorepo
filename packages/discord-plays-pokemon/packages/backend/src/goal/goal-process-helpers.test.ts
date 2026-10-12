import { describe, expect, it } from "vitest";
import { settleGoalProcess } from "./goal-process-helpers.ts";
import type { GoalProcess } from "./goal-types.ts";

function fakeProcess(exitOn: readonly (NodeJS.Signals | number)[]): {
  process: GoalProcess;
  signals: (NodeJS.Signals | number | undefined)[];
} {
  const signals: (NodeJS.Signals | number | undefined)[] = [];
  const exit = Promise.withResolvers<number>();
  return {
    signals,
    process: {
      stdout: null,
      stderr: null,
      exited: exit.promise,
      kill(signal) {
        signals.push(signal);
        if (signal !== undefined && exitOn.includes(signal)) {
          exit.resolve(signal === "SIGKILL" ? 137 : 143);
        }
      },
    },
  };
}

describe("settleGoalProcess", () => {
  it("returns once the process exits on SIGTERM", async () => {
    const { process, signals } = fakeProcess(["SIGTERM"]);
    let settled = false;

    const exitCode = await settleGoalProcess(
      { process, stdoutPump: Promise.resolve() },
      true,
      () => {
        settled = true;
        return Promise.resolve();
      },
      50,
    );

    expect(exitCode).toBe(143);
    expect(signals).toEqual(["SIGTERM"]);
    expect(settled).toBe(true);
  });

  it("escalates to SIGKILL when SIGTERM is ignored", async () => {
    const { process, signals } = fakeProcess(["SIGKILL"]);

    const exitCode = await settleGoalProcess(
      { process, stdoutPump: Promise.resolve() },
      true,
      undefined,
      20,
    );

    expect(exitCode).toBe(137);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("fails instead of hanging when the process never exits", async () => {
    const { process } = fakeProcess([]);
    let settled = false;

    await expect(
      settleGoalProcess(
        { process, stdoutPump: Promise.resolve() },
        true,
        () => {
          settled = true;
          return Promise.resolve();
        },
        20,
      ),
    ).rejects.toThrow(/did not exit/);
    expect(settled).toBe(true);
  });
});
