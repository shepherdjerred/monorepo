// Reusable primitives for the manually-run MK64 emulator harness: resolve the
// ROM, boot headless, drive deterministic input until a game state is reached,
// and capture an (optionally name-overlaid) screenshot. Shared by
// scripts/e2e-scenario.ts, e2e-race.ts, and e2e-input.ts.
//
// Needs a ROM (copyrighted, not in the repo) so it never runs in CI — see
// resolveRom() for where the ROM is expected to live.
import { N64Emulator } from "#src/emulator/n64-emulator.ts";
import { WIDTH, MAX_SEATS } from "#src/emulator/constants.ts";
import { readSnapshot } from "#src/emulator/mk64-memory.ts";
import type { Mk64Snapshot, ScreenMode } from "#src/emulator/mk64-memory.ts";
import { encodePng } from "#src/emulator/png.ts";
import { createLabelRenderer } from "#src/overlay/label-renderer.ts";
import { blitBgra } from "#src/overlay/blit.ts";
import { labelPosition, viewportRects } from "#src/overlay/layout.ts";
import { EMPTY_INPUT } from "@discord-plays-mario-kart/common";
import type { PlayerInputState } from "@discord-plays-mario-kart/common";

/** The canonical ROM home: the user's Syncthing folder (replicated per-machine). */
export const DEFAULT_ROM_PATH = `${Bun.env["HOME"] ?? "~"}/syncthing/Sync/roms/mariokart64.z64`;

/**
 * Resolve the MK64 ROM path: explicit arg → `MK64_ROM` env → the Syncthing
 * default. Fails fast (with guidance) if none of them exist on disk.
 */
export async function resolveRom(arg?: string): Promise<string> {
  const candidates: string[] = [];
  for (const c of [arg, Bun.env["MK64_ROM"], DEFAULT_ROM_PATH]) {
    if (c != null && c.length > 0) candidates.push(c);
  }
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(
    `MK64 ROM not found. Put it at ${DEFAULT_ROM_PATH} (Syncthing), set ` +
      `MK64_ROM=/path/to/rom.z64, or pass --rom <path>. Tried: ${candidates.join(", ")}`,
  );
}

/** Boot a headless emulator. Defaults to sprint mode (fps: 1000) for fast menu
 *  navigation; pass `fps: 30` to pace the loop in realtime for perf
 *  measurement. The emulator's own `setFps()` can flip pacing mid-run. */
export async function bootEmulator(opts: {
  rom: string;
  seats?: number;
  fps?: number;
}): Promise<N64Emulator> {
  const emu = new N64Emulator({
    wasmDir: Bun.env["WASM_DIR"] ?? "assets/n64wasm",
    romPath: opts.rom,
    fps: opts.fps ?? 1000,
    software: true,
    seats: opts.seats ?? MAX_SEATS,
  });
  await emu.init();
  return emu;
}

/** Per-frame input: returns one PlayerInputState per seat (index = seat). */
export type FrameSchedule = (frame: number) => PlayerInputState[];

/**
 * Step the emulator, applying `schedule(frame)` to each seat, until
 * `until(snapshot, frame)` is true (or `timeoutFrames` is hit, which throws).
 * `onTick` observes every polled snapshot — used by --watch to log transitions.
 */
export async function driveUntil(
  emu: N64Emulator,
  opts: {
    seats: number;
    schedule: FrameSchedule;
    until: (snapshot: Mk64Snapshot, frame: number) => boolean;
    timeoutFrames: number;
    onTick?: (snapshot: Mk64Snapshot, frame: number) => void;
  },
): Promise<{ snapshot: Mk64Snapshot; frame: number }> {
  let frame = 0;

  // Resolve with the hit (or a "timeout" sentinel) rather than via an outer
  // mutable — TS can't see closure mutations after the await, which would make
  // a later result check read as a constant condition.
  const result = await new Promise<
    { snapshot: Mk64Snapshot; frame: number } | "timeout"
  >((resolve) => {
    emu.onFrame(() => {
      frame++;
      const inputs = opts.schedule(frame);
      for (let seat = 0; seat < opts.seats; seat++) {
        emu.setPlayerInput(seat, inputs[seat] ?? EMPTY_INPUT);
      }
      const mem = emu.rdram();
      if (mem !== undefined) {
        const snapshot = readSnapshot(mem);
        opts.onTick?.(snapshot, frame);
        if (opts.until(snapshot, frame)) {
          emu.stop();
          resolve({ snapshot, frame });
          return;
        }
      }
      if (frame >= opts.timeoutFrames) {
        emu.stop();
        resolve("timeout");
      }
    });
    emu.start();
  });

  if (result === "timeout") {
    throw new Error(
      `driveUntil: target state not reached within ${String(opts.timeoutFrames)} frames`,
    );
  }
  return result;
}

/**
 * Save the current frame as a PNG. When `names` are given, the player labels
 * are rendered and blitted into each viewport corner for the screen mode —
 * the same primitives the live stream overlay uses (white-on-black labels are
 * channel-symmetric, so they read correctly on the RGBA screenshot path).
 */
export async function captureScreenshot(
  emu: N64Emulator,
  opts: {
    path: string;
    names?: (string | null)[];
    screenMode?: ScreenMode;
    seats?: number;
  },
): Promise<void> {
  const frame = emu.renderFrame();
  if (frame.height === 0)
    throw new Error("captureScreenshot: no frame rendered yet");

  if (opts.names !== undefined && opts.screenMode !== undefined) {
    const renderer = createLabelRenderer(
      Bun.env["WASM_DIR"] ?? "assets/n64wasm",
    );
    const rects = viewportRects(
      opts.screenMode,
      opts.seats ?? MAX_SEATS,
      WIDTH,
      frame.height,
    );
    const view = { data: frame.rgba, width: WIDTH, height: frame.height };
    const maxLabelWidth = Math.floor(WIDTH / 2);
    for (const [seat, rect] of rects.entries()) {
      const name = opts.names[seat];
      if (name == null || name.length === 0) continue;
      const label = await renderer(name, maxLabelWidth);
      const position = labelPosition(rect, label);
      blitBgra(view, label, position.x, position.y);
    }
  }

  await Bun.write(
    opts.path,
    encodePng(frame.rgba, frame.width, frame.height, 2),
  );
}
