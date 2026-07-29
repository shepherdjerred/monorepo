import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import type { Config } from "#src/config/schema.ts";
import { GoalManager } from "./goal-manager.ts";
import type { GoalProcess } from "./goal-types.ts";

async function createRuntimeDirectory(): Promise<string> {
  const directory = path.join(
    Bun.env.TMPDIR ?? "/tmp",
    `pokemon-goal-lease-${crypto.randomUUID()}`,
  );
  await Bun.write(path.join(directory, ".keep"), "", { createPath: true });
  return directory;
}

function makeGoalConfig(runtimeDirectory: string): Config["game"]["goal"] {
  return {
    enabled: true,
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    codex_binary: "codex",
    runtime_directory: runtimeDirectory,
    screenshot_dir: "screenshots",
    state_path: "goal-state.json",
    memory_dir: "goal-memory",
    control_host: "127.0.0.1",
    control_port: 8082,
    max_runtime_minutes: 30,
    lock_minutes: 5,
    progress_update_interval_seconds: 60,
    command_limits: {
      max_quantity_per_action: 60,
      chord_max_commands: 32,
      chord_max_total: 200,
    },
  };
}

function makeProcess(exitOnKill = true): GoalProcess & {
  finish: (exitCode: number) => void;
  killed: () => boolean;
  killRequested: Promise<undefined>;
} {
  let killed = false;
  const { promise: exited, resolve } = Promise.withResolvers<number>();
  const { promise: killRequested, resolve: resolveKillRequested } =
    Promise.withResolvers<undefined>();
  return {
    stdout: null,
    stderr: null,
    exited,
    kill: () => {
      killed = true;
      resolveKillRequested(undefined);
      if (exitOnKill) resolve(143);
    },
    finish: resolve,
    killed: () => killed,
    killRequested,
  };
}

class LeaseTracker {
  held = false;
  acquired = 0;
  released = 0;

  acquire = (): (() => void) => {
    if (this.held) throw new Error("lease already held");
    this.held = true;
    this.acquired += 1;
    return this.release;
  };

  private readonly release = (): void => {
    if (!this.held) throw new Error("lease released twice");
    this.held = false;
    this.released += 1;
  };
}

async function noopSendMessage(): Promise<void> {
  await Promise.resolve();
}

async function waitForRelease(tracker: LeaseTracker): Promise<void> {
  for (let attempt = 0; attempt < 200 && tracker.held; attempt += 1) {
    await Bun.sleep(1);
  }
}

const START_INPUT = {
  goal: "Walk to Route 101",
  requesterId: "user-a",
  channelId: "channel",
};

describe("GoalManager input lease", () => {
  const originalOpenAiKey = Bun.env.OPENAI_API_KEY;

  beforeEach(() => {
    Bun.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete Bun.env.OPENAI_API_KEY;
    } else {
      Bun.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  test("holds and releases input around normal completion", async () => {
    const tracker = new LeaseTracker();
    const process = makeProcess();
    const manager = new GoalManager({
      config: makeGoalConfig(await createRuntimeDirectory()),
      controlToken: "token",
      spawner: () => process,
      sendMessage: noopSendMessage,
      acquireInputLease: tracker.acquire,
    });

    const started = await manager.startGoal(START_INPUT);
    expect(started.kind).toBe("started");
    expect(tracker.held).toBeTrue();
    process.finish(0);
    await waitForRelease(tracker);
    expect(tracker.released).toBe(1);
  });

  test("releases input on spawn and persistence failures", async () => {
    const spawnTracker = new LeaseTracker();
    const spawnManager = new GoalManager({
      config: makeGoalConfig(await createRuntimeDirectory()),
      controlToken: "token",
      spawner: () => {
        throw new Error("spawn failed");
      },
      sendMessage: noopSendMessage,
      acquireInputLease: spawnTracker.acquire,
    });
    await expect(spawnManager.startGoal(START_INPUT)).rejects.toThrow(
      "spawn failed",
    );
    expect(spawnTracker.released).toBe(1);

    const persistTracker = new LeaseTracker();
    const process = makeProcess();
    const runtimeDirectory = await createRuntimeDirectory();
    const persistManager = new GoalManager({
      config: { ...makeGoalConfig(runtimeDirectory), state_path: "." },
      controlToken: "token",
      spawner: () => process,
      sendMessage: noopSendMessage,
      acquireInputLease: persistTracker.acquire,
    });
    await expect(persistManager.startGoal(START_INPUT)).rejects.toThrow();
    expect(process.killed()).toBeTrue();
    expect(persistTracker.released).toBe(1);
  });

  test("claims replacement and shutdown teardown exactly once", async () => {
    const tracker = new LeaseTracker();
    const processes: ReturnType<typeof makeProcess>[] = [];
    const manager = new GoalManager({
      config: makeGoalConfig(await createRuntimeDirectory()),
      controlToken: "token",
      spawner: () => {
        const process = makeProcess();
        processes.push(process);
        return process;
      },
      sendMessage: noopSendMessage,
      acquireInputLease: tracker.acquire,
    });

    await manager.startGoal({ ...START_INPUT, goal: "First" });
    await manager.startGoal({ ...START_INPUT, goal: "Second" });
    expect(processes[0]?.killed()).toBeTrue();
    expect(tracker.acquired).toBe(2);
    expect(tracker.released).toBe(1);
    await manager.shutdown();
    await Bun.sleep(10);
    expect(processes[1]?.killed()).toBeTrue();
    expect(tracker.released).toBe(2);
  });

  test("retains the lease until a replaced process has exited", async () => {
    const tracker = new LeaseTracker();
    const first = makeProcess(false);
    const second = makeProcess();
    const processes = [first, second];
    const manager = new GoalManager({
      config: makeGoalConfig(await createRuntimeDirectory()),
      controlToken: "token",
      spawner: () => {
        const process = processes.shift();
        if (process === undefined) throw new Error("missing process fixture");
        return process;
      },
      sendMessage: noopSendMessage,
      acquireInputLease: tracker.acquire,
    });

    await manager.startGoal({ ...START_INPUT, goal: "First" });
    const replacement = manager.startGoal({ ...START_INPUT, goal: "Second" });
    await first.killRequested;
    expect(tracker.held).toBeTrue();
    expect(tracker.acquired).toBe(1);
    expect(tracker.released).toBe(0);

    first.finish(143);
    const replacementResult = await replacement;
    expect(replacementResult.kind).toBe("started");
    expect(tracker.acquired).toBe(2);
    expect(tracker.released).toBe(1);
    await manager.shutdown();
  });

  test("blocks new starts and holds the lease while old controls drain", async () => {
    const tracker = new LeaseTracker();
    const first = makeProcess(false);
    const second = makeProcess();
    const processes = [first, second];
    let controlToken: string | undefined;
    let goalId: string | undefined;
    const manager = new GoalManager({
      config: {
        ...makeGoalConfig(await createRuntimeDirectory()),
        max_runtime_minutes: 0,
      },
      controlToken: "token",
      spawner: (_args, options) => {
        controlToken = options.env["POKEMONCTL_TOKEN"];
        goalId = options.env["POKEMONCTL_GOAL_ID"];
        const process = processes.shift();
        if (process === undefined) throw new Error("missing process fixture");
        return process;
      },
      sendMessage: noopSendMessage,
      acquireInputLease: tracker.acquire,
    });

    await manager.startGoal(START_INPUT);
    if (controlToken === undefined || goalId === undefined) {
      throw new Error("goal control identity was not propagated");
    }
    const finishControl = manager.beginControlRequest(controlToken, goalId);
    if (finishControl === undefined) {
      throw new Error("active control request must be accepted");
    }
    expect(
      manager.beginControlRequest(controlToken, "stale-goal"),
    ).toBeUndefined();

    await first.killRequested;
    const busyBeforeExit = await manager.startGoal(START_INPUT);
    expect(busyBeforeExit.kind).toBe("busy");
    first.finish(143);
    await Bun.sleep(0);
    expect(tracker.held).toBe(true);
    const busyBeforeDrain = await manager.startGoal(START_INPUT);
    expect(busyBeforeDrain.kind).toBe("busy");

    finishControl();
    await waitForRelease(tracker);
    await Bun.sleep(10);
    const restarted = await manager.startGoal(START_INPUT);
    expect(restarted.kind).toBe("started");
    await manager.shutdown();
  });

  test("releases a timed-out goal exactly once", async () => {
    const tracker = new LeaseTracker();
    const process = makeProcess();
    const runtimeDirectory = await createRuntimeDirectory();
    const manager = new GoalManager({
      config: {
        ...makeGoalConfig(runtimeDirectory),
        max_runtime_minutes: 0,
      },
      controlToken: "token",
      spawner: () => process,
      sendMessage: noopSendMessage,
      acquireInputLease: tracker.acquire,
    });

    await manager.startGoal(START_INPUT);
    await waitForRelease(tracker);
    expect(process.killed()).toBeTrue();
    expect(tracker.released).toBe(1);
  });
});
