import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import type { Config } from "#src/config/schema.ts";
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
    model: "gpt-5.4-mini",
    codex_binary: "codex",
    runtime_directory: runtimeDirectory,
    screenshot_dir: "screenshots",
    state_path: "goal-state.json",
    control_host: "127.0.0.1",
    control_port: 8082,
    max_runtime_minutes: 30,
    lock_minutes: 5,
    progress_update_interval_seconds: 60,
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
    expect(messages[0]?.content).toContain("I am now walking north");
    await manager.shutdown();
  });
});
