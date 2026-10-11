// Build either engine for a ROM-gated harness, the way a session does.
import path from "node:path";
import { N64_FPS } from "#src/emulator/constants.ts";
import { WorkerEmulator } from "#src/emulator/worker/worker-emulator.ts";
import type { EngineName } from "#src/engine/format.ts";
import type { GameEngine } from "#src/engine/game-engine.ts";
import { SpaghettiEngine } from "#src/engine/spaghetti/engine.ts";
import { resolveRom } from "./harness.ts";
import { loadDevSpaghettiBuild } from "./spaghetti-dev.ts";

const WASM_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "assets",
  "n64wasm",
);

export function parseEngineName(value: string): EngineName {
  if (value === "n64wasm" || value === "spaghettikart") return value;
  throw new Error(`--engine must be n64wasm or spaghettikart, got ${value}`);
}

export function parseOutputFps(value: string): 30 | 60 {
  const fps = Number(value);
  if (fps === 30 || fps === 60) return fps;
  throw new Error(`--fps must be 30 or 60, got ${value}`);
}

export async function createHarnessEngine(opts: {
  engine: EngineName;
  rom: string | undefined;
  /** A scratch session directory, like saves/<guildId>. */
  sessionDir: string;
  /** Native output rate; the wasm engine always delivers N64_FPS. */
  fps: 30 | 60;
}): Promise<GameEngine> {
  switch (opts.engine) {
    case "n64wasm":
      return new WorkerEmulator({
        wasmDir: WASM_DIR,
        romPath: await resolveRom(opts.rom),
        fps: N64_FPS,
        software: true,
        seats: 4,
        savesDir: path.join(opts.sessionDir, "emulator"),
        snapshotEveryNFrames: 10,
      });
    case "spaghettikart":
      return new SpaghettiEngine({
        build: await loadDevSpaghettiBuild(opts.rom),
        homeDir: path.join(opts.sessionDir, "spaghettikart"),
        seats: 4,
        outputFps: opts.fps,
        snapshotEveryNFrames: 10,
      });
  }
}
