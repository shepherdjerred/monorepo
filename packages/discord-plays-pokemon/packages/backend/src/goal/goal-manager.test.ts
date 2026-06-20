import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import type { Config } from "#src/config/schema.ts";
import { DISCORD_MESSAGE_LIMIT } from "./discord-message.ts";
import {
  GoalManager,
  type GoalDiscordMessage,
  type GoalProcess,
  type GoalProcessSpawner,
} from "./goal-manager.ts";

async function createRuntimeDirectory(): Promise<string> {
  const directory = path.join(
    Bun.env.TMPDIR ?? "/tmp",
    `pokemon-goal-${crypto.randomUUID()}`,
  );
  await Bun.write(path.join(directory, ".keep"), "", { createPath: true });
  return directory;
}

function makeGoalConfig(runtimeDirectory: string): Config["game"]["goal"] {
  return {
    enabled: true,
    model: "gpt-5.4-nano",
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

function makeProcess(): GoalProcess & {
  finish: (exitCode: number) => void;
  killed: () => boolean;
} {
  let killed = false;
  const { promise: exited, resolve: finishProcess } =
    Promise.withResolvers<number>();

  return {
    stdout: null,
    stderr: null,
    exited,
    kill: () => {
      killed = true;
      finishProcess(143);
    },
    finish: finishProcess,
    killed: () => killed,
  };
}

async function noopSendMessage(): Promise<void> {
  await Bun.sleep(0);
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _codePoint of value) {
    length += 1;
  }
  return length;
}

describe("GoalManager", () => {
  const originalOpenAiKey = Bun.env.OPENAI_API_KEY;
  const originalCodexApiKey = Bun.env.CODEX_API_KEY;
  const originalCodexAccessToken = Bun.env.CODEX_ACCESS_TOKEN;

  beforeEach(() => {
    delete Bun.env.CODEX_API_KEY;
    delete Bun.env.CODEX_ACCESS_TOKEN;
    Bun.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete Bun.env.OPENAI_API_KEY;
    } else {
      Bun.env.OPENAI_API_KEY = originalOpenAiKey;
    }
    if (originalCodexApiKey === undefined) {
      delete Bun.env.CODEX_API_KEY;
    } else {
      Bun.env.CODEX_API_KEY = originalCodexApiKey;
    }
    if (originalCodexAccessToken === undefined) {
      delete Bun.env.CODEX_ACCESS_TOKEN;
    } else {
      Bun.env.CODEX_ACCESS_TOKEN = originalCodexAccessToken;
    }
  });

  test("locks a goal from other users for the configured lock window", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const processes: ReturnType<typeof makeProcess>[] = [];
    const spawner: GoalProcessSpawner = () => {
      const process = makeProcess();
      processes.push(process);
      return process;
    };
    const messages: GoalDiscordMessage[] = [];
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner,
      sendMessage: async (message) => {
        messages.push(message);
      },
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    const first = await manager.startGoal({
      goal: "Reach Petalburg",
      requesterId: "user-a",
      channelId: "channel",
    });
    const second = await manager.startGoal({
      goal: "Buy potions",
      requesterId: "user-b",
      channelId: "channel",
    });

    expect(first.kind).toBe("started");
    expect(second.kind).toBe("locked");
    expect(processes).toHaveLength(1);
    expect(messages).toHaveLength(0);
    await manager.shutdown();
  });

  test("lets the requester replace their own active goal", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const processes: ReturnType<typeof makeProcess>[] = [];
    const spawner: GoalProcessSpawner = () => {
      const process = makeProcess();
      processes.push(process);
      return process;
    };
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner,
      sendMessage: noopSendMessage,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    const first = await manager.startGoal({
      goal: "Reach Petalburg",
      requesterId: "user-a",
      channelId: "channel",
    });
    const second = await manager.startGoal({
      goal: "Buy potions",
      requesterId: "user-a",
      channelId: "channel",
    });

    expect(first.kind).toBe("started");
    expect(second.kind).toBe("started");
    expect(processes).toHaveLength(2);
    expect(processes[0]?.killed()).toBe(true);
    await manager.shutdown();
  });

  test("passes OpenAI API key as Codex API key for codex exec", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const process = makeProcess();
    let spawnedEnvironment: Record<string, string> | undefined;
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner: (_args, options) => {
        spawnedEnvironment = options.env;
        return process;
      },
      sendMessage: noopSendMessage,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    const result = await manager.startGoal({
      goal: "Reach Petalburg",
      requesterId: "user-a",
      channelId: "channel",
    });

    expect(result.kind).toBe("started");
    expect(spawnedEnvironment?.CODEX_API_KEY).toBe("test-key");
    await manager.shutdown();
  });

  test("does not forward unrelated process secrets to the Codex subprocess", async () => {
    const originalDiscordToken = Bun.env.DISCORD_TOKEN;
    Bun.env.DISCORD_TOKEN = "super-secret-discord-token";
    try {
      const runtimeDirectory = await createRuntimeDirectory();
      const process = makeProcess();
      let spawnedEnvironment: Record<string, string> | undefined;
      const manager = new GoalManager({
        config: makeGoalConfig(runtimeDirectory),
        controlToken: "token",
        spawner: (_args, options) => {
          spawnedEnvironment = options.env;
          return process;
        },
        sendMessage: noopSendMessage,
        now: () => new Date("2026-06-13T00:00:00.000Z"),
      });

      const result = await manager.startGoal({
        goal: "Reach Petalburg",
        requesterId: "user-a",
        channelId: "channel",
      });

      expect(result.kind).toBe("started");
      // The Codex credential the subprocess legitimately needs is still present.
      expect(spawnedEnvironment?.CODEX_API_KEY).toBe("test-key");
      // The bot token (and any other non-allowlisted secret) must not leak.
      expect(spawnedEnvironment?.DISCORD_TOKEN).toBeUndefined();
      await manager.shutdown();
    } finally {
      if (originalDiscordToken === undefined) {
        delete Bun.env.DISCORD_TOKEN;
      } else {
        Bun.env.DISCORD_TOKEN = originalDiscordToken;
      }
    }
  });

  test("accepts Codex access token without an API key", async () => {
    delete Bun.env.OPENAI_API_KEY;
    Bun.env.CODEX_ACCESS_TOKEN = "test-access-token";
    const runtimeDirectory = await createRuntimeDirectory();
    const process = makeProcess();
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner: () => process,
      sendMessage: noopSendMessage,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    const result = await manager.startGoal({
      goal: "Reach Petalburg",
      requesterId: "user-a",
      channelId: "channel",
    });

    expect(result.kind).toBe("started");
    await manager.shutdown();
  });

  test("throttles intermediate progress reports", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const process = makeProcess();
    const messages: GoalDiscordMessage[] = [];
    let currentTime = 0;
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner: () => process,
      sendMessage: async (message) => {
        messages.push(message);
      },
      now: () => new Date(currentTime),
    });

    await manager.startGoal({
      goal: "Reach Petalburg",
      requesterId: "user-a",
      channelId: "channel",
    });

    expect(await manager.publishProgress("I am now checking the map")).toBe(
      false,
    );
    currentTime = 60_000;
    expect(await manager.publishProgress("I am now walking north")).toBe(true);
    expect(messages).toHaveLength(1);
    // Mid-session updates are audience-facing narration: the message is the
    // model's text verbatim, with no requester mention or "goal update:" prefix,
    // and nobody is pinged.
    expect(messages[0]?.content).toBe("I am now walking north");
    expect(messages[0]?.content).not.toContain("<@user-a>");
    expect(messages[0]?.content).not.toContain("goal update:");
    expect(messages[0]?.allowedUserIds).toEqual([]);
    await manager.shutdown();
  });
});

describe("GoalManager final report", () => {
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

  test("truncates an oversized final report to Discord's limit", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const process = makeProcess();
    const messages: GoalDiscordMessage[] = [];
    const config = makeGoalConfig(runtimeDirectory);
    const manager = new GoalManager({
      config,
      controlToken: "token",
      spawner: () => process,
      sendMessage: async (message) => {
        messages.push(message);
      },
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    const start = await manager.startGoal({
      goal: "Reach Petalburg",
      requesterId: "user-a",
      channelId: "channel",
    });
    expect(start.kind).toBe("started");

    const goalId = manager.getStatus()?.id;
    expect(goalId).toBeDefined();
    const outputPath = path.resolve(
      runtimeDirectory,
      config.screenshot_dir,
      `${String(goalId)}-final.txt`,
    );
    // A multi-paragraph report well over the 2000-char Discord limit.
    await Bun.write(outputPath, "z".repeat(DISCORD_MESSAGE_LIMIT * 2));

    process.finish(0);
    // observeProcess awaits process.exited, then reads/persists state before
    // sending; poll briefly for the completion message to be delivered.
    for (let attempt = 0; attempt < 50 && messages.length === 0; attempt += 1) {
      await Bun.sleep(1);
    }

    expect(messages).toHaveLength(1);
    const content = messages[0]?.content ?? "";
    expect(codePointLength(content)).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(content.endsWith("… (truncated)")).toBe(true);
    expect(content).toContain("goal finished");
    await manager.shutdown();
  });
});

describe("GoalManager concurrency", () => {
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

  test("only spawns one process for near-simultaneous starts", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const processes: ReturnType<typeof makeProcess>[] = [];
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner: () => {
        const process = makeProcess();
        processes.push(process);
        return process;
      },
      sendMessage: noopSendMessage,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    // Fire both without awaiting the first: the second runs while the first is
    // still inside its pre-spawn await window. The synchronous lock must make
    // the second bail before it can spawn a second (orphaned) process.
    const firstPromise = manager.startGoal({
      goal: "Reach Petalburg",
      requesterId: "user-a",
      channelId: "channel",
    });
    const secondPromise = manager.startGoal({
      goal: "Buy potions",
      requesterId: "user-b",
      channelId: "channel",
    });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    const kinds = [first.kind, second.kind].toSorted();
    expect(kinds).toEqual(["busy", "started"]);
    expect(processes).toHaveLength(1);
    await manager.shutdown();
  });
});

// Spawner that returns the next process from an injectable slot, so the test
// can grab it back and complete it from outside the manager.
function spawnerWithSlot(): {
  spawner: GoalProcessSpawner;
  nextProcess: () => ReturnType<typeof makeProcess>;
} {
  let nextProc: ReturnType<typeof makeProcess> | undefined;
  return {
    spawner: () => {
      const proc = makeProcess();
      nextProc = proc;
      return proc;
    },
    nextProcess: () => {
      if (nextProc === undefined) {
        throw new Error("spawner has not been called yet");
      }
      return nextProc;
    },
  };
}

async function runAndComplete(
  manager: GoalManager,
  nextProcess: () => ReturnType<typeof makeProcess>,
  goal: string,
): Promise<void> {
  const start = await manager.startGoal({
    goal,
    requesterId: "user-a",
    channelId: "channel",
  });
  expect(start.kind).toBe("started");
  nextProcess().finish(0);
  // observeProcess writes history+state after process exit; poll briefly.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (manager.getHistory(20).some((entry) => entry.goal === goal)) return;
    await Bun.sleep(1);
  }
  throw new Error(`Goal ${goal} never landed in history`);
}

describe("GoalManager history", () => {
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

  test("appends finished goals newest-first to the rolling history", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const { spawner, nextProcess } = spawnerWithSlot();
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner,
      sendMessage: noopSendMessage,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    expect(manager.getHistory(5)).toEqual([]);

    await runAndComplete(manager, nextProcess, "Goal A");
    await runAndComplete(manager, nextProcess, "Goal B");
    await runAndComplete(manager, nextProcess, "Goal C");

    const history = manager.getHistory(10);
    expect(history.map((entry) => entry.goal)).toEqual([
      "Goal C",
      "Goal B",
      "Goal A",
    ]);
    expect(history[0]?.status).toBe("completed");
    expect(history[0]?.exitCode).toBe(0);
    await manager.shutdown();
  });

  test("trims history to the last 10 entries", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const { spawner, nextProcess } = spawnerWithSlot();
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner,
      sendMessage: noopSendMessage,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    for (let i = 0; i < 15; i += 1) {
      await runAndComplete(manager, nextProcess, `Goal ${String(i)}`);
    }

    const history = manager.getHistory(20);
    expect(history).toHaveLength(10);
    expect(history[0]?.goal).toBe("Goal 14");
    expect(history.at(-1)?.goal).toBe("Goal 5");
    await manager.shutdown();
  });

  test("persists current goal + history into goal-state.json", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const config = makeGoalConfig(runtimeDirectory);
    const { spawner, nextProcess } = spawnerWithSlot();
    const manager = new GoalManager({
      config,
      controlToken: "token",
      spawner,
      sendMessage: noopSendMessage,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    await runAndComplete(manager, nextProcess, "Goal A");

    // runAndComplete resolves once the goal lands in *in-memory* history, but
    // observeProcess() updates that in-memory list (and does an async session-log
    // write) BEFORE persistState() flushes goal-state.json. Poll the file so we
    // assert the post-completion envelope rather than racing the empty-history
    // snapshot persisted at startGoal (the source of CI flake build #4532).
    const statePath = path.resolve(runtimeDirectory, config.state_path);
    let persisted = await Bun.file(statePath).json();
    for (
      let attempt = 0;
      attempt < 200 && (persisted.history?.length ?? 0) < 1;
      attempt += 1
    ) {
      await Bun.sleep(1);
      persisted = await Bun.file(statePath).json();
    }
    expect(persisted).toHaveProperty("current");
    expect(persisted).toHaveProperty("history");
    expect(persisted.history).toHaveLength(1);
    expect(persisted.history[0].goal).toBe("Goal A");
    await manager.shutdown();
  });

  test("getHistory(0) returns empty without touching state", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const { spawner, nextProcess } = spawnerWithSlot();
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner,
      sendMessage: noopSendMessage,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    await runAndComplete(manager, nextProcess, "Goal A");
    expect(manager.getHistory(0)).toEqual([]);
    expect(manager.getHistory(-5)).toEqual([]);
    await manager.shutdown();
  });

  test("exposes a per-guild GoalMemory rooted under the runtime directory", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "token",
      spawner: () => makeProcess(),
      sendMessage: noopSendMessage,
    });

    expect(await manager.memory.readMemory()).toBe("");
    await manager.memory.writeMemory(
      "Roxanne uses Rock types — bring a Grass/Water mon.",
    );
    expect(await manager.memory.readMemory()).toContain(
      "bring a Grass/Water mon",
    );
    // memory_dir resolves relative to runtime_directory, like state_path.
    expect(
      await Bun.file(
        path.join(runtimeDirectory, "goal-memory", "MEMORY.md"),
      ).exists(),
    ).toBe(true);
  });
});
