// Local e2e: validate the MK64 RDRAM map (mk64-memory.ts) against a real ROM.
//
// Boots the real N64Emulator and logs the parsed Mk64Snapshot whenever any
// interesting field changes (plus the raw core globals for debugging). The
// title-screen attract demo loads real courses with CPU karts, so course ids,
// the endianness contract, and gamestate transitions can all be validated
// without ever touching a controller. With `press=start-mash` it also drives
// past the title screen so menu gamestates are observable.
//
// Determinism: same (rom, schedule) -> same frames, as in e2e-input.ts.
//
// Usage:
//   bun run scripts/e2e-race.ts <rom> [total-frames] [press]
//     press : none | start-mash   (default none)
//   DUMP_EVERY=300 bun run scripts/e2e-race.ts <rom> 5000   # also dump PNGs
//
// Not a CI test (needs a ROM, which is not in the repo). Run locally.
import { N64Emulator } from "#src/emulator/n64-emulator.ts";
import {
  readSnapshot,
  readS32,
  readS16,
  MK64_ADDR,
  COURSE_NAMES,
} from "#src/emulator/mk64-memory.ts";
import type { ScreenMode } from "#src/emulator/mk64-memory.ts";
import { encodePng } from "#src/emulator/png.ts";
import { NameOverlay } from "#src/overlay/name-overlay.ts";
import { createLabelRenderer } from "#src/overlay/label-renderer.ts";
import { EMPTY_BUTTONS } from "@discord-plays-mario-kart/common";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

const rom = process.argv.at(2);
const total = Number(process.argv.at(3) ?? 6000);
const press = process.argv.at(4) ?? "none";
if (rom === undefined || rom === "") {
  throw new Error("usage: e2e-race.ts <rom> [total-frames] [press]");
}

const emu = new N64Emulator({
  wasmDir: Bun.env.WASM_DIR ?? "assets/n64wasm",
  romPath: rom,
  fps: 1000, // sprint; pacing only, emulation is per-tick deterministic
  software: true,
  seats: 4,
});

out(`[e2e-race] booting (rom=${rom})…`);
await emu.init();

const dumpEvery = Number(Bun.env.DUMP_EVERY ?? 0);
// OVERLAY=1: burn demo player names into the dumped PNGs (white-on-black
// labels are channel-symmetric, so they read correctly on the RGBA screenshot
// path too) — produces the leaderboard name-overlay screenshots for review.
const overlayEnabled = Bun.env.OVERLAY === "1";
const overlay = overlayEnabled
  ? new NameOverlay(createLabelRenderer(Bun.env.WASM_DIR ?? "assets/n64wasm"))
  : undefined;
if (overlay) {
  overlay.setName(0, "Jerred");
  overlay.setName(1, "Alice");
  overlay.setName(2, "Bob");
  overlay.setName(3, "Carol");
}
let frame = 0;
let lastLine = "";
let latestMode: ScreenMode = "1p";

await new Promise<void>((resolve) => {
  emu.onFrame(() => {
    frame++;

    if (press === "start-mash" && frame > 300) {
      // Tap START on alternating 30-frame windows to step through title/menus.
      const buttons = { ...EMPTY_BUTTONS, start: frame % 60 < 30 };
      emu.setPlayerInput(0, { buttons, analogX: 0, analogY: 0 });
    } else if (press === "race-nav" && frame > 300) {
      // Drive the menus into a real race on defaults (Mario GP -> 50cc ->
      // Mario -> Luigi Raceway): START taps past the title, then A taps to
      // confirm every screen, then hold A to accelerate once racing.
      const tap = frame % 60 < 15;
      const buttons = {
        ...EMPTY_BUTTONS,
        start: frame < 600 && tap,
        a: frame >= 600 && (frame >= 3000 || tap),
      };
      emu.setPlayerInput(0, { buttons, analogX: 0, analogY: 0 });
    }

    const mem = emu.rdram();
    if (mem !== undefined && frame % 10 === 0) {
      const snap = readSnapshot(mem);
      latestMode = snap.screenMode;
      const gamestate = readS32(mem, MK64_ADDR.gGamestate);
      const phase = readS32(mem, MK64_ADDR.racePhase);
      const courseRaw = readS16(mem, MK64_ADDR.gCurrentCourseId);
      const players = snap.players
        .map(
          (p, i) =>
            `P${String(i + 1)}[${p.present ? (p.human ? "H" : "C") : "-"} rank=${String(p.rank)} chr=${String(p.characterId)} fin=${p.finished ? "1" : "0"} t=${String(p.raceTimeMs)}ms]`,
        )
        .join(" ");
      const line =
        `state=${snap.raceState} gs=${String(gamestate)} phase=${String(phase)} ` +
        `mode=${snap.gameMode} screen=${snap.screenMode} humans=${String(snap.humanCount)} ` +
        `course=${String(courseRaw)}(${COURSE_NAMES[courseRaw] ?? "?"}) ${players}`;
      if (line !== lastLine) {
        out(`[e2e-race] f=${String(frame).padStart(5, "0")} ${line}`);
        lastLine = line;
      }
    }

    if (dumpEvery > 0 && frame % dumpEvery === 0) {
      const f = emu.renderFrame();
      if (overlay && f.height > 0) {
        overlay.apply(f.rgba, f.height, latestMode, 4);
      }
      void Bun.write(
        `/tmp/mk_race_${String(frame).padStart(5, "0")}.png`,
        encodePng(f.rgba, f.width, f.height, 2),
      );
    }

    if (frame >= total) {
      emu.stop();
      resolve();
    }
  });
  emu.start();
});

out(`[e2e-race] done after ${String(frame)} frames`);
process.exit(0);
