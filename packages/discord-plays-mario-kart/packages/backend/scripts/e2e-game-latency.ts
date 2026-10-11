// Local e2e: measure MK64's own input-to-picture latency in VIs, inside the
// emulator, with no encoder or network involved.
//
// Drives a race scenario, then snapshots the whole wasm heap. Every trial
// restores that snapshot, so each run replays the identical game state. A trial
// latches a steering input at VI `k`; the first VI whose framebuffer differs from
// the no-input baseline is the game's visible response. Repeating over a run of
// consecutive `k` covers every phase of the game's 30 Hz loop and both host
// emission parities.
//
// The core's VI filter adds low-amplitude noise to most pixels on every VI, so
// "new picture" means many pixels moving well beyond that noise.
//
// It also reports, from the baseline:
//   - which VIs carry new picture content, against which VIs the host emits
//     (`shouldEmitVideoFrame`), i.e. whether the fixed even-VI capture is in
//     phase with the game's buffer swaps;
//   - distinct game frames per second (MK64 drops below 30 in 3P/4P);
//   - per-VI emulate time.
//
// Usage:
//   bun run scripts/e2e-game-latency.ts [--rom <path>] [--seats 1|2|3|4]
//     [--trials 12] [--window 30]
//
// Not a CI test: needs the ROM, which is never in the repo.
import { parseArgs } from "node:util";
import { EMPTY_BUTTONS, EMPTY_INPUT } from "@discord-plays-mario-kart/common";
import type { PlayerInputState } from "@discord-plays-mario-kart/common";
import type { N64Emulator } from "#src/emulator/n64-emulator.ts";
import { VI_TICKS_PER_VIDEO_FRAME } from "#src/emulator/vi-timing.ts";
import { bootEmulator, driveUntil, resolveRom } from "./lib/harness.ts";
import { SCENARIOS } from "./lib/scenarios.ts";

const VI_MS = 1000 / 60;
/** VIs of held throttle after the race starts, so every kart is moving. */
const SETTLE_VIS = 600;

const { values } = parseArgs({
  options: {
    rom: { type: "string" },
    seats: { type: "string", default: "1" },
    trials: { type: "string", default: "12" },
    window: { type: "string", default: "30" },
  },
});
const seats = Number(values.seats);
const trials = Number(values.trials);
const windowVis = Number(values.window);
const scenario = SCENARIOS[`${String(seats)}p`];
if (scenario === undefined)
  throw new Error(`no scenario for ${String(seats)}p`);

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

const THROTTLE: PlayerInputState = {
  buttons: { ...EMPTY_BUTTONS, a: true },
  analogX: 0,
  analogY: 0,
};
const THROTTLE_AND_STEER: PlayerInputState = { ...THROTTLE, analogX: 1 };

/**
 * The framebuffer with each pixel's R/B pair ordered, so it is a function of
 * the picture alone.
 *
 * `get_video_buffer` swaps R and B in place on every call, so the same picture
 * reads back in either order depending on how many times it was fetched this VI.
 */
function canonicalPicture(rgba: Buffer): Buffer {
  const canonical = Buffer.allocUnsafe(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0;
    const b = rgba[i + 2] ?? 0;
    canonical[i] = Math.min(r, b);
    canonical[i + 1] = rgba[i + 1] ?? 0;
    canonical[i + 2] = Math.max(r, b);
    canonical[i + 3] = 0;
  }
  return canonical;
}

/**
 * Pixels whose summed channel difference exceeds what the VI filter's per-VI
 * noise produces. The noise touches most pixels every VI but by only a level or
 * two; new game content moves tens of levels.
 */
const CONTENT_DIFF_THRESHOLD = 48;
/** Pixels that must change by more than the threshold to count as a new picture. */
const NEW_CONTENT_MIN_PIXELS = 500;

function contentChangedPixels(a: Buffer, b: Buffer): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d =
      Math.abs((a[i] ?? 0) - (b[i] ?? 0)) +
      Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) +
      Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
    if (d > CONTENT_DIFF_THRESHOLD) changed += 1;
  }
  return changed;
}

type ViRecord = {
  hash: bigint;
  /** The game produced a new picture this VI (not just VI-filter noise). */
  newContent: boolean;
  emitted: boolean;
  emulateMs: number;
};

function heapOf(emu: N64Emulator): Uint8Array {
  const mem = emu.rdram();
  if (mem === undefined) throw new Error("emulator heap is not available");
  return mem.heap;
}

/** Run `count` VIs from the snapshot, choosing P1's input per VI. */
function runFromSnapshot(
  emu: N64Emulator,
  snapshot: Uint8Array,
  count: number,
  p1Input: (vi: number) => PlayerInputState,
): ViRecord[] {
  heapOf(emu).set(snapshot);
  const records: ViRecord[] = [];
  let previous = canonicalPicture(emu.renderFrame().rgba);
  let emitted: boolean;
  emu.onFrame(() => {
    emitted = true;
  });
  for (let vi = 0; vi < count; vi++) {
    emu.setPlayerInput(0, p1Input(vi));
    for (let seat = 1; seat < seats; seat++) emu.setPlayerInput(seat, THROTTLE);
    emitted = false;
    const start = performance.now();
    emu.step();
    const emulateMs = performance.now() - start;
    const picture = canonicalPicture(emu.renderFrame().rgba);
    records.push({
      hash: BigInt(Bun.hash(picture)),
      newContent:
        contentChangedPixels(picture, previous) >= NEW_CONTENT_MIN_PIXELS,
      emitted,
      emulateMs,
    });
    previous = picture;
  }
  return records;
}

function quantile(sorted: number[], q: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? NaN
  );
}

const rom = await resolveRom(values.rom);
out(`[latency] booting ${String(seats)}P (rom path resolved)…`);
const emu = await bootEmulator({ rom, seats });
await driveUntil(emu, {
  seats,
  schedule: scenario.schedule,
  until: scenario.until,
  timeoutFrames: scenario.timeoutFrames,
});
out(`[latency] racing; holding throttle for ${String(SETTLE_VIS)} VIs…`);
for (let vi = 0; vi < SETTLE_VIS; vi++) {
  for (let seat = 0; seat < seats; seat++) emu.setPlayerInput(seat, THROTTLE);
  emu.step();
}
// The constructor copies the whole wasm heap; the core's entire state lives there.
const snapshot = new Uint8Array(heapOf(emu));

const span = trials + windowVis;
const baseline = runFromSnapshot(emu, snapshot, span, () => THROTTLE);
const replay = runFromSnapshot(emu, snapshot, span, () => THROTTLE);
const deterministic = baseline.every((r, i) => r.hash === replay[i]?.hash);
out(`[latency] replay deterministic: ${String(deterministic)}`);
if (!deterministic) {
  throw new Error(
    "heap restore did not reproduce the baseline; results would be meaningless",
  );
}

// ---- game's response to input ----
const responseVis: number[] = [];
const emittedResponseVis: number[] = [];
for (let k = 0; k < trials; k++) {
  const run = runFromSnapshot(emu, snapshot, span, (vi) =>
    vi >= k ? THROTTLE_AND_STEER : THROTTLE,
  );
  const first = run.findIndex(
    (r, vi) => vi >= k && r.hash !== baseline[vi]?.hash,
  );
  if (first === -1) {
    out(
      `[latency]   k=${String(k)}: no visible response within ${String(windowVis)} VIs`,
    );
    continue;
  }
  // Counted inclusively: the input is latched at the start of VI k.
  const visible = first - k + 1;
  const emittedAt = run.findIndex((r, vi) => vi >= first && r.emitted);
  const emittedVisible = emittedAt === -1 ? NaN : emittedAt - k + 1;
  responseVis.push(visible);
  emittedResponseVis.push(emittedVisible);
  out(
    `[latency]   k=${String(k)} (${baseline[k]?.emitted === true ? "emit" : "skip"} VI): ` +
      `picture changes after ${String(visible)} VIs, host emits it after ${String(emittedVisible)} VIs`,
  );
}

// ---- swap phase and game frame rate, from the baseline ----
let changes = 0;
let changesOnEmitVi = 0;
for (const record of baseline) {
  if (!record.newContent) continue;
  changes += 1;
  if (record.emitted) changesOnEmitVi += 1;
}
const seconds = (baseline.length * VI_MS) / 1000;

const emulate = baseline.map((r) => r.emulateMs).sort((a, b) => a - b);
const response = [...responseVis].sort((a, b) => a - b);
const emittedResponse = emittedResponseVis
  .filter((v) => !Number.isNaN(v))
  .sort((a, b) => a - b);
const meanMs = (vis: number[]) =>
  (vis.reduce((a, b) => a + b, 0) / Math.max(vis.length, 1)) * VI_MS;

out("");
out(
  `[latency] ${String(seats)}P summary (${String(response.length)}/${String(trials)} trials responded)`,
);
out(
  `[latency]   picture response: min ${String(response[0])} VIs, median ${String(quantile(response, 0.5))} VIs, ` +
    `mean ${meanMs(response).toFixed(1)} ms`,
);
out(
  `[latency]   as emitted by host: min ${String(emittedResponse[0])} VIs, median ${String(quantile(emittedResponse, 0.5))} VIs, ` +
    `mean ${meanMs(emittedResponse).toFixed(1)} ms ` +
    `(emission-parity cost ${(meanMs(emittedResponse) - meanMs(response)).toFixed(1)} ms)`,
);
out(
  `[latency]   new picture content on ${String(changes)} VIs (${(changes / seconds).toFixed(1)} game fps); ` +
    `${String(changesOnEmitVi)} of them on VIs the host emits ` +
    `(host emits every ${String(VI_TICKS_PER_VIDEO_FRAME)} VIs)`,
);
out(
  `[latency]   emulate per VI: p50 ${quantile(emulate, 0.5).toFixed(1)} ms, p95 ${quantile(emulate, 0.95).toFixed(1)} ms ` +
    `(budget ${VI_MS.toFixed(1)} ms)`,
);
for (let seat = 0; seat < seats; seat++) emu.setPlayerInput(seat, EMPTY_INPUT);
process.exit(0);
