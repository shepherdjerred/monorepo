// Local perf e2e for the MK64 server-side loop. Reproduces the two prod
// symptoms reported on 2026-06-13: (1) 4 players unplayable, (2) one user
// spamming input on the web UI drops frames for everyone. The test runs four
// scenarios — 1p/4p × idle/spam — against the *real* socket.io -> handleRequest
// -> emulator path, using a real ROM, and asserts hard thresholds on the
// already-instrumented Prometheus metrics. See
// packages/docs/plans/2026-06-13_mk64-perf-test.md for the design.
//
// Topology: the parent process spawns one CHILD subprocess per scenario so
// each gets a fresh emscripten/WASM global (it can't safely be re-init'd
// in-process). Each child boots in sprint mode (fps:1000), drives the menus
// via the existing `SCENARIOS` schedule into the right race state, then
// switches to realtime pacing (fps:30) and runs a measurement window with or
// without simulated web-controller spam. Metrics come from the shared
// prom-client `registry`, reset just before the measurement window so the
// numbers reflect ONLY that window (not the menu navigation).
//
// Needs a real MK64 ROM (resolved via resolveRom — Syncthing default → MK64_ROM
// env → --rom <path>). Never runs in CI.

import type { Server as IoServer } from "socket.io";
import { createServer, type Server as HttpServer } from "node:http";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { Subscription } from "rxjs";
import { z } from "zod";

import { bootEmulator, driveUntil, resolveRom } from "./lib/harness.ts";
import { SCENARIOS } from "./lib/scenarios.ts";
import type { N64Emulator } from "#src/emulator/n64-emulator.ts";
import { createSocket } from "#src/webserver/socket.ts";
import { handleRequest } from "#src/webserver/dispatch.ts";
import { SeatManager } from "#src/input/seat-manager.ts";
import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { MAX_SEATS } from "#src/emulator/constants.ts";
import {
  EMPTY_BUTTONS,
  type InputRequest,
} from "@discord-plays-mario-kart/common";

// ---- tuning knobs ----
const MEASURE_SECONDS = 30;
// 1000 msg/sec/seat — 30× a realistic browser key-repeat rate (~30 msg/s)
// and ~5× what an aggressive pointer-event burst can produce. The bug we're
// hunting (one user's spam dropping frames for everyone) needs this much to
// reproduce off the constrained prod CPU on a dev box. Lower if the bug
// appears at smaller rates.
const SPAM_INTERVAL_MS = 1;
const TARGET_FPS = 30;
const NAV_FPS = 1000;

// ---- acceptance thresholds (per scenario) ----
const THRESHOLDS = {
  fpsMin: 29.5,
  emulateP95Max: 33, // wasm core fits in the 33ms (30fps) budget
  lateP95Max: 10, // scheduler stays close to schedule
  resyncDeltaMax: 0, // no catastrophic loop resyncs
  applyP95Max: 50, // input → emulator-apply latency
};

const SCENARIO_KEYS = ["A", "B", "C", "D"] as const;
type ScenarioKey = (typeof SCENARIO_KEYS)[number];
const ScenarioKeySchema = z.enum(SCENARIO_KEYS);

const SPEC: Record<
  ScenarioKey,
  { seats: number; spam: boolean; scenario: keyof typeof SCENARIOS }
> = {
  A: { seats: 1, spam: false, scenario: "1p" },
  B: { seats: 4, spam: false, scenario: "4p" },
  C: { seats: 1, spam: true, scenario: "1p" },
  D: { seats: 4, spam: true, scenario: "4p" },
};

const ChildResultSchema = z.object({
  scenario: z.enum(SCENARIO_KEYS),
  seats: z.number().int().min(1).max(4),
  spam: z.boolean(),
  fps: z.number(),
  emulateP95: z.number(),
  lateP95: z.number(),
  resyncs: z.number(),
  applyP95: z.number(),
  ticks: z.number(),
});

// Used to detect a SeatResponse without importing the full Response union
// (we only care that the server confirmed our seat-claim, not what it said).
const SeatKindSchema = z.object({ kind: z.literal("seat") });

type ChildResult = z.infer<typeof ChildResultSchema>;

// ---- prom-client extraction helpers ----------------------------------------

// Mirrors prom-client's getMetricsAsJSON() shape for the fields we read.
// Histogram bucket labels carry `le` as either a number or "+Inf" — accept
// both via z.coerce.string() (the consumers immediately convert back to a
// number anyway).
const JsonMetricSchema = z.object({
  name: z.string(),
  values: z.array(
    z.object({
      metricName: z.string().optional(),
      labels: z
        .record(z.string(), z.union([z.string(), z.number()]).transform(String))
        .optional(),
      value: z.number(),
    }),
  ),
});
type JsonMetric = z.infer<typeof JsonMetricSchema>;

async function snapshot(): Promise<JsonMetric[]> {
  const raw = await registry.getMetricsAsJSON();
  return z.array(JsonMetricSchema).parse(raw);
}

function readCounter(metrics: JsonMetric[], name: string): number {
  const m = metrics.find((x) => x.name === name);
  if (m === undefined) return 0;
  // prom-client counters expose `{labels:{}, value: N}` with no metricName,
  // unlike histograms which carry `_bucket`/`_count`/`_sum` per value.
  const v = m.values.find(
    (vv) => vv.metricName === name || vv.metricName === undefined,
  );
  return v?.value ?? 0;
}

/**
 * Approximate the p95 from a prom-client cumulative histogram. We don't try to
 * interpolate inside a bucket (no lower-edge known here); we return the
 * smallest bucket upper edge whose cumulative count covers 95% of samples.
 * Acceptable for the pass/fail gates we care about — they're well-separated
 * from real values.
 */
function readHistogramP95(metrics: JsonMetric[], name: string): number {
  const m = metrics.find((x) => x.name === name);
  if (m === undefined) return Number.NaN;
  const count = m.values.find((v) => v.metricName === `${name}_count`)?.value;
  if (count === undefined || count === 0) return 0;
  const target = count * 0.95;
  const buckets = m.values
    .filter((v) => v.metricName === `${name}_bucket`)
    .map((v) => ({ le: v.labels?.["le"] ?? "+Inf", value: v.value }))
    .toSorted((a, b) => {
      const ai = a.le === "+Inf" ? Number.POSITIVE_INFINITY : Number(a.le);
      const bi = b.le === "+Inf" ? Number.POSITIVE_INFINITY : Number(b.le);
      return ai - bi;
    });
  for (const b of buckets) {
    if (b.value >= target) {
      return b.le === "+Inf" ? Number.POSITIVE_INFINITY : Number(b.le);
    }
  }
  return Number.POSITIVE_INFINITY;
}

// ---- child mode ------------------------------------------------------------

/** Drive the scenario's menu schedule until it confirms the race state. */
async function navigate(
  emu: N64Emulator,
  scenarioName: keyof typeof SCENARIOS,
): Promise<void> {
  const scenario = SCENARIOS[scenarioName];
  if (scenario === undefined) {
    throw new Error(`unknown scenario: ${scenarioName}`);
  }
  await driveUntil(emu, {
    seats: scenario.seats,
    schedule: scenario.schedule,
    until: scenario.until,
    timeoutFrames: scenario.timeoutFrames,
  });
}

/** Spin up the real socket.io server -> handleRequest -> emulator wiring. */
async function startServer(emu: N64Emulator): Promise<{
  http: HttpServer;
  io: IoServer;
  sub: Subscription;
  port: number;
  seatManager: SeatManager;
}> {
  const http = createServer();
  const seatManager = new SeatManager(MAX_SEATS);
  const obs = createSocket({ server: http, isCorsEnabled: false });
  const sub = obs.events.subscribe((event) => {
    handleRequest(event, { seatManager, emulator: emu });
  });
  await new Promise<void>((resolve) => {
    http.listen(0, resolve);
  });
  const addr = http.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("perf server did not bind a TCP port");
  }
  return { http, io: obs.io, sub, port: addr.port, seatManager };
}

/**
 * Connect N "browser" clients to the perf server and have each claim its
 * seat. Returns the connected clients and a teardown that disconnects them
 * (plus a small grace window so the server-side disconnect handlers fire
 * before the registry snapshot, keeping the input-apply histogram from
 * picking up post-spam drains).
 */
async function connectAndClaim(
  port: number,
  seats: number,
): Promise<{ clients: ClientSocket[]; teardown: () => Promise<void> }> {
  const clients: ClientSocket[] = [];
  for (let seat = 0; seat < seats; seat++) {
    const client = ioClient(`http://localhost:${String(port)}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      const onErr = (err: unknown): void => {
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      client.once("connect", () => {
        client.off("connect_error", onErr);
        resolve();
      });
      client.once("connect_error", onErr);
    });
    await new Promise<void>((resolve) => {
      const onResp = (raw: unknown): void => {
        const parsed = SeatKindSchema.safeParse(raw);
        if (parsed.success) {
          client.off("response", onResp);
          resolve();
        }
      };
      client.on("response", onResp);
      client.emit("request", { kind: "seat-claim", seat });
    });
  }
  return {
    clients,
    teardown: async () => {
      for (const c of clients) c.close();
      await new Promise((r) => setTimeout(r, 50));
    },
  };
}

/**
 * Start a timer per client that emits an `input` request every
 * SPAM_INTERVAL_MS — half the intervals press `a`, the other half release.
 * Returns a `stop()` that clears the timers.
 */
function startSpam(clients: ClientSocket[]): () => void {
  const timers: ReturnType<typeof setInterval>[] = [];
  let phase = false;
  for (const [seat, client] of clients.entries()) {
    const timer = setInterval(() => {
      phase = !phase;
      const req: InputRequest = {
        kind: "input",
        seat,
        state: {
          buttons: { ...EMPTY_BUTTONS, a: phase, right: !phase },
          analogX: phase ? 0.6 : -0.6,
          analogY: 0,
        },
      };
      client.emit("request", req);
    }, SPAM_INTERVAL_MS);
    timers.push(timer);
  }
  return () => {
    for (const t of timers) clearInterval(t);
  };
}

async function runChild(key: ScenarioKey, romPath: string): Promise<void> {
  const spec = SPEC[key];
  const scenarioName = spec.scenario;
  const scenario = SCENARIOS[scenarioName];
  if (scenario === undefined) {
    throw new Error(`unknown scenario: ${scenarioName}`);
  }

  process.stderr.write(`[perf:${key}] booting (rom=${romPath})…\n`);
  const emu = await bootEmulator({
    rom: romPath,
    seats: scenario.seats,
    fps: NAV_FPS,
  });

  process.stderr.write(`[perf:${key}] navigating to ${scenarioName} race…\n`);
  const navStart = performance.now();
  await navigate(emu, scenarioName);
  process.stderr.write(
    `[perf:${key}] race reached in ${String(
      Math.round(performance.now() - navStart),
    )} ms\n`,
  );

  // Wipe nav-driven holds so the measurement window starts from a clean slate.
  for (let s = 0; s < MAX_SEATS; s++) emu.clearPlayerInput(s);

  // Switch to realtime pacing and start the emulator BEFORE wiring spam, so
  // (a) the tick loop is steady when measurement begins and (b) seat-claim
  // races on the socket can settle in the warmup window.
  emu.setFps(TARGET_FPS);
  emu.onFrame(() => {
    /* intentionally empty: measure the loop, not the stream */
  });
  emu.start();

  let stopSpam: (() => void) | undefined;
  let teardownClients: (() => Promise<void>) | undefined;
  let http: HttpServer | undefined;
  let io: IoServer | undefined;
  let sub: Subscription | undefined;

  if (spec.spam) {
    process.stderr.write(
      `[perf:${key}] starting server + connecting clients…\n`,
    );
    const server = await startServer(emu);
    http = server.http;
    io = server.io;
    sub = server.sub;
    const connected = await connectAndClaim(server.port, spec.seats);
    teardownClients = connected.teardown;
    // Give the loop a brief warmup so seat-claim socket chatter doesn't
    // contaminate the measurement window. Then reset metrics and start spam.
    await new Promise((r) => setTimeout(r, 500));
    registry.resetMetrics();
    stopSpam = startSpam(connected.clients);
  } else {
    // Idle scenario: warm up briefly so first-tick jitter doesn't dominate.
    await new Promise((r) => setTimeout(r, 500));
    registry.resetMetrics();
  }

  process.stderr.write(
    `[perf:${key}] measuring for ${String(MEASURE_SECONDS)}s…\n`,
  );
  const measureStart = performance.now();
  await new Promise((r) => setTimeout(r, MEASURE_SECONDS * 1000));
  const measureWallMs = performance.now() - measureStart;

  if (stopSpam) stopSpam();
  emu.stop();
  if (teardownClients) await teardownClients();
  if (sub) sub.unsubscribe();
  if (io) {
    await io.close();
  } else if (http) {
    http.close();
  }

  const snap = await snapshot();
  const ticks = readCounter(snap, "emulator_ticks_total");
  const resyncs = readCounter(snap, "emulator_loop_resync_total");
  const emulateP95 = readHistogramP95(snap, "emulator_frame_emulate_ms");
  const lateP95 = readHistogramP95(snap, "emulator_frame_late_ms");
  const applyP95 = readHistogramP95(snap, "emulator_input_apply_delay_ms");
  const fps = ticks / (measureWallMs / 1000);

  const result: ChildResult = {
    scenario: key,
    seats: spec.seats,
    spam: spec.spam,
    fps,
    emulateP95,
    lateP95,
    resyncs,
    applyP95,
    ticks,
  };
  process.stdout.write(`__PERF_RESULT__ ${JSON.stringify(result)}\n`);
}

// ---- parent mode -----------------------------------------------------------

function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(digits);
}

function evaluateThresholds(r: ChildResult): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  if (r.fps < THRESHOLDS.fpsMin) {
    failures.push(`fps=${fmtNum(r.fps)} < ${String(THRESHOLDS.fpsMin)}`);
  }
  if (r.emulateP95 > THRESHOLDS.emulateP95Max) {
    failures.push(
      `emulate_p95=${fmtNum(r.emulateP95)} > ${String(THRESHOLDS.emulateP95Max)}`,
    );
  }
  if (r.lateP95 > THRESHOLDS.lateP95Max) {
    failures.push(
      `late_p95=${fmtNum(r.lateP95)} > ${String(THRESHOLDS.lateP95Max)}`,
    );
  }
  if (r.resyncs > THRESHOLDS.resyncDeltaMax) {
    failures.push(
      `resyncs=${String(r.resyncs)} > ${String(THRESHOLDS.resyncDeltaMax)}`,
    );
  }
  if (r.spam && r.applyP95 > THRESHOLDS.applyP95Max) {
    failures.push(
      `apply_p95=${fmtNum(r.applyP95)} > ${String(THRESHOLDS.applyP95Max)}`,
    );
  }
  return { passed: failures.length === 0, failures };
}

function printTable(
  rows: {
    result: ChildResult;
    verdict: ReturnType<typeof evaluateThresholds>;
  }[],
): void {
  const header = [
    "scn",
    "seats",
    "spam",
    "fps",
    "emul_p95",
    "late_p95",
    "rsync",
    "apply_p95",
    "ticks",
    "verdict",
  ];
  const lines: string[][] = [header];
  for (const { result: r, verdict } of rows) {
    lines.push([
      r.scenario,
      String(r.seats),
      r.spam ? "y" : "n",
      fmtNum(r.fps, 2),
      fmtNum(r.emulateP95, 1),
      fmtNum(r.lateP95, 1),
      String(r.resyncs),
      fmtNum(r.applyP95, 1),
      String(r.ticks),
      verdict.passed ? "PASS" : `FAIL[${verdict.failures.join(",")}]`,
    ]);
  }
  const widths = header.map((_, col) =>
    Math.max(...lines.map((row) => row[col]?.length ?? 0)),
  );
  for (const row of lines) {
    process.stdout.write(
      row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ") + "\n",
    );
  }
}

async function runParent(romPath: string, only?: ScenarioKey): Promise<number> {
  const keys: ScenarioKey[] = only ? [only] : ["A", "B", "C", "D"];
  const rows: {
    result: ChildResult;
    verdict: ReturnType<typeof evaluateThresholds>;
  }[] = [];

  for (const key of keys) {
    process.stderr.write(`\n=== scenario ${key} ===\n`);
    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        new URL(import.meta.url).pathname,
        "--child",
        "--scenario",
        key,
        "--rom",
        romPath,
      ],
      stdout: "pipe",
      stderr: "inherit",
      env: Bun.env,
    });
    const text = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    const line = text.split("\n").find((l) => l.startsWith("__PERF_RESULT__ "));
    if (exit !== 0 || line === undefined) {
      process.stderr.write(
        `[perf] scenario ${key} child failed (exit=${String(exit)})\n`,
      );
      return 1;
    }
    const parsed: unknown = JSON.parse(line.slice("__PERF_RESULT__ ".length));
    const result = ChildResultSchema.parse(parsed);
    rows.push({ result, verdict: evaluateThresholds(result) });
  }

  process.stdout.write("\n");
  printTable(rows);
  process.stdout.write("\n");

  const failed = rows.filter((r) => !r.verdict.passed);
  if (failed.length === 0) {
    process.stdout.write("All scenarios passed.\n");
    return 0;
  }
  process.stdout.write(
    `${String(failed.length)}/${String(rows.length)} scenario(s) failed.\n`,
  );
  return 1;
}

// ---- entry -----------------------------------------------------------------

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const isChild = process.argv.includes("--child");
const onlyArg = argValue("--scenario");
const romArg = argValue("--rom");

const rom = await resolveRom(romArg);
const parsedOnly = ScenarioKeySchema.safeParse(onlyArg);

if (isChild) {
  if (!parsedOnly.success) {
    throw new Error(
      `--child requires --scenario A|B|C|D, got: ${String(onlyArg)}`,
    );
  }
  await runChild(parsedOnly.data, rom);
  process.exit(0);
} else {
  const code = await runParent(
    rom,
    parsedOnly.success ? parsedOnly.data : undefined,
  );
  process.exit(code);
}
