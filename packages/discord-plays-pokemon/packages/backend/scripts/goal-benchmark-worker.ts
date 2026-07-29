import path from "node:path";
import { z } from "zod";
import { ConfigSchema } from "#src/config/schema.ts";
import { BUTTON } from "#src/emulator/constants.ts";
import { Emulator } from "#src/emulator/emulator.ts";
import { SPECIES_TO_NATIONAL } from "#src/game/events/generated/species.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";
import { createGameEventWatcher } from "#src/game/events/watcher.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import {
  GoalManager,
  type GoalProcessSpawner,
} from "#src/goal/goal-manager.ts";
import { startGoalControlServer } from "#src/goal/control-server.ts";
const WorkerConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runSavePath: z.string().min(1),
  persistedSavePath: z.string().min(1),
  verificationSavePath: z.string().min(1),
  wasmPath: z.string().min(1),
  runtimeDirectory: z.string().min(1),
  runDirectory: z.string().min(1),
  controlHost: z.string().min(1),
  controlPort: z.number().int().min(1024).max(49_151),
  goal: z.string().min(1),
  model: z.string().min(1),
  reasoning: z.enum(["low", "medium", "high", "xhigh"]),
  runtimeMinutes: z.number().int().positive().max(30),
  bootTimeoutSeconds: z.number().int().positive().max(300),
  codexBinary: z.string().min(1),
});
type WorkerConfig = z.infer<typeof WorkerConfigSchema>;
type SerializedSnapshot = {
  party: GameSnapshot["party"];
  badges: GameSnapshot["badges"];
  dexOwned: number[];
  caughtMonSpecies: number;
  caughtMonShiny: boolean;
};
type CatchEvent = {
  occurredAt: string;
  frame: number;
  species: number;
  nationalDexNumber: number;
  postEventParty: {
    personality: number;
    otId: number;
    species: number;
  }[];
  postEventNationalDexOwned: boolean;
};
type ProcessCapture = {
  spawner: GoalProcessSpawner;
  completed: () => Promise<void>;
};
async function startBenchmarkGoal(
  manager: GoalManager,
  goal: string,
  runDirectory: string,
): Promise<void> {
  try {
    const started = await manager.startGoal({
      goal,
      requesterId: "benchmark-operator",
      channelId: "benchmark",
    });
    if (started.kind === "started") return;
    throw new Error(`goal did not start: ${started.kind}: ${started.content}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = { schemaVersion: 1, phase: "startup", message };
    await Bun.write(
      path.join(runDirectory, "provider-startup-failure.json"),
      `${JSON.stringify(failure)}\n`,
    );
    throw error;
  }
}
function serializeSnapshot(snapshot: GameSnapshot): SerializedSnapshot {
  return {
    party: snapshot.party,
    badges: snapshot.badges,
    dexOwned: [...snapshot.dexOwned],
    caughtMonSpecies: snapshot.caughtMonSpecies,
    caughtMonShiny: snapshot.caughtMonShiny,
  };
}

async function copyStream(
  stream: ReadableStream<Uint8Array>,
  filePath: string,
): Promise<void> {
  const sink = Bun.file(filePath).writer();
  const reader = stream.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      await sink.write(result.value);
      await sink.flush();
    }
  } finally {
    reader.releaseLock();
    await sink.end();
  }
}

function createProcessCapture(runDirectory: string): ProcessCapture {
  let capture: Promise<void> | undefined;
  const spawner: GoalProcessSpawner = (args, options) => {
    if (capture !== undefined) {
      throw new Error("benchmark worker supports exactly one Codex process");
    }
    const child = Bun.spawn(args, {
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [managerStdout, capturedStdout] = child.stdout.tee();
    const [managerStderr, capturedStderr] = child.stderr.tee();
    capture = (async () => {
      await Promise.all([
        copyStream(capturedStdout, path.join(runDirectory, "codex.jsonl")),
        copyStream(capturedStderr, path.join(runDirectory, "codex.stderr.log")),
      ]);
    })();
    return {
      pid: child.pid,
      stdout: managerStdout,
      stderr: managerStderr,
      exited: child.exited,
      kill(signal) {
        child.kill(signal);
      },
    };
  };
  return {
    spawner,
    async completed(): Promise<void> {
      await capture;
    },
  };
}

function liveSnapshot(emulator: Emulator): GameSnapshot | null {
  return readGameSnapshot(emulator.memoryReader(), emulator.gameSymbols());
}

function liveSpatial(
  emulator: Emulator,
): ReturnType<typeof readSpatialSnapshot> {
  return readSpatialSnapshot(emulator.memoryReader(), emulator.gameSymbols());
}

function captureCatchEvent(
  emulator: Emulator,
  frame: number,
  species: number,
): CatchEvent {
  const snapshot = liveSnapshot(emulator);
  if (snapshot === null) {
    throw new Error("live snapshot unavailable while capturing catch event");
  }
  const nationalDexNumber = SPECIES_TO_NATIONAL[species];
  if (nationalDexNumber === undefined || nationalDexNumber <= 0) {
    throw new Error(`species ${String(species)} has no National Dex mapping`);
  }
  const bitIndex = nationalDexNumber - 1;
  const dexByte = snapshot.dexOwned[Math.floor(bitIndex / 8)];
  if (dexByte === undefined) {
    throw new Error(
      `National Dex ${String(nationalDexNumber)} is outside owned bitfield`,
    );
  }
  return {
    occurredAt: new Date().toISOString(),
    frame,
    species,
    nationalDexNumber,
    postEventParty: snapshot.party.map((mon) => ({
      personality: mon.personality,
      otId: mon.otId,
      species: mon.species,
    })),
    postEventNationalDexOwned: (dexByte & (1 << (bitIndex % 8))) !== 0,
  };
}

async function bootAndContinue(
  emulator: Emulator,
  timeoutSeconds: number,
): Promise<GameSnapshot> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let nextContinuePress = Date.now() + 500;
  for (;;) {
    const snapshot = liveSnapshot(emulator);
    if (snapshot !== null && liveSpatial(emulator) !== null) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `emulator did not boot and continue within ${String(timeoutSeconds)} seconds`,
      );
    }
    if (Date.now() >= nextContinuePress) {
      // Mechanical startup only: advance boot/title/Continue until the loaded
      // save exposes a live player object. Gameplay remains entirely model-run.
      await emulator.queuePress(BUTTON.a, 3, 3);
      nextContinuePress = Date.now() + 750;
    }
    await Bun.sleep(100);
  }
}

async function waitForLiveSnapshot(
  emulator: Emulator,
  timeoutSeconds: number,
): Promise<GameSnapshot> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const snapshot = liveSnapshot(emulator);
    if (snapshot !== null) return snapshot;
    if (Date.now() >= deadline) {
      throw new Error("live game snapshot remained unavailable");
    }
    await Bun.sleep(100);
  }
}

async function waitForGoal(
  manager: GoalManager,
  goalId: string,
  runtimeMinutes: number,
): Promise<void> {
  const deadline = Date.now() + (runtimeMinutes * 60 + 30) * 1000;
  for (;;) {
    const state = manager.getStatus();
    if (state === undefined) return;
    if (state.id !== goalId) {
      throw new Error(`active goal changed from ${goalId} to ${state.id}`);
    }
    if (Date.now() >= deadline) {
      throw new Error("goal manager exceeded its runtime and shutdown grace");
    }
    await Bun.sleep(250);
  }
}

async function waitForPersistedSave(
  savePath: string,
  minimumModifiedAt: number,
): Promise<{ bytes: Uint8Array; persistedAt: string }> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const save = Bun.file(savePath);
    const tmpExists = await Bun.file(`${savePath}.tmp`).exists();
    if (
      (await save.exists()) &&
      save.size === 128 * 1024 &&
      save.lastModified >= minimumModifiedAt &&
      !tmpExists
    ) {
      return {
        bytes: await save.bytes(),
        persistedAt: new Date(save.lastModified).toISOString(),
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "emulator did not persist a complete 128 KiB save after stopping",
      );
    }
    await Bun.sleep(100);
  }
}

async function snapshotPersistedSave(
  config: WorkerConfig,
): Promise<GameSnapshot> {
  const verifier = new Emulator({
    wasmPath: config.wasmPath,
    savePath: config.verificationSavePath,
  });
  await verifier.init();
  verifier.start();
  try {
    return await bootAndContinue(verifier, config.bootTimeoutSeconds);
  } finally {
    await verifier.stopAndFlush();
  }
}

function buildRuntimeConfig(config: WorkerConfig) {
  return ConfigSchema.parse({
    bot: {
      enabled: false,
      discord_token: "benchmark",
      application_id: "1",
      commands: {
        enabled: false,
        update: false,
        screenshot: { enabled: false },
      },
      notifications: {
        enabled: false,
        events: { enabled: false },
      },
    },
    stream: {
      enabled: false,
      dynamic_streaming: false,
      minimum_in_channel: 0,
      require_watching: false,
      userbot: { id: "1", token: "benchmark" },
      video: {
        frame_rate: 60,
        bitrate_kbps: 1000,
        bitrate_max_kbps: 1500,
        canvas_height: 720,
      },
    },
    game: {
      enabled: true,
      wasm_path: config.wasmPath,
      save_path: config.runSavePath,
      goal: {
        enabled: true,
        model: config.model,
        reasoning_effort: config.reasoning,
        codex_binary: config.codexBinary,
        runtime_directory: config.runtimeDirectory,
        screenshot_dir: path.join(config.runDirectory, "screenshots"),
        state_path: path.join(config.runDirectory, "goal-state.json"),
        memory_dir: path.join(config.runDirectory, "goal-memory"),
        control_host: config.controlHost,
        control_port: config.controlPort,
        max_runtime_minutes: config.runtimeMinutes,
        lock_minutes: config.runtimeMinutes,
        progress_update_interval_seconds: 1,
      },
      commands: {
        enabled: true,
        max_actions_per_command: 200,
        max_quantity_per_action: 200,
        key_press_duration_in_milliseconds: 100,
        delay_between_actions_in_milliseconds: 100,
        burst: {
          duration_in_milliseconds: 100,
          delay_in_milliseconds: 100,
          quantity: 5,
        },
        chord: {
          duration_in_milliseconds: 100,
          max_commands: 32,
          max_total: 200,
          delay: 100,
        },
        hold: { duration_in_milliseconds: 500 },
      },
    },
    web: {
      enabled: false,
      cors: false,
      port: 18_080,
      assets: "",
      api: { enabled: false },
    },
  });
}

async function readWorkerConfig(): Promise<WorkerConfig> {
  const flagIndex = Bun.argv.indexOf("--config");
  const configPath = Bun.argv.at(flagIndex + 1);
  if (flagIndex === -1 || configPath === undefined) {
    throw new Error("benchmark worker requires --config <path>");
  }
  return WorkerConfigSchema.parse(await Bun.file(configPath).json());
}

async function main(): Promise<void> {
  const config = await readWorkerConfig();
  const runtimeConfig = buildRuntimeConfig(config);
  const emulator = new Emulator({
    wasmPath: config.wasmPath,
    savePath: config.runSavePath,
  });
  const processCapture = createProcessCapture(config.runDirectory);
  const controlToken = crypto.randomUUID();
  let manager: GoalManager | undefined;
  let controlServer: ReturnType<typeof startGoalControlServer> | undefined;
  let stopStartedAt: number;
  let initialSnapshot: GameSnapshot | undefined;
  let finalSnapshot: GameSnapshot | undefined;
  let goalId: string | undefined;
  let catchCaptureError: Error | undefined;
  const catchEvents: CatchEvent[] = [];

  try {
    await emulator.init();
    emulator.start();
    initialSnapshot = await bootAndContinue(
      emulator,
      config.bootTimeoutSeconds,
    );
    const watcher = createGameEventWatcher({
      reader: emulator.memoryReader(),
      symbols: emulator.gameSymbols(),
    });
    emulator.addFrameHook((frame) => {
      if (frame % 30 !== 0) return;
      for (const event of watcher.poll()) {
        if (event.kind === "catch") {
          try {
            catchEvents.push(captureCatchEvent(emulator, frame, event.species));
          } catch (error) {
            catchCaptureError =
              error instanceof Error ? error : new Error(String(error));
          }
        }
      }
    });

    manager = new GoalManager({
      config: runtimeConfig.game.goal,
      controlToken,
      sendMessage: () => Promise.resolve(),
      spawner: processCapture.spawner,
      snapshotProvider: () => liveSnapshot(emulator),
      spatialSnapshotProvider: () => liveSpatial(emulator),
    });
    await manager.initialize();
    controlServer = startGoalControlServer({
      emulator,
      goalManager: manager,
      config: runtimeConfig,
      token: controlToken,
    });
    await startBenchmarkGoal(manager, config.goal, config.runDirectory);
    const active = manager.getStatus();
    if (active === undefined) {
      throw new Error("goal manager lost the active goal immediately");
    }
    goalId = active.id;
    await waitForGoal(manager, goalId, config.runtimeMinutes);
    await processCapture.completed();
    if (catchCaptureError !== undefined) {
      throw catchCaptureError;
    }
    finalSnapshot = await waitForLiveSnapshot(
      emulator,
      config.bootTimeoutSeconds,
    );
    // Benchmark evidence must survive an independent reboot. The engine owns
    // save serialization; the host only flushes its resulting flash bytes.
    await emulator.checkpointSave();
  } finally {
    await manager?.shutdown();
    if (controlServer !== undefined) {
      await controlServer.stop(true);
    }
    stopStartedAt = Date.now();
    await emulator.stopAndFlush();
  }

  const goalState = manager
    .getHistory(100)
    .find((entry) => entry.id === goalId);
  if (goalState === undefined) {
    throw new Error("completed goal state was not recorded");
  }

  const persisted = await waitForPersistedSave(
    config.runSavePath,
    stopStartedAt,
  );
  await Bun.write(config.persistedSavePath, persisted.bytes);
  await Bun.write(config.verificationSavePath, persisted.bytes);
  const persistedSnapshot = await snapshotPersistedSave(config);

  await Bun.write(
    path.join(config.runDirectory, "worker-result.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        goalState,
        initialSnapshot: serializeSnapshot(initialSnapshot),
        finalSnapshot: serializeSnapshot(finalSnapshot),
        catchEvents,
        persistedSave: {
          persistedAt: persisted.persistedAt,
          byteLength: persisted.bytes.length,
          snapshot: serializeSnapshot(persistedSnapshot),
        },
      },
      undefined,
      2,
    )}\n`,
  );
}

await main();
