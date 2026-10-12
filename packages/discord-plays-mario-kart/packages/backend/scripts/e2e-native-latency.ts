// Local e2e: measure the game's own input-to-picture latency. The retired wasm
// emulator took 5–6 VIs (1P) to 3–14 VIs (4P) by the same differential method.
//
// Phase 1 (lockstep, game latency): two instances are driven identically from
// boot into a race and held on the throttle. Their pictures must stay
// byte-identical; then one steers. The first draw whose picture differs is the
// game's visible response, counted in game frames from the frame that latched
// the input (0 = that frame's own draw). Each trial uses a fresh pair with a
// different settle length so the response is sampled at several race states.
//
// Phase 2 (paced, wall clock): one instance runs at real speed. The harness
// changes the input at random times and measures send -> first frame whose
// game frame latched it (latch wait + logic + render + readback + socket), plus
// frame cadence and per-frame render cost.
//
// press -> frame out = phase 2 send->frame + phase 1 response frames x frame time.
//
// Usage:
//   bun run scripts/e2e-native-latency.ts [--seats 1|2|3|4] [--fps 30|60]
//     [--trials 4] [--paced-seconds 10] [--out <dir>] [--json <file>]
//
// Needs `bun run --cwd ../.. build:spaghetti` (and therefore the ROM), so it is
// never a CI test.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { encodePng } from "@shepherdjerred/discord-plays-core/image/png.ts";
import { bgraToRgba } from "#src/engine/spaghetti/engine.ts";
import { SpaghettiHost } from "#src/engine/spaghetti/host.ts";
import {
  N64_BUTTON,
  NEUTRAL_PAD,
  type Pad,
} from "#src/engine/spaghetti/protocol.ts";
import {
  LockstepGroup,
  createMenuPolicy,
  isRacing,
  toGameState,
  type Draw,
  type GameState,
} from "./lib/native-driver.ts";
import { loadDevSpaghettiBuild } from "./lib/spaghetti-dev.ts";

const { values } = parseArgs({
  options: {
    seats: { type: "string", default: "1" },
    fps: { type: "string", default: "30" },
    trials: { type: "string", default: "4" },
    "paced-seconds": { type: "string", default: "10" },
    out: { type: "string" },
    json: { type: "string" },
    rom: { type: "string" },
  },
});

const seats = Number(values.seats);
const outputFps = Number(values.fps);
const trials = Number(values.trials);
const pacedSeconds = Number(values["paced-seconds"]);
if (![1, 2, 3, 4].includes(seats)) throw new Error("--seats must be 1..4");
if (outputFps !== 30 && outputFps !== 60)
  throw new Error("--fps must be 30 or 60");
const fps: 30 | 60 = outputFps;
const GAME_FRAME_MS = 1000 / 30;

const outDir = path.resolve(
  values.out ?? `.cache/native-latency/${String(seats)}p-${String(fps)}fps`,
);
await mkdir(outDir, { recursive: true });
const build = await loadDevSpaghettiBuild(values.rom);

/** Frames of held throttle after "GO" before measuring, plus per-trial offset. */
const SETTLE_FRAMES = 90;
const TRIAL_OFFSET_FRAMES = 7;
const RESPONSE_WINDOW = 30;
/** A pixel "moved" when any channel changes by more than this. */
const PIXEL_THRESHOLD = 48;
const CHANGED_PIXELS = 500;
const NAV_TIMEOUT_FRAMES = 3000;

function throttle(steer: number): Pad[] {
  return Array.from({ length: 4 }, (_, seat) =>
    seat < seats
      ? { button: N64_BUTTON.a, stickX: seat === 0 ? steer : 0, stickY: 0 }
      : NEUTRAL_PAD,
  );
}

function changedPixels(a: Buffer, b: Buffer): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > PIXEL_THRESHOLD ||
      Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) > PIXEL_THRESHOLD ||
      Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)) > PIXEL_THRESHOLD
    ) {
      changed++;
    }
  }
  return changed;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] ?? Number.NaN;
}

function stats(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean =
    sorted.reduce((sum, v) => sum + v, 0) / Math.max(1, sorted.length);
  return {
    n: sorted.length,
    mean,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? Number.NaN,
  };
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-");

async function savePng(name: string, draw: Draw): Promise<void> {
  await Bun.write(
    path.join(outDir, name),
    encodePng(bgraToRgba(draw.bgra), draw.width, draw.height),
  );
}

/** Drives a lockstep group from boot to "GO" with identical input. */
async function navigateToRace(
  group: LockstepGroup,
  count: number,
): Promise<GameState> {
  const policy = createMenuPolicy(seats);
  let pads: Pad[] = Array.from({ length: 4 }, () => NEUTRAL_PAD);
  for (let i = 0; i < NAV_TIMEOUT_FRAMES; i++) {
    const results = await group.step(Array.from({ length: count }, () => pads));
    const state = results[0]?.state;
    if (!state) throw new Error("no state from instance 0");
    if (isRacing(state) && state.playerCountSelection === seats) return state;
    pads = policy(state);
  }
  throw new Error(
    `did not reach a ${String(seats)}P race in ${String(NAV_TIMEOUT_FRAMES)} frames`,
  );
}

type Trial = {
  settle: number;
  divergedDuringSettle: boolean;
  responseFrames: number | undefined;
  responseDraw: number | undefined;
  changed: number;
};

const renderUs: number[] = [];

function drawsIdentical(a: readonly Draw[], b: readonly Draw[]): boolean {
  return (
    a.length === b.length &&
    a.every((draw, d) => b[d]?.bgra.equals(draw.bgra) === true)
  );
}

/** Holds the throttle on both instances; false if their pictures ever diverge. */
async function settleIdentically(
  group: LockstepGroup,
  frames: number,
): Promise<boolean> {
  let identical = true;
  for (let i = 0; i < frames; i++) {
    const [a, b] = await group.step([throttle(0), throttle(0)]);
    if (!a || !b) throw new Error("missing step result");
    for (const draw of a.draws) renderUs.push(draw.latchToCaptureUs);
    identical &&= drawsIdentical(a.draws, b.draws);
  }
  return identical;
}

type Response = {
  frame: number;
  draw: number;
  changed: number;
  a: Draw;
  b: Draw;
};

function firstDivergence(
  frame: number,
  a: readonly Draw[],
  b: readonly Draw[],
): Response | undefined {
  for (const [d, da] of a.entries()) {
    const db = b[d];
    if (!db) continue;
    const changed = changedPixels(da.bgra, db.bgra);
    if (changed > CHANGED_PIXELS)
      return { frame, draw: d, changed, a: da, b: db };
  }
  return undefined;
}

/** Steers instance B only and returns the first draw whose picture differs from A's. */
async function findResponse(
  group: LockstepGroup,
): Promise<Response | undefined> {
  for (let frame = 0; frame < RESPONSE_WINDOW; frame++) {
    const [a, b] = await group.step([throttle(0), throttle(-80)]);
    if (!a || !b) throw new Error("missing step result");
    const response = firstDivergence(frame, a.draws, b.draws);
    if (response) return response;
  }
  return undefined;
}

async function runTrial(index: number): Promise<Trial> {
  const group = new LockstepGroup(
    build,
    path.join(outDir, `trial-${String(index)}`),
    2,
    fps,
  );
  await group.start();
  try {
    await navigateToRace(group, 2);
    const settle = SETTLE_FRAMES + index * TRIAL_OFFSET_FRAMES;
    const noResponse = {
      settle,
      responseFrames: undefined,
      responseDraw: undefined,
      changed: 0,
    };
    if (!(await settleIdentically(group, settle))) {
      return { ...noResponse, divergedDuringSettle: true };
    }
    const response = await findResponse(group);
    if (!response) return { ...noResponse, divergedDuringSettle: false };
    if (index === 0) {
      await savePng("response-baseline.png", response.a);
      await savePng("response-steered.png", response.b);
    }
    return {
      settle,
      divergedDuringSettle: false,
      responseFrames: response.frame,
      responseDraw: response.draw,
      changed: response.changed,
    };
  } finally {
    await group.stop();
  }
}

function describeTrial(trial: Trial): string {
  if (trial.divergedDuringSettle)
    return "NON-DETERMINISTIC (pictures diverged before steering)";
  return trial.responseFrames === undefined
    ? `no response within ${String(RESPONSE_WINDOW)} frames`
    : `response in frame +${String(trial.responseFrames)} (draw ${String(trial.responseDraw)}, ${String(trial.changed)} px)`;
}

print(
  `native latency: ${String(seats)}P, ${String(fps)} fps output, ${String(trials)} trials, ${String(pacedSeconds)} s paced`,
);

const trialResults: Trial[] = [];
for (let i = 0; i < trials; i++) {
  const trial = await runTrial(i);
  trialResults.push(trial);
  print(
    `  trial ${String(i)}: settle ${String(trial.settle)} → ${describeTrial(trial)}`,
  );
}

// ---- phase 2: paced ----
const pacedRun = path.join(outDir, "paced");
const sendTimes = new Map<number, number>();
const sendToFrameMs: number[] = [];
const drawIntervals: number[] = [];
const pacedRenderUs: number[] = [];
let lastDrawAt: number | undefined;
let lastDrawGameFrame: number | undefined;
const stalls: {
  gameFrame: number;
  gapMs: number;
  gameFramesSkipped: number;
  latchToCaptureMs: number;
}[] = [];
/** A draw gap this long is a visible hitch at either output rate. */
const STALL_MS = 50;
let latestSeqSeen = 0;
let racing = false;
let latestState: GameState | undefined;

await rm(pacedRun, { recursive: true, force: true });
const paced = new SpaghettiHost({
  build,
  homeDir: pacedRun,
  lockstep: true,
  outputFps: fps,
  onFrame: (frame) => {
    const receivedAtMs = performance.now();
    if (!racing) return;
    if (lastDrawAt !== undefined) {
      const gap = receivedAtMs - lastDrawAt;
      drawIntervals.push(gap);
      if (gap > STALL_MS) {
        stalls.push({
          gameFrame: frame.gameFrame,
          gapMs: gap,
          gameFramesSkipped:
            frame.gameFrame - (lastDrawGameFrame ?? frame.gameFrame) - 1,
          latchToCaptureMs: frame.latchToCaptureUs / 1000,
        });
      }
    }
    lastDrawAt = receivedAtMs;
    // Later draws of the same game frame include the pacing sleep between
    // draws; only the first draw measures latch -> render -> readback.
    if (frame.gameFrame !== lastDrawGameFrame)
      pacedRenderUs.push(frame.latchToCaptureUs);
    lastDrawGameFrame = frame.gameFrame;
    if (frame.latchedInputSeq > latestSeqSeen) {
      for (let seq = latestSeqSeen + 1; seq <= frame.latchedInputSeq; seq++) {
        const sentAt = sendTimes.get(seq);
        // Only the newest input in a frame is "seen"; older ones it superseded
        // were never latched on their own and are dropped from the sample.
        if (sentAt !== undefined && seq === frame.latchedInputSeq) {
          sendToFrameMs.push(receivedAtMs - sentAt);
        }
        sendTimes.delete(seq);
      }
      latestSeqSeen = frame.latchedInputSeq;
    }
  },
  onState: (message) => {
    latestState = toGameState(message);
  },
});

await paced.start();
// Lockstep to the race, then hand pacing to the game's own clock.
const policy = createMenuPolicy(seats);
let pads: Pad[] = Array.from({ length: 4 }, () => NEUTRAL_PAD);
// The boot path latches once before the loop and emits no state for it.
paced.sendInput(pads);
paced.step(1);
let stepped = 1;
for (;;) {
  paced.sendInput(pads);
  paced.step(1);
  stepped++;
  while ((latestState?.gameFrame ?? 0) < stepped) {
    if (paced.exited) throw paced.exited;
    await Bun.sleep(0);
  }
  const state = latestState;
  if (!state) continue;
  if (isRacing(state) && state.playerCountSelection === seats) break;
  if (stepped > NAV_TIMEOUT_FRAMES)
    throw new Error("paced instance did not reach the race");
  pads = policy(state);
}
paced.sendInput(throttle(0));
paced.runPaced();
await Bun.sleep(1000);
racing = true;
const steerValues = [-80, 0, 80, 0];
const pacedUntil = performance.now() + pacedSeconds * 1000;
let steerIndex = 0;
while (performance.now() < pacedUntil) {
  await Bun.sleep(150 + Math.random() * 200);
  const seq = paced.sendInput(
    throttle(steerValues[steerIndex % steerValues.length] ?? 0),
  );
  sendTimes.set(seq, performance.now());
  steerIndex++;
}
await Bun.sleep(200);
await paced.stop();

// ---- report ----
const responded = trialResults.filter((t) => t.responseFrames !== undefined);
const responseFrames = responded.map((t) => t.responseFrames ?? 0);
const responseStats = stats(responseFrames);
const sendToFrame = stats(sendToFrameMs);
const intervals = stats(drawIntervals);
const lockstepRender = stats(renderUs.map((us) => us / 1000));
const pacedRender = stats(pacedRenderUs.map((us) => us / 1000));
const drawsPerSecond =
  drawIntervals.length /
  Math.max(1e-9, drawIntervals.reduce((s, v) => s + v, 0) / 1000);

const pressToFrame = {
  p50: sendToFrame.p50 + responseStats.p50 * GAME_FRAME_MS,
  p95: sendToFrame.p95 + responseStats.max * GAME_FRAME_MS,
};

print("\ngame response (lockstep, frames after the latching frame)");
print(
  `  ${String(responded.length)}/${String(trialResults.length)} trials responded; ` +
    `mean ${fmt(responseStats.mean)} p50 ${fmt(responseStats.p50)} max ${fmt(responseStats.max)} game frames`,
);
print("paced (wall clock)");
print(
  `  send → latching frame out: p50 ${fmt(sendToFrame.p50)} ms, p95 ${fmt(sendToFrame.p95)} ms (n=${String(sendToFrame.n)})`,
);
print(
  `  draws: ${fmt(drawsPerSecond)}/s, interval p50 ${fmt(intervals.p50)} p95 ${fmt(intervals.p95)} max ${fmt(intervals.max)} ms`,
);
print(
  `  stalls > ${String(STALL_MS)} ms: ${String(stalls.length)}` +
    stalls
      .map(
        (st) =>
          ` [frame ${String(st.gameFrame)}: ${fmt(st.gapMs)} ms gap, ${String(st.gameFramesSkipped)} frames skipped, render ${fmt(st.latchToCaptureMs)} ms]`,
      )
      .join(""),
);
print(
  `  render+readback per game frame: paced p50 ${fmt(pacedRender.p50)} p95 ${fmt(pacedRender.p95)} ms; lockstep p50 ${fmt(lockstepRender.p50)} p95 ${fmt(lockstepRender.p95)} ms`,
);
print(
  `press → first reflecting frame out (estimate): p50 ${fmt(pressToFrame.p50)} ms, p95 ${fmt(pressToFrame.p95)} ms`,
);

if (values.json !== undefined) {
  await Bun.write(
    values.json,
    JSON.stringify(
      {
        seats,
        fps,
        platform: `${process.platform}-${process.arch}`,
        trials: trialResults,
        responseFrames: responseStats,
        sendToFrameMs: sendToFrame,
        drawIntervalMs: intervals,
        drawsPerSecond,
        stalls,
        renderMs: { paced: pacedRender, lockstep: lockstepRender },
        pressToFrameMs: pressToFrame,
      },
      null,
      2,
    ),
  );
}

const nonDeterministic = trialResults.some((t) => t.divergedDuringSettle);
if (nonDeterministic || responded.length === 0) process.exitCode = 1;
