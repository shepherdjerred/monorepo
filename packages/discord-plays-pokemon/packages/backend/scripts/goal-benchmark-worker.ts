import path from "node:path";
import { z } from "zod";
import { ConfigSchema } from "#src/config/schema.ts";
import { Emulator } from "#src/emulator/emulator.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";
import { createGameEventWatcher } from "#src/game/events/watcher.ts";
import {
  createCatchEvidenceSettler,
  shouldContinuePostProcessCatchObservation,
  type CatchEvidenceSettler,
  type CatchEventEvidence,
} from "#src/goal/catch-evidence.ts";
import {
  bootBenchmarkSave,
  liveBenchmarkSnapshot,
  liveBenchmarkSpatial,
} from "#src/goal/benchmark-worker-boot-readiness.ts";
import { GoalManager } from "#src/goal/goal-manager.ts";
import type { GoalProcessSpawner } from "#src/goal/goal-types.ts";
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
type ProcessCapture = {
  spawner: GoalProcessSpawner;
  completed: () => Promise<void>;
};
async function startBenchmarkGoal(
  manager: GoalManager,
  goal: string,
  runDirectory: string,
): Promise<void> {
  const started = await manager.startGoal({
    goal,
    requesterId: "benchmark-operator",
    channelId: "benchmark",
  });
  if (started.kind === "started") return;
  if (started.kind === "missing_credential") {
    const failure = {
      schemaVersion: 1,
      phase: "startup",
      message: started.content,
    };
    await Bun.write(
      path.join(runDirectory, "provider-startup-failure.json"),
      `${JSON.stringify(failure)}\n`,
    );
  }
  throw new Error(`goal did not start: ${started.kind}: ${started.content}`);
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
async function waitForLiveSnapshot(
  emulator: Emulator,
  timeoutSeconds: number,
): Promise<{ snapshot: GameSnapshot; capturedFrame: number }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const capturedFrame = emulator.frame;
    const snapshot = liveBenchmarkSnapshot(emulator);
    if (snapshot !== null) return { snapshot, capturedFrame };
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
    if (state === undefined) {
      const completed = manager
        .getHistory(100)
        .some((entry) => entry.id === goalId);
      if (completed) return;
    } else if (state.id !== goalId) {
      throw new Error(`active goal changed from ${goalId} to ${state.id}`);
    }
    if (Date.now() >= deadline) {
      throw new Error("goal manager exceeded its runtime and shutdown grace");
    }
    await Bun.sleep(250);
  }
}
async function waitForCatchEvidence(
  settler: CatchEvidenceSettler,
  emulator: Emulator,
): Promise<void> {
  const processEndedFrame = emulator.frame;
  const processEndedAtMs = Date.now();
  while (
    shouldContinuePostProcessCatchObservation({
      processEndedFrame,
      processEndedAtMs,
      observedFrame: emulator.frame,
      observedAtMs: Date.now(),
      pendingCount: settler.pendingCount(),
    })
  ) {
    await Bun.sleep(100);
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
      !tmpExists &&
      (await save.exists()) &&
      save.size === 128 * 1024 &&
      save.lastModified >= minimumModifiedAt
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
    return await bootBenchmarkSave(verifier, config.bootTimeoutSeconds);
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
  let evidenceCapturedFrame: number | undefined;
  let goalId: string | undefined;
  let catchCaptureError: Error | undefined;
  let catchEvents: readonly CatchEventEvidence[];
  const throwCatchCaptureError = (): void => {
    if (catchCaptureError !== undefined) {
      throw catchCaptureError;
    }
  };

  try {
    await emulator.init();
    emulator.start();
    initialSnapshot = await bootBenchmarkSave(
      emulator,
      config.bootTimeoutSeconds,
    );
    const watcher = createGameEventWatcher({
      reader: emulator.memoryReader(),
      symbols: emulator.gameSymbols(),
    });
    const catchEvidenceSettler = createCatchEvidenceSettler(initialSnapshot);
    let collectCatchEvidence = true;
    const pollCatchEvidence = (frame: number): void => {
      if (!collectCatchEvidence) return;
      try {
        const capturedAtMs = Date.now();
        const catches = watcher
          .poll()
          .filter((event) => event.kind === "catch")
          .map((event) => ({
            occurredAt: new Date(capturedAtMs).toISOString(),
            species: event.species,
          }));
        catchEvidenceSettler.observe({
          frame,
          capturedAtMs,
          snapshot: liveBenchmarkSnapshot(emulator),
          catches,
        });
      } catch (error) {
        catchCaptureError =
          error instanceof Error ? error : new Error(String(error));
      }
    };
    emulator.addFrameHook((frame) => {
      if (frame % 30 !== 0) return;
      pollCatchEvidence(frame);
    });

    manager = new GoalManager({
      config: runtimeConfig.game.goal,
      controlToken,
      sendMessage: () => Promise.resolve(),
      spawner: processCapture.spawner,
      snapshotProvider: () => liveBenchmarkSnapshot(emulator),
      spatialSnapshotProvider: () => liveBenchmarkSpatial(emulator),
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
    pollCatchEvidence(emulator.frame);
    throwCatchCaptureError();
    await waitForCatchEvidence(catchEvidenceSettler, emulator);
    const finalEvidence = await waitForLiveSnapshot(
      emulator,
      config.bootTimeoutSeconds,
    );
    catchEvidenceSettler.observe({
      frame: finalEvidence.capturedFrame,
      capturedAtMs: Date.now(),
      snapshot: finalEvidence.snapshot,
      catches: [],
    });
    collectCatchEvidence = false;
    catchEvents = catchEvidenceSettler.finish();
    throwCatchCaptureError();
    finalSnapshot = finalEvidence.snapshot;
    evidenceCapturedFrame = finalEvidence.capturedFrame;
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
        evidenceCapturedFrame,
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
