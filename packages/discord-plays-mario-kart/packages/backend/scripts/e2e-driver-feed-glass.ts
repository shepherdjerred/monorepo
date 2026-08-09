// Glass-to-glass measurement of the driver feed, end to end, in a real browser.
//
// Boots the emulator and the driver feed on a local web server, serves the
// shipped frontend bundle, then drives a PinchTab-managed Chrome tab to open it
// and reports the latency the page measures for itself off its own canvas.
//
// This measures the half of the pipeline we control: emulator capture through
// encode, WebSocket, WebCodecs decode, and paint. It does NOT measure a Discord
// leg — there is none on this path, which is the entire point.
//
// The number is a same-machine, loopback figure: it is the floor, not what a
// player on the internet sees. Add real network RTT for that.
//
//   bun run e2e:driver-feed:glass [--seconds 30] [--rom <path>] [--port 8099]

import { parseArgs } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { N64_FPS } from "#src/emulator/constants.ts";
import { WorkerEmulator } from "#src/emulator/worker/worker-emulator.ts";
import { applyStreamOverlays } from "#src/overlay/composite.ts";
import { DriverFeedService } from "#src/driver-feed/index.ts";
import { createWebServer } from "#src/webserver/index.ts";
import { resolveRom } from "./lib/harness.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seconds: { type: "string", default: "30" },
    rom: { type: "string" },
    port: { type: "string", default: "8099" },
    pinchtab: { type: "string", default: "http://localhost:9867" },
    screenshot: { type: "string" },
  },
});

const seconds = Number(values.seconds);
const port = Number(values.port);
if (!Number.isFinite(seconds) || seconds <= 0) {
  throw new Error(`--seconds must be positive, got ${values.seconds}`);
}

const PACKAGE_ROOT = path.join(import.meta.dir, "..", "..", "..");
const WASM_DIR = path.join(import.meta.dir, "..", "assets", "n64wasm");
const WEB_ASSETS = path.join(PACKAGE_ROOT, "packages", "frontend", "dist");

/**
 * Drive the browser through the `pinchtab` CLI rather than the REST action
 * endpoint: the CLI is the supported surface and already resolves auth, config,
 * and tab routing.
 */
async function pinchtabCli(args: readonly string[]): Promise<string> {
  const proc = Bun.spawn(["pinchtab", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`pinchtab ${args.join(" ")} failed: ${stderr || stdout}`);
  }
  return stdout;
}

const EvalSchema = z.object({ result: z.unknown() });

async function evalInTab(tabId: string, script: string): Promise<unknown> {
  const raw = await pinchtabCli(["eval", script, "--tab", tabId, "--json"]);
  return EvalSchema.parse(JSON.parse(raw)).result;
}

// ---- boot the server + feed ----

const romPath = await resolveRom(values.rom);
const savesDir = await mkdtemp(path.join(tmpdir(), "mk64-glass-"));

const driverFeed = new DriverFeedService({
  config: {
    enabled: true,
    height: 480,
    bitrate_kbps: 2500,
    bitrate_max_kbps: 4000,
    keyframe_interval_frames: 30,
    max_client_buffer_bytes: 2 * 1024 * 1024,
    max_clients: 4,
  },
  video: {
    hardware_acceleration: false,
    vaapi_device: "/dev/dri/renderD128",
    encoder_async_depth: 1,
  },
  frameRate: N64_FPS,
});

const { server } = createWebServer({
  port,
  webAssetsPath: WEB_ASSETS,
  isApiEnabled: true,
  isCorsEnabled: true,
});
driverFeed.attach(server);

const emulator = new WorkerEmulator({
  wasmDir: WASM_DIR,
  romPath,
  fps: N64_FPS,
  software: true,
  seats: 4,
  savesDir,
  snapshotEveryNFrames: 10,
});
await emulator.init();
emulator.onFrame((frame) => {
  applyStreamOverlays(frame.rgba, frame.height, {
    epochMs: Date.now(),
    seatActivity: frame.seatActivity,
    mode: "1p",
    seats: 4,
    nameOverlay: undefined,
  });
  driverFeed.pushFrame(frame.rgba);
});
driverFeed.startSession();
emulator.start();

process.stdout.write(
  `serving the driver feed on http://localhost:${String(port)} (rom: ${romPath})\n`,
);
// Let MK64 get past its boot logos so the canvas has real content.
await Bun.sleep(20_000);

// ---- drive a real browser ----

// A dedicated tab, so an unrelated tab in the shared browser is never touched.
const navOutput = await pinchtabCli([
  "nav",
  `http://localhost:${String(port)}/`,
  "--new-tab",
  "--print-tab-id",
]);
const tabId = navOutput.trim();
if (tabId.length === 0) throw new Error("pinchtab did not return a tab id");
process.stdout.write(`browser tab ${tabId} navigated; sampling its readout\n`);
await Bun.sleep(5000);

// The shipped GameView renders "<n>ms to glass"; sample what it reports.
await evalInTab(
  tabId,
  String.raw`(() => {
    window.__glass = [];
    window.__glassTimer = setInterval(() => {
      const m = /(-?\d+)ms to glass/.exec(document.body.innerText);
      if (m && m[1] !== undefined) window.__glass.push(Number(m[1]));
    }, 200);
    return "sampling";
  })()`,
);

await Bun.sleep(seconds * 1000);

const shotTarget = values.screenshot;
if (shotTarget !== undefined) {
  await pinchtabCli(["screenshot", "--tab", tabId, "--output", shotTarget]);
  process.stdout.write(`screenshot written to ${shotTarget}\n`);
}

const raw = await evalInTab(
  tabId,
  `(() => {
    clearInterval(window.__glassTimer);
    return JSON.stringify({
      samples: window.__glass ?? [],
      canvas: (() => {
        const c = document.querySelector("canvas");
        return c === null ? null : { w: c.width, h: c.height };
      })(),
      status: document.body.innerText.slice(0, 400),
    });
  })()`,
);

// ---- teardown before reporting, so a throw below cannot leak the emulator ----

emulator.onFrame(() => {
  // Detach: stopping the feed first would otherwise race an in-flight frame.
});
driverFeed.stopSession();
await emulator.stop();
await rm(savesDir, { recursive: true, force: true });
server.close();
await pinchtabCli(["tab", "close", "--tab", tabId]).catch(() => "");

const payload = z
  .object({
    samples: z.array(z.number()),
    canvas: z.object({ w: z.number(), h: z.number() }).nullable(),
    status: z.string(),
  })
  .parse(JSON.parse(z.string().parse(raw)));

const samples = payload.samples;
if (samples.length === 0) {
  process.stderr.write(
    `\nFAIL: the page never reported a latency.\npage text was:\n${payload.status}\n`,
  );
  process.exit(1);
}

const sorted = [...samples].sort((a, b) => a - b);
const at = (fraction: number) =>
  sorted[Math.min(Math.floor(fraction * sorted.length), sorted.length - 1)] ??
  0;
const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;

process.stdout.write(
  [
    "",
    `canvas:         ${payload.canvas === null ? "none" : `${String(payload.canvas.w)}x${String(payload.canvas.h)}`}`,
    `samples:        ${String(samples.length)}`,
    `glass-to-glass: p50 ${String(at(0.5))}ms  p95 ${String(at(0.95))}ms  min ${String(at(0))}ms  max ${String(at(1))}ms  mean ${mean.toFixed(1)}ms`,
    "",
    "capture -> encode -> websocket -> WebCodecs decode -> canvas paint, loopback.",
    "",
  ].join("\n"),
);
process.exit(0);
