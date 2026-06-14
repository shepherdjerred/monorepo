// Browser-driven variant of e2e-perf.ts. Same goal — measure server-side
// frame-pacing health under input load — but uses PinchTab to drive 4 real
// Chromium tabs against the actual frontend. Each tab claims a seat by
// clicking the rendered seat-picker, then dispatches synthetic keydown /
// keyup events at the React onKeyDown handler so input travels through the
// real frontend pipeline: app.tsx press() -> emit() -> socket.io-client ->
// Socket.IO websocket -> the production createSocket / handleRequest /
// emulator chain. Use this when the synthetic socket.io-client load (the
// other harness) can't reproduce a prod symptom that you suspect involves
// the browser-side Socket.IO stack, multiple TCP sockets, or React-side
// state churn.
//
// Topology: spawns the full backend in a child process (the real index.ts,
// fully wired except the stream/bot are disabled in the perf config) and
// drives it via PinchTab REST. /metrics is scraped over HTTP rather than
// read in-process. Needs a real MK64 ROM (resolveRom) and a running
// PinchTab daemon.

import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { $ } from "bun";
import { resolveRom } from "./lib/harness.ts";

const PINCHTAB_BASE = "http://localhost:9867";
const BACKEND_PORT = 8081;
const MEASURE_SECONDS = 30;
const WARMUP_SECONDS = 8;
const SEATS = 4;

// --target <url> drives an external backend (e.g. prod) and skips local
// backend boot / config / ROM. Default is the local backend we spawn.
const targetArgIdx = process.argv.indexOf("--target");
const TARGET =
  targetArgIdx === -1
    ? `http://localhost:${String(BACKEND_PORT)}`
    : (process.argv[targetArgIdx + 1] ?? "");
if (TARGET === "") {
  throw new Error("--target requires a URL");
}
const TARGET_URL = TARGET.replace(/\/$/, "");
const IS_LOCAL = TARGET_URL.startsWith("http://localhost");
const SKIP_NAV = process.argv.includes("--skip-nav");
// Spam cadence in the page, in ms between keydown/keyup chord changes.
// 10ms = 100 chord changes/sec/tab = 200 emit/sec/tab (down + up) -> 800/sec
// of socket traffic at 4 tabs. Lower this if 800/sec doesn't reproduce.
const SPAM_INTERVAL_MS = 10;

// ---- pinchtab token (shared with daemon via config) ------------------------

const PinchtabConfigSchema = z.object({
  server: z.object({ token: z.string().min(1) }),
});

async function pinchtabToken(): Promise<string> {
  const cfgPath =
    Bun.env.PINCHTAB_CONFIG ?? `${Bun.env.HOME ?? "~"}/.pinchtab/config.json`;
  const raw: unknown = JSON.parse(await Bun.file(cfgPath).text());
  return PinchtabConfigSchema.parse(raw).server.token;
}

const TOKEN = await pinchtabToken();

async function ptFetch(
  pathname: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${TOKEN}`);
  headers.set("Content-Type", "application/json");
  return fetch(`${PINCHTAB_BASE}${pathname}`, { ...init, headers });
}

// ---- backend lifecycle -----------------------------------------------------

async function writePerfConfig(
  rom: string,
  wasmDir: string,
  assets: string,
): Promise<string> {
  const raw =
    await $`mktemp -d ${path.join(tmpdir(), "mk64-perf-browser-XXXXXX")}`.text();
  const dir = raw.trim();
  const cfg = `
server_id = "0"

[bot]
enabled = false
discord_token = "x"
application_id = "0"

[bot.commands]
enabled = false
update = false

[bot.commands.screenshot]
enabled = false

[bot.notifications]
enabled = false
channel_id = "0"

[stream]
enabled = false
channel_id = "0"
dynamic_streaming = false
minimum_in_channel = 0
require_watching = false

[stream.userbot]
id = "0"
token = "x"

[stream.video]
frame_rate = 30
bitrate_kbps = 5000
bitrate_max_kbps = 8000
canvas_height = 720
hardware_acceleration = false

[emulator]
enabled = true
wasm_dir = ${JSON.stringify(wasmDir)}
rom_path = ${JSON.stringify(rom)}
fps = 30
software_render = true
seats = ${String(SEATS)}

[web]
enabled = true
cors = true
port = ${String(BACKEND_PORT)}
assets = ${JSON.stringify(assets)}

[web.api]
enabled = true

[leaderboard]
enabled = false
db_path = ${JSON.stringify(path.join(dir, "lb.db"))}
overlay_enabled = false
poll_every_n_frames = 10
`;
  await Bun.write(path.join(dir, "config.toml"), cfg);
  return dir;
}

async function waitForBackend(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${TARGET_URL}/metrics`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("backend never came up on /metrics");
}

// ---- pinchtab driving ------------------------------------------------------

const InstanceListSchema = z.array(
  z.object({ id: z.string(), mode: z.string(), status: z.string() }),
);

async function firstHeadedInstanceId(): Promise<string> {
  const r = await ptFetch("/instances");
  const data: unknown = await r.json();
  const list = InstanceListSchema.parse(data);
  const headed = list.find(
    (i) => i.status === "running" && i.mode === "headed",
  );
  if (!headed) throw new Error("no running headed pinchtab instance found");
  return headed.id;
}

const TabIdSchema = z.object({ tabId: z.string() });

async function openTab(instanceId: string, url: string): Promise<string> {
  const r = await ptFetch(`/instances/${instanceId}/tabs/open`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  const data: unknown = await r.json();
  return TabIdSchema.parse(data).tabId;
}

async function closeTab(tabId: string): Promise<void> {
  await ptFetch(`/tabs/${tabId}/close`, { method: "POST" });
}

/** The REST `/tabs/.../action` endpoint doesn't take eval; the `pinchtab
 *  eval --tab <id>` CLI uses an undocumented internal endpoint. Shell out to
 *  the CLI rather than reverse-engineer it (perf cost is negligible — we
 *  only call this a handful of times per scenario, not per frame). */
async function evalIn(tabId: string, code: string): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["pinchtab", "eval", "--await-promise", "--tab", tabId, code],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(
      `pinchtab eval failed (exit=${String(exit)}) in tab ${tabId}: ${err}`,
    );
  }
}

/** Wait for the seat picker to be rendered, then click the Nth P-button.
 *  The eval expression must be an async-IIFE returning the promise so
 *  --await-promise sees it (Chrome's eval has no top-level await). */
async function claimSeat(tabId: string, seat: number): Promise<void> {
  const label = `P${String(seat + 1)}`;
  await evalIn(
    tabId,
    `(async () => {
       await new Promise((resolve, reject) => {
         const deadline = Date.now() + 30000;
         const tick = () => {
           const btn = [...document.querySelectorAll('button')].find(
             (b) => (b.textContent ?? '').trim().startsWith(${JSON.stringify(label)}),
           );
           if (btn && !btn.disabled) { btn.click(); resolve(); return; }
           if (Date.now() > deadline) { reject(new Error('seat ${label} not visible')); return; }
           setTimeout(tick, 200);
         };
         tick();
       });
     })()`,
  );
}

/** Start the spam loop in the tab. Dispatches keydown/keyup at the window
 *  (which is what app.tsx's onKeyDown listener listens on). Holds W (a-button)
 *  and rapidly alternates KeyA/KeyD (analog x axis). Returns immediately —
 *  the loop runs in the page until stopSpam() is called. */
async function startSpam(tabId: string): Promise<void> {
  await evalIn(
    tabId,
    `(() => {
       window.__perfStop = false;
       const fire = (code, type) => window.dispatchEvent(
         new KeyboardEvent(type, { code, key: code, bubbles: true })
       );
       fire('KeyW', 'keydown');
       let phase = 0;
       const tick = () => {
         if (window.__perfStop) {
           fire('KeyA', 'keyup');
           fire('KeyD', 'keyup');
           fire('KeyW', 'keyup');
           return;
         }
         phase++;
         const k = phase % 2 ? 'KeyA' : 'KeyD';
         fire(k, 'keydown');
         setTimeout(() => fire(k, 'keyup'), ${String(Math.max(1, SPAM_INTERVAL_MS - 1))});
         setTimeout(tick, ${String(SPAM_INTERVAL_MS)});
       };
       tick();
       return 'started';
     })()`,
  );
}

async function stopSpam(tabId: string): Promise<void> {
  await evalIn(
    tabId,
    `(() => { window.__perfStop = true; return 'stopped'; })()`,
  );
}

/**
 * Drive the 4 tabs through the MK64 title screen + 4-player select + character
 * confirm + course select into an actual race. Seat 0 drives the menus (START
 * taps, RIGHT to 4P column); seats 1-3 mash A to confirm characters. Mirrors
 * the synthetic schedule in lib/scenarios.ts but applied through real browser
 * keyboard events so the perf measurement reflects under-race emulator load.
 * Blocks until the longest driver eval resolves (~70s).
 */
async function navigateToRace(tabIds: string[]): Promise<void> {
  const navSeat0 = `
    (async () => {
      const fire = (code, type) => window.dispatchEvent(
        new KeyboardEvent(type, { code, key: code, bubbles: true })
      );
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const tap = async (code, holdMs, gapMs) => {
        fire(code, 'keydown');
        await wait(holdMs);
        fire(code, 'keyup');
        await wait(gapMs);
      };
      // Start ~1s in so seat-claim broadcasts settle.
      await wait(1000);
      // 5 START taps -> leave title, walk to GAME SELECT
      for (let i = 0; i < 5; i++) await tap('Enter', 500, 1500);
      // 3 RIGHT taps -> move P1 column 1P -> 2P -> 3P -> 4P
      for (let i = 0; i < 3; i++) await tap('ArrowRight', 500, 1500);
      // Mash A for character select + course + GO. Confirm screen blocks until
      // every seat presses A so seat 0 also keeps tapping here.
      for (let i = 0; i < 25; i++) await tap('KeyW', 300, 1500);
      return 'nav-done';
    })()
  `;
  const confirmOtherSeat = `
    (async () => {
      const fire = (code, type) => window.dispatchEvent(
        new KeyboardEvent(type, { code, key: code, bubbles: true })
      );
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      // Wait for seat 0 to drive START + RIGHT taps (~16s) before mashing A
      // so we don't confirm a character before the 4P column is selected.
      await wait(17000);
      for (let i = 0; i < 25; i++) {
        fire('KeyW', 'keydown');
        await wait(300);
        fire('KeyW', 'keyup');
        await wait(1500);
      }
      return 'confirm-done';
    })()
  `;
  await Promise.all(
    tabIds.map((id, idx) =>
      evalIn(id, idx === 0 ? navSeat0 : confirmOtherSeat),
    ),
  );
}

// ---- metrics scraping ------------------------------------------------------

async function metricsText(): Promise<string> {
  const r = await fetch(`${TARGET_URL}/metrics`);
  return r.text();
}

function counter(text: string, name: string): number {
  // prom text format: "name <value>" (no labels for our counters).
  const re = new RegExp(String.raw`^${name}\s+(\d+(?:\.\d+)?)`, "m");
  const m = re.exec(text);
  return m === null ? 0 : Number(m[1]);
}

function histogramP95(text: string, name: string): number {
  const re = new RegExp(
    String.raw`^${name}_bucket\{le="([^"]+)"\}\s+(\d+(?:\.\d+)?)`,
    "gm",
  );
  const rows: { le: number; cum: number }[] = [];
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const le = m[1] === "+Inf" ? Number.POSITIVE_INFINITY : Number(m[1]);
    rows.push({ le, cum: Number(m[2]) });
    m = re.exec(text);
  }
  rows.sort((a, b) => a.le - b.le);
  const last = rows.at(-1);
  if (last === undefined || last.cum === 0) return 0;
  const target = last.cum * 0.95;
  for (const row of rows) if (row.cum >= target) return row.le;
  return Number.POSITIVE_INFINITY;
}

type Snapshot = {
  ticks: number;
  resyncs: number;
  emulateP95: number;
  lateP95: number;
  applyP95: number;
};

async function snapshot(): Promise<Snapshot> {
  const text = await metricsText();
  return {
    ticks: counter(text, "emulator_ticks_total"),
    resyncs: counter(text, "emulator_loop_resync_total"),
    emulateP95: histogramP95(text, "emulator_frame_emulate_ms"),
    lateP95: histogramP95(text, "emulator_frame_late_ms"),
    applyP95: histogramP95(text, "emulator_input_apply_delay_ms"),
  };
}

// ---- main ------------------------------------------------------------------

let backend: Bun.Subprocess | undefined;
let workDir: string | undefined;
if (IS_LOCAL) {
  const rom = await resolveRom();
  const pkgRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  // The frontend dist sits at packages/frontend/dist relative to the package
  // root; wasm assets at packages/backend/assets/n64wasm. Both have been built
  // by `bun run build:wasm` / frontend `bun run build`.
  const wasmDir = path.join(
    pkgRoot,
    "packages",
    "backend",
    "assets",
    "n64wasm",
  );
  const assets = path.join(pkgRoot, "packages", "frontend", "dist");

  if (!(await Bun.file(`${wasmDir}/n64wasm.wasm`).exists())) {
    throw new Error(
      `WASM binary not found: ${wasmDir}/n64wasm.wasm — run bun run build:wasm first`,
    );
  }
  if (!(await Bun.file(`${assets}/index.html`).exists())) {
    throw new Error(
      `Frontend dist not found: ${assets}/index.html — run bun run build in packages/frontend first`,
    );
  }

  workDir = await writePerfConfig(rom, wasmDir, assets);
  process.stderr.write(
    `[perf-browser] config -> ${workDir}/config.toml\n[perf-browser] starting backend…\n`,
  );

  const backendIndex = path.join(
    pkgRoot,
    "packages",
    "backend",
    "src",
    "index.ts",
  );
  backend = Bun.spawn({
    cmd: ["bun", backendIndex],
    cwd: workDir,
    env: Bun.env,
    stdout: "inherit",
    stderr: "inherit",
  });
} else {
  process.stderr.write(
    `[perf-browser] driving external target: ${TARGET_URL}\n`,
  );
}

const tabIds: string[] = [];
let teardownDone = false;
const teardown = async (): Promise<void> => {
  if (teardownDone) return;
  teardownDone = true;
  process.stderr.write("[perf-browser] tearing down…\n");
  for (const id of tabIds) {
    try {
      await stopSpam(id);
    } catch {
      /* tab may already be gone */
    }
    try {
      await closeTab(id);
    } catch {
      /* tab may already be gone */
    }
  }
  if (backend) {
    backend.kill();
    await backend.exited;
  }
  if (workDir !== undefined) {
    await $`rm -rf ${workDir}`.quiet();
  }
};
const onSigint = (): void => {
  void (async () => {
    await teardown();
    process.exit(130);
  })();
};
process.on("SIGINT", onSigint);

try {
  await waitForBackend();
  process.stderr.write("[perf-browser] backend ready on /metrics\n");

  const instanceId = await firstHeadedInstanceId();
  process.stderr.write(
    `[perf-browser] using pinchtab instance ${instanceId}\n`,
  );

  // Open all 4 tabs, then claim seats serially so the seat-claim races are
  // resolved deterministically (each tab sees the prior claims when it
  // renders the seat picker).
  for (let s = 0; s < SEATS; s++) {
    const id = await openTab(instanceId, `${TARGET_URL}/`);
    tabIds.push(id);
    process.stderr.write(`[perf-browser]   tab ${id} (seat ${String(s)})\n`);
  }
  for (const [s, id] of tabIds.entries()) {
    await claimSeat(id, s);
  }
  if (SKIP_NAV) {
    process.stderr.write(
      `[perf-browser] --skip-nav: assuming the game is already in a race\n`,
    );
  } else {
    process.stderr.write(
      `[perf-browser] all 4 seats claimed; navigating into 4p race (~70s)…\n`,
    );
    await navigateToRace(tabIds);
    process.stderr.write(`[perf-browser] navigation complete\n`);
  }
  process.stderr.write(`[perf-browser] starting spam\n`);
  for (const id of tabIds) await startSpam(id);

  process.stderr.write(`[perf-browser] warmup ${String(WARMUP_SECONDS)}s…\n`);
  await new Promise((r) => setTimeout(r, WARMUP_SECONDS * 1000));

  const before = await snapshot();
  const t0 = performance.now();
  process.stderr.write(
    `[perf-browser] measuring ${String(MEASURE_SECONDS)}s…\n`,
  );
  await new Promise((r) => setTimeout(r, MEASURE_SECONDS * 1000));
  const after = await snapshot();
  const wallSec = (performance.now() - t0) / 1000;

  const ticks = after.ticks - before.ticks;
  const resyncs = after.resyncs - before.resyncs;
  const fps = ticks / wallSec;

  process.stdout.write(
    [
      "",
      "=== browser-driven perf (4 pinchtab tabs holding+steering) ===",
      `  fps              = ${fps.toFixed(2)}   (target 30)`,
      `  emulate_ms p95   = ${after.emulateP95.toFixed(1)}   (budget 33)`,
      `  late_ms p95      = ${after.lateP95.toFixed(1)}   (target <10)`,
      `  apply_ms p95     = ${after.applyP95.toFixed(1)}`,
      `  resyncs (delta)  = ${String(resyncs)}   (target 0)`,
      `  ticks  (delta)   = ${String(ticks)}`,
      "",
    ].join("\n"),
  );

  const passed =
    fps >= 29.5 &&
    after.emulateP95 <= 33 &&
    after.lateP95 <= 10 &&
    resyncs === 0;
  process.stdout.write(passed ? "PASS\n" : "FAIL\n");
  await teardown();
  process.exit(passed ? 0 : 1);
} catch (error) {
  process.stderr.write(`[perf-browser] error: ${String(error)}\n`);
  await teardown();
  process.exit(1);
}
