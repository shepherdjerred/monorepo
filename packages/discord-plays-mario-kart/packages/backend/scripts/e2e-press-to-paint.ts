// Press-to-paint on the driver feed, end to end, in a real browser.
//
// The glass harness measures capture-to-paint, which leaves out the game's own
// response to input. This one starts at the key press and ends at the first
// painted frame that shows the game responding:
//
//   keydown in the controller page -> Socket.IO -> controller dispatch ->
//   engine input latch -> game response -> overlay -> H.264 encode ->
//   WebSocket -> WebCodecs decode -> canvas paint
//
// It runs the same way against either engine, through the production session
// path for each (the wasm core's Worker, the native port's child process).
//
// The ruler is a hop (R, ShiftLeft on the page) with the kart parked on the
// grid: a parked kart does not react visibly to steering, and a moving scene
// buries a steer in motion, but a hop moves the camera by thousands of pixels
// in the frame that responds. Control trials with no press, interleaved with
// the real ones, measure how much a parked scene changes between paints on its
// own; a press counts as seen at the first paint of a change that is well
// beyond that and lasts at least three paints.
//
// Loopback, same machine: add network RTT for a remote player.
//
//   bun run e2e:press-to-paint [--engine n64wasm|spaghettikart] [--fps 30|60]
//     [--presses 20] [--rom <path>] [--port 8098] [--pinchtab <server url>]
//     [--json <path>]   (every trial's per-paint change series)
import os from "node:os";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  EMPTY_BUTTONS,
  EMPTY_INPUT,
  type ButtonState,
} from "@discord-plays-mario-kart/common";
import type { RaceState } from "#src/emulator/mk64-memory.ts";
import type { GameEngine } from "#src/engine/game-engine.ts";
import { parseEngineName, parseOutputFps } from "./lib/engines.ts";
import {
  evalInTab,
  openDriverTab,
  pinchtabCli,
  startFeedBench,
} from "./lib/feed-bench.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    engine: { type: "string", default: "n64wasm" },
    fps: { type: "string", default: "30" },
    presses: { type: "string", default: "20" },
    rom: { type: "string" },
    port: { type: "string", default: "8098" },
    pinchtab: { type: "string", default: "http://localhost:9867" },
    json: { type: "string" },
  },
});
const engineName = parseEngineName(values.engine);
const presses = Number(values.presses);
const port = Number(values.port);
if (!Number.isInteger(presses) || presses <= 0) {
  throw new Error(
    `--presses must be a positive integer, got ${values.presses}`,
  );
}
const pinchtab = values.pinchtab;

const NAV_TIMEOUT_MS = 240_000;
/** CPU karts leave the grid; the parked scene then barely moves. */
const SETTLE_MS = 12_000;
const WINDOW_MS = 600;

async function tap(
  engine: GameEngine,
  button: keyof ButtonState,
): Promise<void> {
  engine.setPlayerInput(0, {
    ...EMPTY_INPUT,
    buttons: { ...EMPTY_BUTTONS, [button]: true },
  });
  await Bun.sleep(150);
  engine.setPlayerInput(0, EMPTY_INPUT);
}

/**
 * Walk the menus into a 1P Grand Prix by alternating START and A once a second
 * until the race is staging, then wait for "GO". Wall-clock rather than
 * frame-keyed, so it works for both engines' different boot paths; START
 * stops before the race so it can never pause it.
 */
async function driveToRace(engine: GameEngine): Promise<void> {
  const latest: { raceState: RaceState } = { raceState: "menu" };
  engine.onSnapshot((snapshot) => {
    latest.raceState = snapshot.raceState;
  });
  const deadline = performance.now() + NAV_TIMEOUT_MS;
  let taps = 0;
  while (latest.raceState !== "racing") {
    if (performance.now() > deadline) {
      throw new Error("did not reach a race in time");
    }
    if (latest.raceState === "menu") {
      await tap(engine, taps % 2 === 0 ? "start" : "a");
      taps++;
    }
    await Bun.sleep(850);
  }
}

// In-page: wrap drawImage so every painted feed frame is also drawn, 4x
// downscaled, into a small probe canvas and compared with the previous paint,
// below the HUD rows (the clock and the race timer change every frame). The
// downscale happens on the GPU and the readback is ~70 KB, so the probe does
// not slow the page's own painting. Counts blocks whose colour moved by more
// than 16. Alternates control and real trials.
function pageScript(trials: number): string {
  return `(() => {
  const canvas = document.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0) return "no canvas";
  const ctx = canvas.getContext("2d");
  const top = Math.round(canvas.height * 40 / 480);
  const probe = document.createElement("canvas");
  probe.width = Math.round(canvas.width / 4);
  probe.height = Math.round((canvas.height - top) / 4);
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  let previous = null;
  const state = { armed: null, trials: [] };
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    const result = drawImage.apply(this, args);
    if (this !== ctx) return result;
    const at = performance.now();
    drawImage.call(probeCtx, canvas, 0, top, canvas.width, canvas.height - top,
      0, 0, probe.width, probe.height);
    const now = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
    let changed = 0;
    if (previous !== null) {
      for (let i = 0; i < now.length; i += 4) {
        if (Math.abs(now[i] - previous[i]) > 16 ||
            Math.abs(now[i + 1] - previous[i + 1]) > 16 ||
            Math.abs(now[i + 2] - previous[i + 2]) > 16) changed++;
      }
    }
    previous = now;
    const armed = state.armed;
    if (armed !== null) armed.paints.push([at - armed.t0, changed]);
    return result;
  };
  const key = (type) => globalThis.dispatchEvent(
    new KeyboardEvent(type, { code: "ShiftLeft", key: "Shift", bubbles: true }));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  globalThis.__pressToPaint = { done: false, trials: state.trials };
  (async () => {
    for (let i = 0; i < ${String(trials * 2)}; i++) {
      const press = i % 2 === 1;
      await sleep(1400 + Math.random() * 400);
      state.armed = { t0: performance.now(), paints: [] };
      if (press) key("keydown");
      await sleep(250);
      if (press) key("keyup");
      await sleep(${String(WINDOW_MS - 250)});
      state.trials.push({ press, paints: state.armed.paints });
      state.armed = null;
    }
    globalThis.__pressToPaint.done = true;
  })();
  return "started";
})()`;
}

const ResultSchema = z.object({
  done: z.boolean(),
  trials: z.array(
    z.object({
      press: z.boolean(),
      paints: z.array(z.tuple([z.number(), z.number()])),
    }),
  ),
});

function percentile(sorted: readonly number[], fraction: number): number {
  return (
    sorted[Math.min(Math.floor(fraction * sorted.length), sorted.length - 1)] ??
    Number.NaN
  );
}

type Trial = z.infer<typeof ResultSchema>["trials"][number];

/** Paints in a row that must exceed the threshold. */
const SUSTAIN_PAINTS = 3;

/**
 * The first paint that starts a sustained change: it and the next two paints
 * all exceed the threshold. A hop changes the picture for ~250 ms; the parked
 * scene's own spikes (keyframes, a passing kart) mostly last one paint.
 */
function firstSustainedChange(
  paints: Trial["paints"],
  threshold: number,
): Trial["paints"][number] | undefined {
  for (let i = 0; i + SUSTAIN_PAINTS <= paints.length; i++) {
    const run = paints.slice(i, i + SUSTAIN_PAINTS);
    if (run.every(([, changed]) => changed > threshold)) return run[0];
  }
  return undefined;
}

/**
 * Threshold from the control windows: 1.5x the 90th percentile of their
 * per-paint change (a higher percentile lands on keyframe spikes, which come
 * twice as often at 60 fps). Reports how many control windows the detector
 * would have fired in anyway: the measurement's false-positive rate.
 */
function calibrate(trials: readonly Trial[]): {
  threshold: number;
  noiseP90: number;
  falsePositives: number;
  controls: readonly Trial[];
} {
  const controls = trials.filter((trial) => !trial.press);
  const changes = controls
    .flatMap((trial) => trial.paints.map(([, changed]) => changed))
    .sort((a, b) => a - b);
  const noiseP90 = percentile(changes, 0.9);
  const threshold = Math.max(Math.ceil(noiseP90 * 1.5), 100);
  const falsePositives = controls.filter(
    (trial) => firstSustainedChange(trial.paints, threshold) !== undefined,
  ).length;
  return { threshold, noiseP90, falsePositives, controls };
}

/** pinchtab eval, retried: a loaded browser briefly reports a tab busy. */
async function evalWithRetry(tab: string, script: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await evalInTab(pinchtab, tab, script);
    } catch (error) {
      if (attempt >= 10) throw error;
      await Bun.sleep(1000);
    }
  }
}

const bench = await startFeedBench({
  engine: engineName,
  rom: values.rom,
  fps: parseOutputFps(values.fps),
  port,
});
const { format } = bench.engine;
process.stdout.write(
  `${engineName}: ${String(format.width)}x${String(format.height)} at ${String(format.fps)} fps on http://localhost:${String(port)}; driving to a race\n`,
);

let tabId: string | undefined;
try {
  await driveToRace(bench.engine);
  process.stdout.write("racing; parking on the grid\n");
  tabId = await openDriverTab(pinchtab, port);
  await Bun.sleep(SETTLE_MS);

  const started = await evalInTab(pinchtab, tabId, pageScript(presses));
  if (started !== "started") throw new Error(`page script: ${String(started)}`);
  let result: z.infer<typeof ResultSchema>;
  for (;;) {
    await Bun.sleep(2000);
    result = ResultSchema.parse(
      JSON.parse(
        z
          .string()
          .parse(
            await evalWithRetry(
              tabId,
              "JSON.stringify(globalThis.__pressToPaint)",
            ),
          ),
      ),
    );
    if (result.done) break;
  }

  if (values.json !== undefined) {
    await Bun.write(values.json, JSON.stringify(result.trials));
  }
  const { threshold, noiseP90, falsePositives, controls } = calibrate(
    result.trials,
  );
  const latencies: number[] = [];
  const signals: number[] = [];
  let missed = 0;
  for (const trial of result.trials.filter((t) => t.press)) {
    const seen = firstSustainedChange(trial.paints, threshold);
    if (seen === undefined) {
      missed++;
      continue;
    }
    latencies.push(seen[0]);
    signals.push(seen[1]);
  }
  latencies.sort((a, b) => a - b);
  signals.sort((a, b) => a - b);
  const paintsPerControl =
    controls.reduce((sum, trial) => sum + trial.paints.length, 0) /
    Math.max(1, controls.length);
  const fmt = (ms: number) => ms.toFixed(1);
  process.stdout.write(
    [
      "",
      `engine:          ${engineName} (${String(format.fps)} fps)`,
      `presses:         ${String(latencies.length)} seen, ${String(missed)} missed`,
      `press -> paint:  p50 ${fmt(percentile(latencies, 0.5))} ms  p95 ${fmt(percentile(latencies, 0.95))} ms  min ${fmt(percentile(latencies, 0))} ms  max ${fmt(percentile(latencies, 1))} ms`,
      `detection:       control p90 ${String(noiseP90)} changed blocks, threshold ${String(threshold)}, signal at detection p50 ${String(percentile(signals, 0.5))}`,
      `false positives: ${String(falsePositives)} of ${String(controls.length)} control windows`,
      `paints/window:   ${paintsPerControl.toFixed(1)} in ${String(WINDOW_MS)} ms`,
      `load average:    ${os
        .loadavg()
        .map((load) => load.toFixed(1))
        .join(" ")}`,
      "",
    ].join("\n"),
  );
} finally {
  await bench.stop();
  if (tabId !== undefined) await pinchtabCli(pinchtab, ["tab", "close", tabId]);
}
process.exit(0);
