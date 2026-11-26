import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTendCommand } from "#commands/tend/tend.ts";
import { resolveTendPaths, type TendPaths } from "#lib/tend/paths.ts";
import {
  acquireTendRunLock,
  acquireTendRunLockWaiting,
  type LockTiming,
  TendRunLockHeldError,
} from "#lib/tend/run-lock.ts";
import { runTend } from "#lib/tend/runner.ts";
import type { CommandRunner } from "#lib/tend/types.ts";
import { makeLiveness } from "./worktree-fixtures.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makePaths(): Promise<{ root: string; paths: TendPaths }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "tend-run-lock-test-"));
  tempDirs.push(root);
  return {
    root,
    paths: resolveTendPaths({ tendDir: path.join(root, "tend") }),
  };
}

/** A lock held by a live process (this one) that never goes stale. */
function holdLock(paths: TendPaths): Promise<() => Promise<void>> {
  return acquireTendRunLock({
    paths,
    ownerPid: process.pid,
    processStart: "unknown-holder",
  });
}

/**
 * A clock that only moves when the code under test sleeps. `onSleep` runs
 * before each sleep returns, which is where a holder can let go.
 */
function fakeTiming(onSleep?: (sleepCount: number) => Promise<void>): {
  readonly timing: LockTiming;
  readonly sleeps: number[];
} {
  let nowMs = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    timing: {
      now: () => nowMs,
      sleep: async (ms) => {
        sleeps.push(ms);
        nowMs += ms;
        await onSleep?.(sleeps.length);
      },
    },
  };
}

const noCommands: CommandRunner = () =>
  Promise.resolve({ exitCode: 127, stdout: "", stderr: "" });

describe("acquireTendRunLockWaiting", () => {
  it("fails at once by default when another applied run holds the lock", async () => {
    const { paths } = await makePaths();
    const release = await holdLock(paths);
    const { timing, sleeps } = fakeTiming();

    await expect(
      acquireTendRunLockWaiting({ paths, runner: noCommands, timing }),
    ).rejects.toThrow(
      `Another toolkit tend --apply run is active (${paths.lockFile})`,
    );
    await expect(
      acquireTendRunLockWaiting({
        paths,
        runner: noCommands,
        waitMs: 0,
        timing,
      }),
    ).rejects.toBeInstanceOf(TendRunLockHeldError);
    expect(sleeps).toEqual([]);
    await release();
  });

  it("proceeds once the holder releases", async () => {
    const { paths } = await makePaths();
    const release = await holdLock(paths);
    const { timing, sleeps } = fakeTiming(async (sleepCount) => {
      if (sleepCount === 3) {
        await release();
      }
    });

    const mine = await acquireTendRunLockWaiting({
      paths,
      runner: noCommands,
      waitMs: 15 * 60_000,
      timing,
    });

    expect(sleeps).toEqual([1000, 1000, 1000]);
    expect(await Bun.file(paths.lockFile).exists()).toBe(true);
    await mine();
    expect(await Bun.file(paths.lockFile).exists()).toBe(false);
  });

  it("gives up when the wait runs out, and says how long it waited", async () => {
    const { paths } = await makePaths();
    const release = await holdLock(paths);
    const { timing, sleeps } = fakeTiming();

    await expect(
      acquireTendRunLockWaiting({
        paths,
        runner: noCommands,
        waitMs: 2500,
        timing,
      }),
    ).rejects.toThrow(
      `Another toolkit tend --apply run is active (${paths.lockFile}); gave up after waiting 2s`,
    );
    expect(sleeps).toEqual([1000, 1000, 500]);
    // The holder's lock is untouched.
    expect(await Bun.file(paths.lockFile).exists()).toBe(true);
    await release();
  });

  it("takes over a dead holder's lock without waiting, as before", async () => {
    const { paths } = await makePaths();
    await acquireTendRunLock({
      paths,
      ownerPid: 999_999,
      processStart: "Mon Nov 15 01:00:00 2026",
    });
    const { timing, sleeps } = fakeTiming();

    const mine = await acquireTendRunLockWaiting({
      paths,
      runner: noCommands,
      waitMs: 60_000,
      timing,
    });

    expect(sleeps).toEqual([]);
    await mine();
  });
});

describe("the run lock in a tend run", () => {
  it("is neither taken nor waited on by a dry run", async () => {
    const { root, paths } = await makePaths();
    const release = await holdLock(paths);
    const lockBefore = await Bun.file(paths.lockFile).text();
    const { timing, sleeps } = fakeTiming();

    const report = await runTend({
      mode: "run",
      apply: false,
      surfaces: ["leases"],
      paths,
      homeDir: root,
      livenessOverride: makeLiveness(),
      statDisk: () => Promise.resolve(null),
      runner: noCommands,
      lockWaitMs: 60_000,
      lockTiming: timing,
    });

    expect(report.mode).toBe("dry-run");
    expect(sleeps).toEqual([]);
    expect(await Bun.file(paths.lockFile).text()).toBe(lockBefore);
    await release();
    expect(await Bun.file(paths.lockFile).exists()).toBe(false);
  });

  it("makes an applied run fail at once by default and queue with a wait", async () => {
    const { root, paths } = await makePaths();
    const release = await holdLock(paths);
    const applied = {
      mode: "run" as const,
      apply: true,
      surfaces: ["leases" as const],
      paths,
      homeDir: root,
      livenessOverride: makeLiveness(),
      statDisk: () => Promise.resolve(null),
      runner: noCommands,
    };
    const idle = fakeTiming();
    await expect(
      runTend({ ...applied, lockTiming: idle.timing }),
    ).rejects.toThrow("Another toolkit tend --apply run is active");
    expect(idle.sleeps).toEqual([]);

    const queued = fakeTiming(async (sleepCount) => {
      if (sleepCount === 2) {
        await release();
      }
    });
    const report = await runTend({
      ...applied,
      lockWaitMs: 15 * 60_000,
      lockTiming: queued.timing,
    });
    expect(report.mode).toBe("apply");
    expect(queued.sleeps).toEqual([1000, 1000]);
    // The run released the lock when it finished.
    expect(await Bun.file(paths.lockFile).exists()).toBe(false);
  });
});

describe("toolkit tend --lock-wait", () => {
  it.each(["run", "worktrees", "dedupe"])(
    "is forwarded by tend %s and rejects a bad duration",
    async (subcommand) => {
      const { root, paths } = await makePaths();
      const printed: unknown[] = [];
      vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        printed.push(...args);
      });
      const release = await holdLock(paths);
      const args = [
        "--apply",
        "--offline",
        "--summary",
        "--git-dir",
        path.join(root, "git"),
        ...(subcommand === "run" ? ["--only", "leases"] : []),
      ];

      const immediate = fakeTiming();
      await expect(
        handleTendCommand(subcommand, args, {
          paths,
          runner: noCommands,
          lockTiming: immediate.timing,
        }),
      ).rejects.toThrow("Another toolkit tend --apply run is active");
      expect(immediate.sleeps).toEqual([]);

      const queued = fakeTiming(async () => {
        await release();
      });
      await handleTendCommand(subcommand, [...args, "--lock-wait", "15m"], {
        paths,
        runner: noCommands,
        lockTiming: queued.timing,
      });
      expect(queued.sleeps).toEqual([1000]);
      expect(await Bun.file(paths.lockFile).exists()).toBe(false);
      expect(printed.join("\n")).toContain("toolkit tend — APPLY");

      await expect(
        handleTendCommand(subcommand, [...args, "--lock-wait", "soon"], {
          paths,
          runner: noCommands,
        }),
      ).rejects.toThrow('Invalid duration "soon"');
    },
  );
});
