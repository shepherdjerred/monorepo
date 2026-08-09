// End-to-end check of the driver-feed pipeline: frames -> ffmpeg -> Annex-B
// splitter -> hub fan-out -> re-decode.
//
// Two modes. By default it feeds a generated gradient at the real cadence, so it
// needs no ROM and no GPU and can run anywhere ffmpeg is on PATH. With `--rom`
// it drives the actual N64Wasm emulator through the same overlay pipeline the
// Go-Live stream uses, which additionally proves the HUD clock the driver feed's
// latency readout depends on survives a real encode and decode.
//
//   bun run e2e:driver-feed [--seconds 3] [--hardware] [--rom <path>]

import { parseArgs } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decodeHudClock,
  type HudSampler,
} from "@discord-plays-mario-kart/common";
import { WIDTH, HEIGHT, N64_FPS } from "#src/emulator/constants.ts";
import {
  DriverFeedEncoder,
  driverFeedOutputSize,
} from "#src/driver-feed/encoder.ts";
import { DriverFeedHub, type FeedClient } from "#src/driver-feed/hub.ts";
import type { AccessUnit } from "#src/driver-feed/annex-b.ts";
import { WorkerEmulator } from "#src/emulator/worker/worker-emulator.ts";
import { applyStreamOverlays } from "#src/overlay/composite.ts";
import { resolveRom } from "./lib/harness.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seconds: { type: "string", default: "3" },
    hardware: { type: "boolean", default: false },
    rom: { type: "string" },
    "dump-frame": { type: "string" },
    // Encode at the Go-Live path's output size/bitrate instead, to isolate how
    // much of the encode leg is this feed's smaller frame rather than the box.
    "golive-profile": { type: "boolean", default: false },
  },
});

const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds <= 0) {
  throw new Error(`--seconds must be a positive number, got ${values.seconds}`);
}

const KEYFRAME_INTERVAL = 30;
const outputHeightPx = values["golive-profile"] ? 720 : 480;
const frameCount = Math.round(seconds * N64_FPS);
const frameBytes = WIDTH * HEIGHT * 4;

/** A moving gradient — real motion, so deltas are not degenerate. */
function syntheticFrame(index: number): Buffer {
  const frame = Buffer.alloc(frameBytes);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const at = (y * WIDTH + x) * 4;
      frame[at] = (x + index * 4) % 256;
      frame[at + 1] = (y + index * 2) % 256;
      frame[at + 2] = (x + y + index * 6) % 256;
      frame[at + 3] = 0xff;
    }
  }
  return frame;
}

const MS_PER_DAY = 86_400_000;
/** Every UTC time-of-day stamped into a frame, for the HUD round-trip check. */
const stampedMsOfDay = new Set<number>();

/**
 * Burn the HUD exactly as the session driver does, then record what was stamped.
 * The driver feed tees after this, so these are the pixels the browser decodes.
 */
function stampOverlay(
  frame: Buffer,
  height: number,
  seatActivity: readonly boolean[],
): void {
  const epochMs = Date.now();
  applyStreamOverlays(frame, height, {
    epochMs,
    seatActivity,
    mode: "1p",
    seats: 4,
    nameOverlay: undefined,
  });
  stampedMsOfDay.add(epochMs % MS_PER_DAY);
}

const units: AccessUnit[] = [];
/** Wall-clock time-of-day each access unit became available to the hub. */
const auReadyMsOfDay: number[] = [];
const received: Buffer[] = [];
const hub = new DriverFeedHub({
  maxClients: 4,
  maxClientBufferBytes: 4 * 1024 * 1024,
});
const client: FeedClient = {
  bufferedBytes: 0,
  send: (payload) => received.push(payload),
  close: () => {
    // The harness never disconnects its client.
  },
};
hub.add(client);

const encoder = new DriverFeedEncoder(
  {
    outputHeight: values["golive-profile"] ? 720 : 480,
    frameRate: N64_FPS,
    bitrateKbps: values["golive-profile"] ? 5000 : 2500,
    bitrateMaxKbps: values["golive-profile"] ? 8000 : 4000,
    keyframeIntervalFrames: KEYFRAME_INTERVAL,
    hardwareAcceleration: values.hardware,
    vaapiDevice: "/dev/dri/renderD128",
    encoderAsyncDepth: 1,
  },
  {
    onAccessUnit: (unit) => {
      // Same process clock as stampOverlay, so subtracting the two is exact —
      // no NTP skew, no cross-host correlation.
      auReadyMsOfDay.push(Date.now() % MS_PER_DAY);
      units.push(unit);
      hub.broadcast(unit);
    },
  },
);

const encoderLabel = values.hardware ? "vaapi" : "libx264";

if (values.rom === undefined) {
  process.stdout.write(
    `feeding ${String(frameCount)} synthetic ${String(WIDTH)}x${String(HEIGHT)} frames ` +
      `at ${String(N64_FPS)}fps (${encoderLabel})\n`,
  );
  encoder.start();
  const frameIntervalMs = 1000 / N64_FPS;
  for (let index = 0; index < frameCount; index++) {
    const frame = syntheticFrame(index);
    stampOverlay(frame, HEIGHT, [false, false, false, false]);
    encoder.pushFrame(frame);
    await Bun.sleep(frameIntervalMs);
  }
} else {
  const romPath = await resolveRom(values.rom);
  const wasmDir = path.join(import.meta.dir, "..", "assets", "n64wasm");
  const savesDir = await mkdtemp(path.join(tmpdir(), "mk64-driver-feed-"));
  process.stdout.write(
    `running the emulator for ${String(seconds)}s off ${romPath} (${encoderLabel})\n`,
  );
  const emulator = new WorkerEmulator({
    wasmDir,
    romPath,
    fps: N64_FPS,
    software: true,
    seats: 4,
    savesDir,
    snapshotEveryNFrames: 10,
  });
  await emulator.init();
  // Same per-frame pipeline as MarioKartGameDriver: overlay, then tee.
  emulator.onFrame((frame) => {
    stampOverlay(frame.rgba, frame.height, frame.seatActivity);
    encoder.pushFrame(frame.rgba);
  });
  encoder.start();
  emulator.start();
  await Bun.sleep(seconds * 1000);
  await emulator.stop();
  await rm(savesDir, { recursive: true, force: true });
}
// Let the encode pipeline drain before tearing the process down.
await Bun.sleep(500);
encoder.stop();
await Bun.sleep(200);

// ---- assertions ----

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};

const entryPoints = units.filter((unit) => unit.isDecoderEntryPoint);
const emptyUnits = units.filter((unit) => unit.bytes.length === 0);

check(units.length > 0, "no access units were produced at all");
// Allow slack at both ends: ffmpeg holds a little in flight and the sink may
// evict under scheduler jitter.
check(
  units.length >= frameCount * 0.8,
  `expected >=${String(Math.round(frameCount * 0.8))} access units, got ${String(units.length)}`,
);
check(
  emptyUnits.length === 0,
  `${String(emptyUnits.length)} empty access units`,
);
check(
  units[0]?.isDecoderEntryPoint === true,
  "the first access unit is not a decoder entry point, so a joining client could never start",
);
check(
  entryPoints.length >= Math.floor(units.length / KEYFRAME_INTERVAL),
  `expected a keyframe roughly every ${String(KEYFRAME_INTERVAL)} units, got ${String(entryPoints.length)} in ${String(units.length)}`,
);
check(
  received.length === units.length,
  `hub delivered ${String(received.length)} of ${String(units.length)} units to a healthy client`,
);
check(
  units.every((unit) => !unit.isKeyframe || unit.isDecoderEntryPoint),
  "a keyframe arrived without in-band SPS/PPS, so cold clients cannot start on it",
);

/**
 * Decode a byte range back through ffmpeg and count the frames it yields.
 *
 * This is the assertion that matters: it proves the splitter reassembles a
 * bitstream a decoder actually accepts, rather than one that merely looks
 * well-framed. Validating against a real decoder instead of against our own
 * parser is the point — the parser is the thing under test.
 */
async function decodeFrameCount(
  label: string,
  bitstream: Buffer,
): Promise<number> {
  const size = driverFeedOutputSize(outputHeightPx);
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "h264",
      "-i",
      "pipe:0",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "yuv420p",
      "pipe:1",
    ],
    { stdin: bitstream, stdout: "pipe", stderr: "pipe" },
  );
  const [decoded, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`ffmpeg decode failed (${String(exitCode)}): ${stderr}`);
  }
  if (stderr.trim().length > 0) {
    failures.push(`${label}: decoder reported errors: ${stderr.trim()}`);
  }
  // yuv420p is 1.5 bytes per pixel.
  const bytesPerFrame = size.width * size.height * 1.5;
  return Math.round(decoded.byteLength / bytesPerFrame);
}

const wholeStream = Buffer.concat(units.map((unit) => unit.bytes));
const wholeDecodedFrames = await decodeFrameCount("full stream", wholeStream);
check(
  wholeDecodedFrames === units.length,
  `full stream decoded ${String(wholeDecodedFrames)} frames from ${String(units.length)} access units`,
);

// A client that joins later is sent nothing until an entry point, then the live
// stream. Reproduce exactly that slice and confirm it decodes standalone.
const secondEntryAt = units.findIndex(
  (unit, index) => index > 0 && unit.isDecoderEntryPoint,
);
if (secondEntryAt === -1) {
  failures.push("no mid-stream entry point to test a late join against");
} else {
  const lateJoin = Buffer.concat(
    units.slice(secondEntryAt).map((unit) => unit.bytes),
  );
  const expected = units.length - secondEntryAt;
  const lateDecodedFrames = await decodeFrameCount("late join", lateJoin);
  check(
    lateDecodedFrames === expected,
    `late join at unit ${String(secondEntryAt)} decoded ${String(lateDecodedFrames)} frames, expected ${String(expected)}`,
  );
  process.stdout.write(
    `late join:      unit ${String(secondEntryAt)} -> ${String(lateDecodedFrames)} frames decoded\n`,
  );
}

/**
 * Decode to 8-bit greyscale so each byte is a luma sample, then read the HUD
 * clock out of the frames the way the browser reads it off its canvas.
 *
 * This is the check the unit tests cannot make: it runs against pixels that have
 * actually been through the scaler and a lossy encoder, not a simulated rescale.
 */
async function decodeLumaFrames(bitstream: Buffer): Promise<Buffer[]> {
  const out = driverFeedOutputSize(outputHeightPx);
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "h264",
      "-i",
      "pipe:0",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "pipe:1",
    ],
    { stdin: bitstream, stdout: "pipe", stderr: "pipe" },
  );
  const [decoded, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error("ffmpeg greyscale decode failed");
  const bytes = Buffer.from(decoded);
  const perFrame = out.width * out.height;
  const frames: Buffer[] = [];
  for (let at = 0; at + perFrame <= bytes.length; at += perFrame) {
    frames.push(bytes.subarray(at, at + perFrame));
  }
  return frames;
}

const lumaFrames = await decodeLumaFrames(wholeStream);
const outputSize = driverFeedOutputSize(outputHeightPx);
let clocksRead = 0;
const mismatched: number[] = [];
/** capture (overlay stamp) -> encoded access unit ready, per frame, in ms. */
const encodeLatenciesMs: number[] = [];
for (const [frameIndex, luma] of lumaFrames.entries()) {
  const sampler: HudSampler = {
    lumaAt: (sourceX, sourceY) => {
      const x = Math.floor((sourceX * outputSize.width) / WIDTH);
      const y = Math.floor((sourceY * outputSize.height) / HEIGHT);
      if (x < 0 || y < 0 || x >= outputSize.width || y >= outputSize.height) {
        return 0;
      }
      return luma[y * outputSize.width + x] ?? 0;
    },
  };
  const clock = decodeHudClock(sampler);
  if (clock === undefined) continue;
  clocksRead++;
  if (!stampedMsOfDay.has(clock)) mismatched.push(clock);

  // With -bf 0 the encoder preserves order and the splitter emitted one unit per
  // decoded frame (asserted above), so frame N pairs with access unit N.
  const readyAt = auReadyMsOfDay[frameIndex];
  if (readyAt === undefined) continue;
  let delta = readyAt - clock;
  if (delta < 0) delta += MS_PER_DAY;
  // Guard against a pairing that has drifted rather than reporting nonsense.
  if (delta < 60_000) encodeLatenciesMs.push(delta);
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = Math.min(Math.floor(fraction * sorted.length), sorted.length - 1);
  return sorted[at] ?? Number.NaN;
}

const encodeP50 = percentile(encodeLatenciesMs, 0.5);
const encodeP95 = percentile(encodeLatenciesMs, 0.95);
check(
  encodeLatenciesMs.length >= lumaFrames.length * 0.9,
  `paired only ${String(encodeLatenciesMs.length)} of ${String(lumaFrames.length)} frames for latency`,
);

check(
  clocksRead >= lumaFrames.length * 0.9,
  `HUD clock was readable in only ${String(clocksRead)} of ${String(lumaFrames.length)} decoded frames`,
);
check(
  mismatched.length === 0,
  `${String(mismatched.length)} decoded HUD clocks did not match any stamped timestamp (e.g. ${String(mismatched[0])})`,
);

const dumpTarget = values["dump-frame"];
if (dumpTarget !== undefined) {
  // Write what a driver's canvas would show, straight from the encoded stream.
  // Start at the last entry point so the dumped frame is from the end of the
  // run, not the first frame the emulator ever produced.
  const lastEntry = units.reduce(
    (best, unit, index) => (unit.isDecoderEntryPoint ? index : best),
    0,
  );
  const tail = Buffer.concat(units.slice(lastEntry).map((unit) => unit.bytes));
  const dump = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-v",
      "error",
      "-y",
      "-f",
      "h264",
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-update",
      "1",
      dumpTarget,
    ],
    { stdin: tail, stdout: "pipe", stderr: "pipe" },
  );
  if ((await dump.exited) !== 0) throw new Error("frame dump failed");
  process.stdout.write(`dumped a decoded frame to ${dumpTarget}\n`);
}

const totalBytes = units.reduce((sum, unit) => sum + unit.bytes.length, 0);
const observedKbps = (totalBytes * 8) / 1000 / seconds;

process.stdout.write(
  [
    `access units:   ${String(units.length)}`,
    `entry points:   ${String(entryPoints.length)}`,
    `delivered:      ${String(received.length)}`,
    `total bytes:    ${String(totalBytes)}`,
    `observed:       ${observedKbps.toFixed(0)} kbps`,
    `HUD clocks:     ${String(clocksRead)}/${String(lumaFrames.length)} frames read, ${String(mismatched.length)} mismatched`,
    `encode leg:     p50 ${encodeP50.toFixed(1)}ms  p95 ${encodeP95.toFixed(1)}ms  (capture -> access unit ready)`,
    "",
  ].join("\n"),
);

if (failures.length > 0) {
  process.stderr.write(
    `\nFAIL\n${failures.map((failure) => `  - ${failure}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write("\nPASS\n");
