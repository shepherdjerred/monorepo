// Local e2e: prove the emulator actually boots and runs inside a Bun Worker.
//
// This is the load-bearing check for the worker-thread refactor
// (plans/2026-07-26_mk64-emulator-worker-thread.md): the whole design hinges on
// the emscripten wasm core detecting ENVIRONMENT_IS_NODE inside a Bun Worker
// (no `window`, `process` present, `importScripts` undefined) and on the
// frame/audio/snapshot/metric transport across the port working end to end.
//
// It boots the real WorkerEmulator facade (same path the driver uses), runs it
// paced at 30fps for a few seconds under high-rate controller spam, and asserts:
//   - frames flow across the port (wasm booted + stepped in the worker),
//   - a decoded race snapshot arrives (RDRAM read happens in the worker),
//   - renderFrame() round-trips a real frame (request/response screenshot path),
//   - the metric bridge replays into the shared prom registry on the main thread,
//   - controller spam through the facade (main → postMessage → Zod parse →
//     worker tick) still latches inputs AND keeps frames flowing — the
//     worker-boundary equivalent of e2e-perf's in-process spam scenarios, which
//     drive N64Emulator directly and so cannot detect port-queue growth or
//     tick-timer starvation across the Worker boundary.
//
// Not a CI test (needs the ROM + a built wasm core). Run locally:
//   bun run scripts/e2e-worker.ts [rom] [seconds] [outPng]
import { z } from "zod";
import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { WorkerEmulator } from "#src/emulator/worker/worker-emulator.ts";
import { MAX_SEATS } from "#src/emulator/constants.ts";
import { encodePng } from "#src/emulator/png.ts";
import { EMPTY_BUTTONS } from "@discord-plays-mario-kart/common";
import { resolveRom } from "./lib/harness.ts";

// prom-client's getMetricsAsJSON() value shape carries `metricName` for
// histogram components (`_bucket`/`_count`/`_sum`), but its TS type omits it —
// parse the values we read so `metricName` is typed.
const MetricValuesSchema = z.array(
  z.object({ metricName: z.string().optional(), value: z.number() }),
);

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

const rom = await resolveRom(process.argv.at(2));
const seconds = Number(process.argv.at(3) ?? 5);
const outPng = process.argv.at(4) ?? "/tmp/mk64-worker.png";
const fps = 30;
const snapshotEveryNFrames = 10;

let frames = 0;
let audioChunks = 0;
let snapshots = 0;
let lastHeight = 0;

const emu = new WorkerEmulator({
  wasmDir: Bun.env["WASM_DIR"] ?? "assets/n64wasm",
  romPath: rom,
  fps,
  software: true,
  seats: MAX_SEATS,
  snapshotEveryNFrames,
});

emu.onFrame((frame) => {
  frames += 1;
  lastHeight = frame.height;
});
emu.onAudio(() => {
  audioChunks += 1;
});
emu.onSnapshot(() => {
  snapshots += 1;
});

out(`booting WorkerEmulator (rom=${rom})…`);
await emu.init();
out("worker ready; running…");
emu.start();

// Worker-boundary controller spam: hammer setPlayerInput through the facade
// every 1ms per seat (main → postMessage → Zod parse → worker tick). This is
// the exact path prod controller traffic takes and the one e2e-perf's spam
// scenarios bypass by driving N64Emulator in-process. If it grew the worker
// port queue or starved the tick timer, the frame count below would fall short;
// the input-apply metric confirms the spammed inputs actually latched in ticks.
let spamPhase = false;
const spamTimer = setInterval(() => {
  spamPhase = !spamPhase;
  for (let seat = 0; seat < MAX_SEATS; seat++) {
    emu.setPlayerInput(seat, {
      buttons: { ...EMPTY_BUTTONS, a: spamPhase, right: !spamPhase },
      analogX: spamPhase ? 0.6 : -0.6,
      analogY: 0,
    });
  }
}, 1);

await new Promise<void>((resolve) => {
  setTimeout(resolve, seconds * 1000);
});
clearInterval(spamTimer);

// Screenshot path: a request/response round-trip to the worker.
const shot = await emu.renderFrame();
await Bun.write(outPng, encodePng(shot.rgba, shot.width, shot.height, 2));

// Metric bridge: the worker batches observations and the main thread replays
// them into the shared registry. A non-zero emulator tick count proves the
// full worker→main metric path ran.
const metrics = await registry.getMetricsAsJSON();
const ticks = metrics.find((m) => m.name === "emulator_ticks_total");
const tickCount =
  ticks?.values.reduce(
    (sum, v) => sum + (typeof v.value === "number" ? v.value : 0),
    0,
  ) ?? 0;

// Input-apply observations prove the spammed controller inputs crossed the
// worker boundary and latched in a tick (the histogram is recorded worker-side
// at latch time and replayed to the main registry).
const applyHist = metrics.find(
  (m) => m.name === "emulator_input_apply_delay_ms",
);
const applyCount =
  applyHist === undefined
    ? 0
    : MetricValuesSchema.parse(applyHist.values)
        .filter((v) => v.metricName === "emulator_input_apply_delay_ms_count")
        .reduce((sum, v) => sum + v.value, 0);

await emu.stop();

const expectedFrames = Math.floor(seconds * fps * 0.5); // tolerate slow boot/pacing
out("");
out(
  `frames received     : ${String(frames)} (expected > ${String(expectedFrames)})`,
);
out(`audio chunks        : ${String(audioChunks)}`);
out(`snapshots received  : ${String(snapshots)}`);
out(`renderFrame result  : ${String(shot.width)}x${String(shot.height)}`);
out(`replayed tick count : ${String(tickCount)}`);
out(`input-apply samples : ${String(applyCount)} (under controller spam)`);
out(`last frame height   : ${String(lastHeight)}`);
out(`screenshot written  : ${outPng}`);

const failures: string[] = [];
if (frames <= expectedFrames)
  failures.push(
    `too few frames (${String(frames)} <= ${String(expectedFrames)})`,
  );
if (snapshots === 0) failures.push("no race snapshot arrived from the worker");
if (audioChunks === 0)
  failures.push("no audio arrived from the worker (silent stream)");
if (shot.width === 0 || shot.height === 0)
  failures.push("renderFrame() returned an empty frame");
if (tickCount === 0) failures.push("no metrics replayed from the worker");
if (applyCount === 0)
  failures.push(
    "no controller input latched in a worker tick (boundary spam not exercised)",
  );

if (failures.length > 0) {
  out("");
  out("FAIL:");
  for (const f of failures) out(`  - ${f}`);
  process.exit(1);
}

out("");
out("PASS — the emulator boots and runs inside the Bun Worker.");
