// Glass-to-glass measurement of the driver feed, end to end, in a real browser.
//
// Boots the emulator and the driver feed on a local web server, serves the
// shipped frontend bundle, then drives a PinchTab-managed Chrome tab to open it
// and reports the latency the page measures for itself off its own canvas.
//
// This measures the half of the pipeline we control: emulator capture through
// encode, WebSocket, WebCodecs decode, and paint. It does NOT measure a Discord
// leg — there is none on this path, which is the entire point. It also excludes
// the game's own response to input; e2e:press-to-paint measures that end to end.
//
// The number is a same-machine, loopback figure: it is the floor, not what a
// player on the internet sees. Add real network RTT for that.
//
//   bun run e2e:driver-feed:glass [--seconds 30] [--rom <path>] [--port 8099]
//     [--engine n64wasm|spaghettikart] [--fps 30|60] [--pinchtab <server url>]
//
// --engine spaghettikart needs `bun run --cwd ../.. build:spaghetti` first;
// --fps sets its output rate (the wasm engine always delivers 30).

import { parseArgs } from "node:util";
import { z } from "zod";
import { parseEngineName, parseOutputFps } from "./lib/engines.ts";
import {
  evalInTab as evalInServerTab,
  openDriverTab,
  pinchtabCli,
  startFeedBench,
} from "./lib/feed-bench.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seconds: { type: "string", default: "30" },
    rom: { type: "string" },
    port: { type: "string", default: "8099" },
    pinchtab: { type: "string", default: "http://localhost:9867" },
    screenshot: { type: "string" },
    engine: { type: "string", default: "n64wasm" },
    fps: { type: "string", default: "30" },
  },
});
const engineName = parseEngineName(values.engine);

const seconds = Number(values.seconds);
const port = Number(values.port);
if (!Number.isFinite(seconds) || seconds <= 0) {
  throw new Error(`--seconds must be positive, got ${values.seconds}`);
}
const pinchtab = values.pinchtab;
const evalInTab = (tabId: string, script: string): Promise<unknown> =>
  evalInServerTab(pinchtab, tabId, script);

// ---- boot the server + feed ----

const bench = await startFeedBench({
  engine: engineName,
  rom: values.rom,
  fps: parseOutputFps(values.fps),
  port,
});
const { format } = bench.engine;
process.stdout.write(
  `serving the ${engineName} driver feed (${String(format.width)}x${String(format.height)} at ${String(format.fps)} fps) on http://localhost:${String(port)}\n`,
);
// Let MK64 get past its boot logos so the canvas has real content.
await Bun.sleep(20_000);

// ---- drive a real browser ----

const tabId = await openDriverTab(pinchtab, port);
process.stdout.write(`browser tab ${tabId} navigated; sampling its readout\n`);

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
  await pinchtabCli(pinchtab, [
    "screenshot",
    "--tab",
    tabId,
    "--output",
    shotTarget,
  ]);
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

await bench.stop();
await pinchtabCli(pinchtab, ["tab", "close", tabId]);

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
