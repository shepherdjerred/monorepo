import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { AcceptanceDeadline, boundedCommand } from "./bounded-command.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
test("a timer retires the owned child once and awaits its signal acknowledgement", async () => {
  const configured = await options();
  vi.useFakeTimers();
  let started!: () => void;
  const spawned = new Promise<void>((resolve) => {
    started = resolve;
  });
  let exit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    exit = resolve;
  });
  const signals: string[] = [];
  const pending = boundedCommand(["injected-owned-child"], configured, {
    clock: () => ({ wallMS: 0, monotonicMS: 0 }),
    spawn: () => {
      started();
      return {
        pid: 123,
        exited,
        unref() {},
        kill(signal) {
          signals.push(signal);
          exit(143);
        },
      };
    },
  });
  const rejected = expect(pending).rejects.toThrow("timed out");
  await spawned;
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(signals).toEqual(["SIGKILL"]);
});
test("an unacknowledged child retains deadline and cleanup failures within the bounded cleanup allowance", async () => {
  const configured = await options();
  vi.useFakeTimers();
  let started!: () => void;
  const spawned = new Promise<void>((resolve) => {
    started = resolve;
  });
  let unreferenced = false;
  const pending = boundedCommand(["injected-owned-child"], configured, {
    clock: () => ({ wallMS: 0, monotonicMS: 0 }),
    spawn: () => {
      started();
      return {
        pid: 123,
        exited: new Promise<number>(() => {}),
        unref() {
          unreferenced = true;
        },
        kill() {
          throw new Error("injected retirement failure");
        },
      };
    },
  });
  const retained = pending.catch((error) => error);
  await spawned;
  await vi.advanceTimersByTimeAsync(2_100);
  const failure: unknown = await retained;
  expect(failure).toBeInstanceOf(AggregateError);
  expect(String(failure)).toContain("exit deadline exceeded");
  expect(String(failure)).toContain("injected retirement failure");
  expect(unreferenced).toBe(true);
});
async function options() {
  const logs = await mkdtemp(join(tmpdir(), "facet-android-deadline-"));
  directories.push(logs);
  return { cwd: logs, logs, timeoutMS: 100 };
}
test.each([
  { name: "late timer delivery", wallMS: 1_000, monotonicMS: 1_000 },
  { name: "suspended monotonic clock", wallMS: 1_000, monotonicMS: 50 },
  { name: "wall clock rollback", wallMS: -1_000, monotonicMS: 1_000 },
])(
  "rejects an overdue zero exit with $name without signalling an exited child",
  async ({ wallMS, monotonicMS }) => {
    let completed = false;
    const signals: string[] = [];
    await expect(
      boundedCommand(["injected-owned-child"], await options(), {
        clock: () =>
          completed ? { wallMS, monotonicMS } : { wallMS: 0, monotonicMS: 0 },
        spawn: () => ({
          pid: 123,
          kill(signal) {
            signals.push(signal);
          },
          unref() {},
          exited: Promise.resolve().then(() => {
            completed = true;
            return 0;
          }),
        }),
      }),
    ).rejects.toThrow("timed out");
    expect(signals).toEqual([]);
  },
);
test("accepts an acknowledged child only within its absolute budget and strips vault access", async () => {
  let completed = false;
  let retainedToken: string | undefined;
  const signals: string[] = [];
  const result = await boundedCommand(
    ["injected-owned-child"],
    {
      ...(await options()),
      env: { OP_SERVICE_ACCOUNT_TOKEN: "injected-never-real-token" },
    },
    {
      clock: () =>
        completed
          ? { wallMS: 50, monotonicMS: 50 }
          : { wallMS: 0, monotonicMS: 0 },
      spawn: (_argv, spawned) => {
        retainedToken = spawned.env["OP_SERVICE_ACCOUNT_TOKEN"];
        return {
          pid: 123,
          kill(signal) {
            signals.push(signal);
          },
          unref() {},
          exited: Promise.resolve().then(() => {
            completed = true;
            return 0;
          }),
        };
      },
    },
  );
  expect(result).toMatchObject({ exitCode: 0, timedOut: false, elapsedMS: 50 });
  expect(result.stdout.length).toBe(0);
  expect(result.stderr).toBe("");
  expect(retainedToken).toBeUndefined();
  expect(signals).toEqual([]);
});
test("a signal exit acknowledgement never permits another signal", async () => {
  const signals: string[] = [];
  await expect(
    boundedCommand(["injected-owned-child"], await options(), {
      clock: () => ({ wallMS: 0, monotonicMS: 0 }),
      spawn: () => ({
        pid: 123,
        kill(signal) {
          signals.push(signal);
        },
        unref() {},
        exited: Promise.resolve(143),
      }),
    }),
  ).rejects.toThrow("exited 143");
  expect(signals).toEqual([]);
});
test("the journey budget is absolute and cannot reset after a command or a clock rollback", () => {
  let now = { wallMS: 0, monotonicMS: 0 };
  const deadline = new AcceptanceDeadline(100, () => now);
  now = { wallMS: 80, monotonicMS: 10 };
  expect(deadline.remainingMS()).toBe(20);
  now = { wallMS: -100, monotonicMS: 20 };
  expect(deadline.remainingMS()).toBe(20);
  now = { wallMS: -100, monotonicMS: 100 };
  expect(() => deadline.assertWithin()).toThrow("deadline exceeded");
});
test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects an invalid deadline %s before spawning",
  (timeout) => {
    expect(() => new AcceptanceDeadline(timeout)).toThrow(
      "positive integer deadline",
    );
  },
);
