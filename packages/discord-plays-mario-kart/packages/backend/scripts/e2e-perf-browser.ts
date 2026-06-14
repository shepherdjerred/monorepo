// Browser-driven fix-validation harness. Drives 4 PinchTab Chromium tabs
// against the frontend so input rides the full pipeline (app.tsx press →
// socket.io-client → Socket.IO → createSocket/handleRequest → emulator).
// Spawns the backend locally by default; `--target <url>` drives an existing
// backend; `--metrics-url <url>` decouples the scrape URL (use this when
// --target is a public URL and you kubectl-port-forwarded the pod's 8081).
// Writes a structured JSON summary; `--compare <baseline.json>` adds a
// delta table. See packages/docs/plans/2026-06-14_mk64-test-harness.md.

import path from "node:path";
import { z } from "zod";
import { $ } from "bun";
import { resolveRom } from "./lib/harness.ts";
import { compareSummaries, renderCompareTable } from "./lib/bench-compare.ts";
import {
  buildSummary,
  emptyGaugePoll,
  gitMetadata,
  parseBenchSummary,
  sampleGauges,
  scrape,
  type BenchSummary,
} from "./lib/bench-metrics.ts";
import { writePerfConfig } from "./lib/perf-config.ts";

const PINCHTAB_BASE = "http://localhost:9867";
const BACKEND_PORT = 8081;
const MEASURE_SECONDS = 30;
const WARMUP_SECONDS = 8;
const SEATS = 4;
const GAUGE_POLL_MS = 1000;

// --target <url> drives an external backend (e.g. prod) and skips local
// backend boot / config / ROM. Default is the local backend we spawn.
function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  // `.at()` returns string|undefined, so the !v guard isn't tripped by
  // strict array indexing returning string (which would make the check
  // tautological).
  const v = process.argv.at(i + 1);
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return v;
}

const TARGET =
  argValue("--target") ?? `http://localhost:${String(BACKEND_PORT)}`;
if (TARGET === "") {
  throw new Error("--target requires a URL");
}
const TARGET_URL = TARGET.replace(/\/$/, "");
const IS_LOCAL = TARGET_URL.startsWith("http://localhost");
const METRICS_URL = argValue("--metrics-url") ?? `${TARGET_URL}/metrics`;
const OUT_PATH = argValue("--out");
const COMPARE_PATH = argValue("--compare");
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

async function waitForBackend(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(METRICS_URL, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
      lastErr = new Error(`HTTP ${String(r.status)}`);
    } catch (error) {
      lastErr = error;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const hint = METRICS_URL.startsWith("http://localhost")
    ? "\nIf you're testing against the live cluster, port-forward first:\n" +
      "  kubectl -n mario-kart port-forward svc/mario-kart-ui-service 18081:8081\n" +
      "then re-run with --metrics-url http://localhost:18081/metrics"
    : "";
  throw new Error(
    `backend never came up on ${METRICS_URL} (last error: ${String(lastErr)})${hint}`,
  );
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

// ---- metric collection -----------------------------------------------------
//
// Histograms + counters are read as start/end snapshots; gauges are polled
// throughout the window so we can report min/mean/max instead of just a
// last-sample value. All parsing is in `lib/bench-metrics.ts` (and tested
// against a captured fixture there).

function startGaugePoller(): {
  poll: ReturnType<typeof emptyGaugePoll>;
  stop: () => Promise<void>;
} {
  const poll = emptyGaugePoll();
  // Use a mutable ref instead of a bare boolean so the eslint
  // no-unnecessary-condition rule (which can't see the async mutation in
  // the closure below) doesn't trip on `while (!stopped)`.
  const state = { stopped: false };
  const loop = (async (): Promise<void> => {
    while (!state.stopped) {
      try {
        const m = await scrape(METRICS_URL);
        sampleGauges(m, poll);
      } catch {
        // transient — let the next tick try again
      }
      await new Promise((r) => setTimeout(r, GAUGE_POLL_MS));
    }
  })();
  return {
    poll,
    stop: async () => {
      state.stopped = true;
      await loop;
    },
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

  workDir = await writePerfConfig({
    rom,
    wasmDir,
    assets,
    seats: SEATS,
    backendPort: BACKEND_PORT,
  });
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

  const benchStartedAt = new Date();
  const startSnap = await scrape(METRICS_URL);
  const poller = startGaugePoller();
  const t0 = performance.now();
  process.stderr.write(
    `[perf-browser] measuring ${String(MEASURE_SECONDS)}s…\n`,
  );
  await new Promise((r) => setTimeout(r, MEASURE_SECONDS * 1000));
  const endSnap = await scrape(METRICS_URL);
  await poller.stop();
  const wallSec = (performance.now() - t0) / 1000;

  const git = await gitMetadata();
  const summary: BenchSummary = buildSummary({
    target: TARGET_URL,
    metricsUrl: METRICS_URL,
    durationSec: MEASURE_SECONDS,
    seats: SEATS,
    git,
    benchStartedAt,
    start: startSnap,
    end: endSnap,
    poll: poller.poll,
    wallSec,
  });

  const dash = (v: number | null | undefined, d = 2): string =>
    v === null || v === undefined || !Number.isFinite(v)
      ? "—"
      : Math.abs(v) >= 1000
        ? v.toFixed(0)
        : v.toFixed(d);

  process.stdout.write(
    [
      "",
      "=== browser-driven perf (4 pinchtab tabs holding+steering) ===",
      "emulator:",
      `  fps_mean         = ${dash(summary.emulator.fps_mean)}   (target 30)`,
      `  emulate_ms p95   = ${dash(summary.emulator.emulate_ms_p95, 1)}   (budget 33)`,
      `  late_ms p95      = ${dash(summary.emulator.late_ms_p95, 1)}   (target <10)`,
      `  apply_ms p95     = ${dash(summary.emulator.apply_ms_p95, 1)}`,
      `  resyncs (delta)  = ${String(summary.emulator.resync_delta)}   (target 0)`,
      `  ticks  (delta)   = ${String(summary.emulator.ticks_delta)}`,
      "stream:",
      `  active           = ${dash(summary.stream.active_last, 0)}`,
      `  hw_encode        = ${dash(summary.stream.hw_encode_engaged, 0)}`,
      `  ffmpeg_speed     = mean ${dash(summary.stream.ffmpeg_speed_ratio.mean)} (min ${dash(summary.stream.ffmpeg_speed_ratio.min)})`,
      `  ffmpeg_fps       = mean ${dash(summary.stream.ffmpeg_fps.mean, 1)} (min ${dash(summary.stream.ffmpeg_fps.min, 1)})`,
      `  ffmpeg_bitrate   = ${dash(summary.stream.ffmpeg_bitrate_kbps.mean, 0)} kbps mean`,
      `  frame_interval   = p50 ${dash(summary.stream.frame_interval_ms_p50, 1)} / p95 ${dash(summary.stream.frame_interval_ms_p95, 1)} ms`,
      `  frame_write p95  = ${dash(summary.stream.frame_write_ms_p95, 2)} ms`,
      `  sink_buffer max  = ${dash(summary.stream.sink_buffer_bytes_max, 0)} bytes`,
      `  send_ft.ratio    = video p95 ${dash(summary.stream.send_frametime_ratio_video_p95, 2)} / audio p95 ${dash(summary.stream.send_frametime_ratio_audio_p95, 2)}`,
      `  send_late (delta)= video ${String(summary.stream.send_late_frames_video_delta)} / audio ${String(summary.stream.send_late_frames_audio_delta)}`,
      "input:",
      `  controller_rtt   = p50 ${dash(summary.input.controller_rtt_ms_p50, 1)} / p95 ${dash(summary.input.controller_rtt_ms_p95, 1)} ms`,
      `  input_apply      = p50 ${dash(summary.input.input_apply_delay_ms_p50, 1)} / p95 ${dash(summary.input.input_apply_delay_ms_p95, 1)} ms`,
      "",
    ].join("\n"),
  );

  const outPath =
    OUT_PATH ??
    `bench-${benchStartedAt.toISOString().replaceAll(/[:.]/g, "-")}.json`;
  await Bun.write(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`wrote ${outPath}\n`);

  let compareFail = false;
  if (COMPARE_PATH !== null) {
    const baselineRaw: unknown = JSON.parse(
      await Bun.file(COMPARE_PATH).text(),
    );
    const baseline: BenchSummary = parseBenchSummary(baselineRaw);
    const rows = compareSummaries(baseline, summary);
    process.stdout.write(
      `\n=== compare vs ${COMPARE_PATH} ===\n${renderCompareTable(rows)}\n`,
    );
    compareFail = rows.some((r) => r.verdict === "regressed");
  }

  await teardown();
  process.exit(compareFail ? 2 : 0);
} catch (error) {
  process.stderr.write(`[perf-browser] error: ${String(error)}\n`);
  await teardown();
  process.exit(1);
}
