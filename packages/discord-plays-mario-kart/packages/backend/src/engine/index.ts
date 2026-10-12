// The game engine: boot-time preparation and per-session construction of the
// native SpaghettiKart port (spaghetti-src/).
import path from "node:path";
import type { Config } from "#src/config/schema.ts";
import type { GameEngine } from "./game-engine.ts";
import { SpaghettiEngine } from "./spaghetti/engine.ts";
import {
  prepareSpaghettiBuild,
  type SpaghettiBuild,
} from "./spaghetti/install.ts";

/** Under state_root_dir, beside the per-guild session directories. */
export const SPAGHETTI_ASSET_CACHE_DIR = "spaghettikart-assets";

/**
 * Once per process, before any session: the ROM-derived game archive is
 * extracted here (and cached on the saves volume) so `/play` never waits on
 * it, and a missing install or a wrong ROM fails the pod at startup.
 */
export function prepareEngine(config: Config): Promise<SpaghettiBuild> {
  return prepareSpaghettiBuild({
    installDir: config.spaghettikart.install_dir,
    romPath: config.emulator.rom_path,
    cacheDir: path.join(config.state_root_dir, SPAGHETTI_ASSET_CACHE_DIR),
  });
}

export type EngineSession = {
  /** saves/<guildId>: per-guild state never leaks between Discord servers. */
  readonly sessionDir: string;
  readonly seats: number;
};

/**
 * The game runs in its own process; its home directory holds its config,
 * logs, and EEPROM save.
 */
export function createGameEngine(
  config: Config,
  build: SpaghettiBuild,
  session: EngineSession,
): GameEngine {
  return new SpaghettiEngine({
    build,
    homeDir: path.join(session.sessionDir, "spaghettikart"),
    seats: session.seats,
    outputFps: config.spaghettikart.output_fps,
    snapshotEveryNFrames: config.leaderboard.poll_every_n_frames,
  });
}
