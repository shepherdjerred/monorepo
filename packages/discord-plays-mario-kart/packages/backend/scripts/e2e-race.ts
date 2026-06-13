// Local e2e: validate the MK64 RDRAM map (mk64-memory.ts) against a real ROM by
// streaming the parsed snapshot + raw core globals whenever they change. The
// title-screen attract demo loads real courses with CPU karts, so course ids,
// the endianness contract, and gamestate transitions validate without touching
// a controller; `start-mash` taps START to step through the menus.
//
// To drive into an actual (multiplayer) race and capture screenshots, use
// scripts/e2e-scenario.ts instead.
//
// Determinism: same (rom, schedule) -> identical frames (see e2e-input.ts).
// Needs a ROM (not in the repo) — run locally; never in CI.
import { bootEmulator, resolveRom } from "./lib/harness.ts";
import {
  readSnapshot,
  readS32,
  readS16,
  MK64_ADDR,
  COURSE_NAMES,
} from "#src/emulator/mk64-memory.ts";
import { EMPTY_BUTTONS } from "@discord-plays-mario-kart/common";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

// Usage: bun run scripts/e2e-race.ts [rom] [total-frames] [press]
//   press : none | start-mash   (default none)
const total = Number(process.argv.at(3) ?? 6000);
const press = process.argv.at(4) ?? "none";

const rom = await resolveRom(process.argv.at(2));
out(`[e2e-race] booting (rom=${rom})…`);
const emu = await bootEmulator({ rom, seats: 4 });

let frame = 0;
let lastLine = "";

await new Promise<void>((resolve) => {
  emu.onFrame(() => {
    frame++;

    if (press === "start-mash" && frame > 300) {
      // Tap START on alternating 30-frame windows to step through title/menus.
      const buttons = { ...EMPTY_BUTTONS, start: frame % 60 < 30 };
      emu.setPlayerInput(0, { buttons, analogX: 0, analogY: 0 });
    }

    const mem = emu.rdram();
    if (mem !== undefined && frame % 10 === 0) {
      const snap = readSnapshot(mem);
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

    if (frame >= total) {
      emu.stop();
      resolve();
    }
  });
  emu.start();
});

out(`[e2e-race] done after ${String(frame)} frames`);
process.exit(0);
