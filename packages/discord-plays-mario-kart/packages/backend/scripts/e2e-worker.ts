// Local e2e: prove the emulator actually boots and runs inside a Bun Worker.
//
// This is the load-bearing check for the worker-thread refactor
// (plans/2026-07-26_mk64-emulator-worker-thread.md): the whole design hinges on
// the emscripten wasm core detecting ENVIRONMENT_IS_NODE inside a Bun Worker
// (no `window`, `process` present, `importScripts` undefined) and on the
// frame/audio/snapshot/metric transport across the port working end to end.
//
// It boots the real WorkerEmulator facade (same path the driver uses), runs it
// paced at 30fps for a few seconds, and asserts:
//   - frames flow across the port (wasm booted + stepped in the worker),
//   - a decoded race snapshot arrives (RDRAM read happens in the worker),
//   - renderFrame() round-trips a real frame (request/response screenshot path),
//   - the metric bridge replays into the shared prom registry on the main thread.
//
// Not a CI test (needs the ROM + a built wasm core). Run locally:
//   bun run scripts/e2e-worker.ts [rom] [seconds] [outPng]
import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { WorkerEmulator } from "#src/emulator/worker/worker-emulator.ts";
import { MAX_SEATS } from "#src/emulator/constants.ts";
import { encodePng } from "#src/emulator/png.ts";
import { resolveRom } from "./lib/harness.ts";

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

await new Promise<void>((resolve) => {
  setTimeout(resolve, seconds * 1000);
});

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

if (failures.length > 0) {
  out("");
  out("FAIL:");
  for (const f of failures) out(`  - ${f}`);
  process.exit(1);
}

out("");
out("PASS — the emulator boots and runs inside the Bun Worker.");
