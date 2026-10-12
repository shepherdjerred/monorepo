// The game engine: boot-time preparation and per-session construction of the
// native SpaghettiKart port (spaghetti-src/).
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@shepherdjerred/discord-stream-lifecycle/persistence/atomic-write";
import type { Config } from "#src/config/schema.ts";
import type { GameEngine } from "./game-engine.ts";
import { SpaghettiEngine } from "./spaghetti/engine.ts";
import {
  prepareSpaghettiBuild,
  type SpaghettiBuild,
} from "./spaghetti/install.ts";

/** Under state_root_dir, beside the per-guild session directories. */
export const SPAGHETTI_ASSET_CACHE_DIR = "spaghettikart-assets";

/** The game's home (SHIP_HOME) inside a guild's session directory. */
export const SPAGHETTI_HOME_DIR = "spaghettikart";

/** The game's 4 Kbit EEPROM image: cups, records, and settings. */
const EEPROM_FILE = "default.sav";
const EEPROM_BYTES = 512;
const CONTROLLER_PAK_FILES = 16;

/**
 * A guild's progress, relative to its session dir: the EEPROM save plus the
 * controller-pak header and files (time-trial ghosts). Snapshotted into
 * saves/<guildId>/history/ before every session.
 */
export const MK64_SAVE_HISTORY_ENTRIES: readonly string[] = [
  path.join(SPAGHETTI_HOME_DIR, EEPROM_FILE),
  path.join(SPAGHETTI_HOME_DIR, "controllerPak_header.sav"),
  ...Array.from({ length: CONTROLLER_PAK_FILES }, (_, index) =>
    path.join(SPAGHETTI_HOME_DIR, `controllerPak_file_${String(index)}.sav`),
  ),
];

/**
 * The wasm core's save blob (EEPROM, 4 mempaks, SRAM, flash), which kept the
 * EEPROM in its first bytes. Read once to carry a guild's progress over.
 */
const LEGACY_SAVE_MEMORY = path.join("emulator", "game.savememory");
const LEGACY_SAVE_MEMORY_BYTES = 296_960;

/**
 * Carry a guild's progress over from the wasm core: when the guild has a
 * legacy save blob and no native EEPROM yet, write the blob's first 512 bytes
 * (the 4 Kbit EEPROM, byte-identical in both cores) as default.sav. The legacy
 * file is left in place. Controller-pak ghosts use an incompatible layout and
 * are not migrated. Returns whether a save was migrated.
 */
export async function migrateLegacyEeprom(
  sessionDir: string,
): Promise<boolean> {
  const target = path.join(sessionDir, SPAGHETTI_HOME_DIR, EEPROM_FILE);
  if (await Bun.file(target).exists()) {
    return false;
  }
  const legacyPath = path.join(sessionDir, LEGACY_SAVE_MEMORY);
  const legacy = Bun.file(legacyPath);
  if (!(await legacy.exists())) {
    return false;
  }
  const bytes = await legacy.bytes();
  if (bytes.length !== LEGACY_SAVE_MEMORY_BYTES) {
    throw new Error(
      `legacy save at ${legacyPath} has the wrong size (${String(bytes.length)} bytes, expected ${String(LEGACY_SAVE_MEMORY_BYTES)}); refusing to migrate it`,
    );
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, bytes.slice(0, EEPROM_BYTES));
  return true;
}

/**
 * Refuse to boot over a damaged EEPROM save. The game treats an unreadable
 * save as a fresh cartridge and writes defaults over it on its first save, so
 * a wrong-size file must stop the session while it is still recoverable.
 */
export async function assertEepromIntact(sessionDir: string): Promise<void> {
  const savePath = path.join(sessionDir, SPAGHETTI_HOME_DIR, EEPROM_FILE);
  let size: number;
  try {
    const info = await stat(savePath);
    size = info.size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (size !== EEPROM_BYTES) {
    throw new Error(
      `EEPROM save at ${savePath} has the wrong size (${String(size)} bytes, expected ${String(EEPROM_BYTES)}); refusing to overwrite it`,
    );
  }
}

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
    homeDir: path.join(session.sessionDir, SPAGHETTI_HOME_DIR),
    seats: session.seats,
    outputFps: config.spaghettikart.output_fps,
    snapshotEveryNFrames: config.leaderboard.poll_every_n_frames,
  });
}
