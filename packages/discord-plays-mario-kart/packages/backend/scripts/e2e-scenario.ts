// Manually-run MK64 harness: drive the headless emulator to a named scenario
// (1p/2p/3p/4p/menu), print the parsed game state, and optionally burn player
// names into a screenshot. Replaces the throwaway script used to make the
// 1p–4p leaderboard overlay screenshots.
//
// Usage:
//   bun run scripts/e2e-scenario.ts <scenario> [--rom path] [--shot out.png]
//                                   [--names a,b,c,d] [--watch]
//   bun run scripts/e2e-scenario.ts            # lists scenarios
//
// ROM resolution: --rom → MK64_ROM env → ~/syncthing/Sync/roms/mariokart64.z64.
// Needs a ROM (not in the repo), so it never runs in CI.
import {
  bootEmulator,
  captureScreenshot,
  driveUntil,
  resolveRom,
} from "./lib/harness.ts";
import { SCENARIOS } from "./lib/scenarios.ts";
import { COURSE_NAMES, CHARACTER_NAMES } from "#src/emulator/mk64-memory.ts";
import type { Mk64Snapshot } from "#src/emulator/mk64-memory.ts";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.at(i + 1);
};

const scenarioName = args.at(0);
const scenario =
  scenarioName !== undefined && !scenarioName.startsWith("--")
    ? SCENARIOS[scenarioName]
    : undefined;

if (scenario === undefined) {
  out(
    "usage: e2e-scenario.ts <scenario> [--rom path] [--shot out.png] [--names a,b,c,d] [--watch]",
  );
  out("scenarios:");
  for (const [name, s] of Object.entries(SCENARIOS)) {
    out(`  ${name.padEnd(6)} ${s.description}`);
  }
  process.exit(scenarioName === undefined ? 0 : 1);
}

const DEFAULT_NAMES = ["Jerred", "Alice", "Bob", "Carol"];
const names = (flag("--names")?.split(",") ?? DEFAULT_NAMES).slice(
  0,
  scenario.seats,
);
const shotPath = flag("--shot");
const watch = args.includes("--watch");

function describe(snap: Mk64Snapshot): string {
  const players = snap.players
    .map(
      (p, i) =>
        `P${String(i + 1)}[${p.present ? (p.human ? "H" : "C") : "-"} ` +
        `rank=${String(p.rank)} ${CHARACTER_NAMES[p.characterId] ?? "?"} ` +
        `fin=${p.finished ? "1" : "0"} ${String(p.raceTimeMs)}ms]`,
    )
    .join(" ");
  return (
    `state=${snap.raceState} mode=${snap.gameMode} screen=${snap.screenMode} ` +
    `humans=${String(snap.humanCount)} course=${String(snap.courseId)}` +
    `(${COURSE_NAMES[snap.courseId] ?? "?"}) ${players}`
  );
}

const rom = await resolveRom(flag("--rom"));
out(`[scenario] ${scenarioName ?? ""} — booting (rom=${rom})…`);
const emu = await bootEmulator({ rom, seats: scenario.seats });

let lastLine = "";
const { snapshot, frame } = await driveUntil(emu, {
  seats: scenario.seats,
  schedule: scenario.schedule,
  until: scenario.until,
  timeoutFrames: scenario.timeoutFrames,
  ...(watch
    ? {
        onTick: (snap: Mk64Snapshot, f: number) => {
          const line = describe(snap);
          if (line !== lastLine) {
            out(`f=${String(f).padStart(5, "0")} ${line}`);
            lastLine = line;
          }
        },
      }
    : {}),
});

out(`[scenario] reached at frame ${String(frame)}: ${describe(snapshot)}`);

if (shotPath !== undefined) {
  await captureScreenshot(emu, {
    path: shotPath,
    names,
    screenMode: snapshot.screenMode,
    seats: scenario.seats,
  });
  out(`[scenario] screenshot -> ${shotPath}`);
}

emu.stop();
process.exit(0);
