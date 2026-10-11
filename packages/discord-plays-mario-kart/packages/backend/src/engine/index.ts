// Engine selection: boot-time preparation and per-session construction for the
// engine named by [emulator] engine.
import path from "node:path";
import type { Config } from "#src/config/schema.ts";
import { WorkerEmulator } from "#src/emulator/worker/worker-emulator.ts";
import type { GameEngine } from "./game-engine.ts";
import { SpaghettiEngine } from "./spaghetti/engine.ts";
import {
  prepareSpaghettiBuild,
  type SpaghettiBuild,
} from "./spaghetti/install.ts";

/** Under state_root_dir, beside the per-guild session directories. */
export const SPAGHETTI_ASSET_CACHE_DIR = "spaghettikart-assets";

export type PreparedEngine =
  | { readonly name: "n64wasm" }
  | { readonly name: "spaghettikart"; readonly build: SpaghettiBuild };

/**
 * Once per process, before any session: the native port's ROM-derived game
 * archive is extracted here (and cached on the saves volume) so `/play` never
 * waits on it and a wrong ROM fails the pod at startup.
 */
export async function prepareEngine(config: Config): Promise<PreparedEngine> {
  switch (config.emulator.engine) {
    case "n64wasm":
      return { name: "n64wasm" };
    case "spaghettikart":
      return {
        name: "spaghettikart",
        build: await prepareSpaghettiBuild({
          installDir: config.spaghettikart.install_dir,
          romPath: config.emulator.rom_path,
          cacheDir: path.join(config.state_root_dir, SPAGHETTI_ASSET_CACHE_DIR),
        }),
      };
  }
}

export type EngineSession = {
  /** saves/<guildId>: per-guild state never leaks between Discord servers. */
  readonly sessionDir: string;
  readonly seats: number;
};

export function createGameEngine(
  config: Config,
  prepared: PreparedEngine,
  session: EngineSession,
): GameEngine {
  switch (prepared.name) {
    case "n64wasm":
      // The wasm core runs on a Worker thread so its synchronous ~12–30 ms
      // frame steps stay off the main event loop that feeds ffmpeg and
      // Discord. It snapshots MEMFS saves into <sessionDir>/emulator.
      return new WorkerEmulator({
        wasmDir: config.emulator.wasm_dir,
        romPath: config.emulator.rom_path,
        fps: config.emulator.fps,
        software: config.emulator.software_render,
        seats: session.seats,
        savesDir: path.join(session.sessionDir, "emulator"),
        snapshotEveryNFrames: config.leaderboard.poll_every_n_frames,
      });
    case "spaghettikart":
      // The native port renders in its own process; its home directory holds
      // its config, logs, and EEPROM save.
      return new SpaghettiEngine({
        build: prepared.build,
        homeDir: path.join(session.sessionDir, "spaghettikart"),
        seats: session.seats,
        outputFps: config.spaghettikart.output_fps,
        snapshotEveryNFrames: config.leaderboard.poll_every_n_frames,
      });
  }
}
