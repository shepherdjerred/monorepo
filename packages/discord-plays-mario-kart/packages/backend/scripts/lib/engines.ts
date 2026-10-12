// Build the engine for a ROM-gated harness, the way a session does.
import path from "node:path";
import type { GameEngine } from "#src/engine/game-engine.ts";
import { SpaghettiEngine } from "#src/engine/spaghetti/engine.ts";
import { loadDevSpaghettiBuild } from "./spaghetti-dev.ts";

export function parseOutputFps(value: string): 30 | 60 {
  const fps = Number(value);
  if (fps === 30 || fps === 60) return fps;
  throw new Error(`--fps must be 30 or 60, got ${value}`);
}

export async function createHarnessEngine(opts: {
  rom: string | undefined;
  /** A scratch session directory, like saves/<guildId>. */
  sessionDir: string;
  fps: 30 | 60;
}): Promise<GameEngine> {
  return new SpaghettiEngine({
    build: await loadDevSpaghettiBuild(opts.rom),
    homeDir: path.join(opts.sessionDir, "spaghettikart"),
    seats: 4,
    outputFps: opts.fps,
    snapshotEveryNFrames: 10,
  });
}
