#!/usr/bin/env bun
/**
 * Maestro e2e orchestrator. Run with `bun run e2e` from the package root.
 *
 * Pipeline:
 *   1. temp vault seeded from e2e/fixtures/seed-vault
 *   2. tasknotes-server on 127.0.0.1:18901 over that vault
 *   3. chaos proxy on 127.0.0.1:18902 -> 18901 (offline/online control)
 *   4. booted iPhone simulator (boots the newest available one if needed)
 *   5. Metro + xcodebuild debug build (skippable with E2E_SKIP_BUILD=1)
 *   6. each ordered Maestro flow in a fresh process, pointing at the proxy
 *   7. vault-state assertions against the real markdown files
 *   8. teardown: kill children; remove a passing vault, preserve a failed one
 *
 * (node:child_process rather than Bun.spawn so the file typechecks against
 * the repo-pinned @types/node — Bun implements node:child_process natively.)
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { assertVaultState } from "./vault-assertions";

const SERVER_PORT = 18_901;
const CHAOS_PORT = 18_902;
const AUTH_TOKEN = "e2e-test-token";
const TASKS_DIR = "TaskNotes";
const METRO_PORT = 8081;
const APP_ID = "org.reactjs.native.example.TasksForObsidian";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const serverDir = fileURLToPath(
  new URL("../../tasknotes-server", import.meta.url),
);
const fixturesDir = path.join(packageDir, "e2e", "fixtures", "seed-vault");

function log(message: string): void {
  console.log(`[e2e] ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(proc: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
      return;
    }
    proc.once("error", reject);
    proc.once("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function pollUntil(
  what: string,
  timeoutMs: number,
  check: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  fail(`timed out after ${String(timeoutMs)}ms waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// Simulator management
// ---------------------------------------------------------------------------

const SimDeviceSchema = z.object({
  name: z.string(),
  udid: z.string(),
  state: z.string(),
  isAvailable: z.boolean().optional(),
});
const SimListSchema = z.object({
  devices: z.record(z.string(), z.array(SimDeviceSchema)),
});
type SimDevice = z.infer<typeof SimDeviceSchema>;

function runSimctl(args: string[], allowAlreadyStopped = false): string {
  const proc = spawnSync("xcrun", ["simctl", ...args], { encoding: "utf8" });
  if (proc.status !== 0) {
    const stderr = proc.stderr.trim();
    if (
      allowAlreadyStopped &&
      (stderr.includes("No such process") ||
        /application .* is not running/i.test(stderr))
    ) {
      log(`${APP_ID} was already stopped`);
      return "";
    }
    fail(`xcrun simctl ${args.join(" ")} failed:\n${stderr}`);
  }
  return proc.stdout;
}

function isAppInstalled(simulator: SimDevice): boolean {
  const proc = spawnSync(
    "xcrun",
    ["simctl", "get_app_container", simulator.udid, APP_ID, "data"],
    { encoding: "utf8" },
  );
  if (proc.status === 0) return true;
  if (proc.status === 2 && proc.stderr.includes("No such file or directory")) {
    return false;
  }
  fail(
    `could not determine whether ${APP_ID} is installed on ${simulator.name}:\n${proc.stderr}`,
  );
}

function simctlList(filter: string): Map<string, SimDevice[]> {
  const stdout = runSimctl(["list", "devices", filter, "-j"]);
  const parsed = SimListSchema.parse(JSON.parse(stdout));
  return new Map(Object.entries(parsed.devices));
}

/** iOS runtime sort key, e.g. "…SimRuntime.iOS-18-2" -> [18, 2]. */
function runtimeVersion(runtimeId: string): number[] {
  const match = /iOS-(\d+)-(\d+)/.exec(runtimeId);
  if (match === null) return [0, 0];
  return [Number(match[1]), Number(match[2])];
}

function compareVersion(a: number[], b: number[]): number {
  const major = (a[0] ?? 0) - (b[0] ?? 0);
  if (major !== 0) return major;
  return (a[1] ?? 0) - (b[1] ?? 0);
}

function ensureBootedSimulator(): SimDevice {
  for (const devices of simctlList("booted").values()) {
    const booted = devices.find(
      (d) => d.state === "Booted" && d.name.includes("iPhone"),
    );
    if (booted !== undefined) {
      log(`using already-booted simulator: ${booted.name}`);
      return booted;
    }
  }

  // No booted iPhone: pick the newest available one and boot it.
  let best: { device: SimDevice; version: number[] } | null = null;
  for (const [runtimeId, devices] of simctlList("available")) {
    const version = runtimeVersion(runtimeId);
    for (const device of devices) {
      if (!device.name.startsWith("iPhone")) continue;
      if (device.isAvailable === false) continue;
      if (best === null || compareVersion(version, best.version) > 0) {
        best = { device, version };
      }
    }
  }
  if (best === null) {
    fail("no available iPhone simulator found — install one via Xcode");
  }

  log(`booting simulator: ${best.device.name} (${best.device.udid})`);
  runSimctl(["boot", best.device.udid]);
  // -b blocks until the device finishes booting.
  runSimctl(["bootstatus", best.device.udid, "-b"]);
  return best.device;
}

// ---------------------------------------------------------------------------
// Server + proxy
// ---------------------------------------------------------------------------

const HealthEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.string() }),
});

/**
 * Fail fast if a fixed port is already taken. Without this, the health poll
 * happily talks to a STALE server left over from an earlier run — the suite
 * then runs against that server's old, already-mutated vault and fails with
 * baffling "task not visible" assertions.
 */
async function assertPortFree(port: number, what: string): Promise<void> {
  let responded = false;
  try {
    await fetch(`http://127.0.0.1:${String(port)}/`, {
      signal: AbortSignal.timeout(1000),
    });
    responded = true;
  } catch {
    // connection refused / timeout — port is free enough
  }
  if (responded) {
    fail(
      `port ${String(port)} (${what}) is already serving HTTP — a stale ` +
        `process from a previous run is still alive. Kill it first: ` +
        `lsof -ti tcp:${String(port)} | xargs kill`,
    );
  }
}

async function startServer(vaultDir: string): Promise<ChildProcess> {
  await assertPortFree(SERVER_PORT, "tasknotes-server");
  const proc = spawn("bun", ["run", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      VAULT_PATH: vaultDir,
      TASKS_DIR,
      AUTH_TOKEN,
      PORT: String(SERVER_PORT),
      SENTRY_ENABLED: "false",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderrChunks: Buffer[] = [];
  proc.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  try {
    await pollUntil("tasknotes-server /api/health", 30_000, async () => {
      try {
        const response = await fetch(
          `http://127.0.0.1:${String(SERVER_PORT)}/api/health`,
        );
        if (!response.ok) return false;
        HealthEnvelopeSchema.parse(await response.json());
        return true;
      } catch {
        return false;
      }
    });
  } catch (error) {
    proc.kill();
    console.error(
      `[e2e] tasknotes-server stderr:\n${Buffer.concat(stderrChunks).toString("utf8")}`,
    );
    throw error;
  }
  log(`tasknotes-server healthy on :${String(SERVER_PORT)}`);
  return proc;
}

async function startChaosProxy(): Promise<ChildProcess> {
  await assertPortFree(CHAOS_PORT, "chaos proxy");
  const proc = spawn("bun", [path.join(packageDir, "e2e", "chaos-proxy.ts")], {
    env: {
      ...process.env,
      CHAOS_PORT: String(CHAOS_PORT),
      TARGET_PORT: String(SERVER_PORT),
    },
    stdio: "inherit",
  });
  await pollUntil("chaos proxy /__chaos/status", 10_000, async () => {
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(CHAOS_PORT)}/__chaos/status`,
      );
      return response.ok;
    } catch {
      return false;
    }
  });
  log(`chaos proxy on :${String(CHAOS_PORT)} -> :${String(SERVER_PORT)}`);
  return proc;
}

// ---------------------------------------------------------------------------
// Metro + app build
// ---------------------------------------------------------------------------

async function isMetroRunning(): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${String(METRO_PORT)}/status`,
    );
    const body = await response.text();
    return body.includes("packager-status:running");
  } catch {
    return false;
  }
}

/** Debug builds load JS from Metro, so the packager must be up. */
/**
 * A Metro on :8081 started from a DIFFERENT checkout (e.g. the main repo
 * while this runs in a worktree) would serve that tree's JS bundle and the
 * suite would silently test the wrong code. Only reuse a Metro whose
 * process cwd is this package.
 */
function metroCwd(): string | null {
  const pidProc = spawnSync("lsof", ["-t", "-i", ":8081", "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  const pid = pidProc.stdout.trim().split("\n")[0];
  if (pid === undefined || pid === "") return null;
  const cwdProc = spawnSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  });
  const line = cwdProc.stdout.split("\n").find((l) => l.startsWith("n"));
  return line === undefined ? null : line.slice(1);
}

async function ensureMetro(): Promise<ChildProcess | null> {
  if (await isMetroRunning()) {
    const cwd = metroCwd();
    if (cwd !== null && path.resolve(cwd) === path.resolve(packageDir)) {
      log("Metro already running from this package — reusing it");
      return null;
    }
    fail(
      `a Metro/dev server is already on :8081 but serving a different project (${cwd ?? "unknown cwd"}) — stop it first, or it would serve the wrong tree's JS to the e2e app`,
    );
  }
  log("starting Metro bundler");
  const proc = spawn("bun", ["run", "start"], {
    cwd: packageDir,
    stdio: "inherit",
  });
  await pollUntil("Metro packager", 60_000, isMetroRunning);
  return proc;
}

/**
 * Build with xcodebuild + install with simctl directly instead of
 * `react-native run-ios`: the RN CLI hardcodes the pre-Xcode-27 path to
 * Simulator.app (Contents/Developer/Applications) and dies on newer Xcode.
 * Maestro only needs the simulator *booted*, not its GUI, so we never open
 * a simulator app at all.
 */
async function buildAndInstallApp(simulator: SimDevice): Promise<void> {
  const derivedDataPath = path.join(packageDir, "ios", "build", "e2e");
  const appPath = path.join(
    derivedDataPath,
    "Build",
    "Products",
    "Debug-iphonesimulator",
    "TasksForObsidian.app",
  );

  if (process.env["E2E_SKIP_BUILD"] === "1") {
    log("E2E_SKIP_BUILD=1 — skipping xcodebuild (installing existing build)");
  } else {
    log(`building app for "${simulator.name}" (xcodebuild)`);
    const proc = spawn(
      "xcodebuild",
      [
        "-workspace",
        "TasksForObsidian.xcworkspace",
        "-scheme",
        "TasksForObsidian",
        "-configuration",
        "Debug",
        "-destination",
        `platform=iOS Simulator,id=${simulator.udid}`,
        "-derivedDataPath",
        derivedDataPath,
        "build",
      ],
      { cwd: path.join(packageDir, "ios"), stdio: "inherit" },
    );
    const exitCode = await waitForExit(proc);
    if (exitCode !== 0) {
      fail(`xcodebuild failed with exit code ${String(exitCode)}`);
    }
  }

  // Start each suite with one clean data container. Clearing the app from every
  // nested Maestro setup flow repeatedly tears down the React Native debug
  // runtime; on newer simulators that can strand the app at "Downloading 100%"
  // and turn a 60-second assertion into a many-minute XCTest timeout. The
  // flows already intentionally share one server vault, so relaunching the same
  // clean install between flows is the matching local-state model.
  if (isAppInstalled(simulator)) {
    log(`uninstalling existing ${APP_ID} data container`);
    runSimctl(["uninstall", simulator.udid, APP_ID]);
  }
  log(`installing ${appPath}`);
  runSimctl(["install", simulator.udid, appPath]);
}

/**
 * Metro answers /status long before it can serve the app bundle — the first
 * Watchman crawl + bundle build of this monorepo takes minutes. Running
 * Maestro before the bundle is servable red-screens the Debug app ("could
 * not connect to development server") and every flow fails at launch.
 */
async function waitForJsBundle(): Promise<void> {
  log(
    "waiting for Metro to serve the JS bundle (first build can take minutes)",
  );
  await pollUntil("Metro JS bundle", 300_000, async () => {
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(METRO_PORT)}/index.bundle?platform=ios&dev=true&lazy=true`,
      );
      if (!response.ok) return false;
      await response.arrayBuffer();
      return true;
    } catch {
      return false;
    }
  });
  log("Metro bundle ready");
}

function launchApp(simulator: SimDevice): void {
  runSimctl(["launch", simulator.udid, APP_ID]);
}

function restartApp(simulator: SimDevice, flow: string): void {
  log(`restarting ${APP_ID} before ${flow}`);
  runSimctl(["terminate", simulator.udid, APP_ID], true);
  launchApp(simulator);
}

// ---------------------------------------------------------------------------
// Maestro
// ---------------------------------------------------------------------------

const MaestroConfigSchema = z.object({
  executionOrder: z.object({
    flowsOrder: z.array(z.string().regex(/^\d{2}-[a-z0-9-]+$/)).min(1),
  }),
});

async function orderedFlowFiles(): Promise<readonly string[]> {
  const configPath = path.join(packageDir, "e2e", "maestro", "config.yaml");
  const source = await readFile(configPath, "utf8");
  const config = MaestroConfigSchema.parse(Bun.YAML.parse(source));
  return config.executionOrder.flowsOrder.map((flow) => `${flow}.yaml`);
}

async function runMaestro(
  simulator: SimDevice,
  focusedFlow: string | null,
): Promise<void> {
  const which = spawnSync("which", ["maestro"], { encoding: "utf8" });
  if (which.status !== 0) {
    fail(
      "maestro CLI not found — install it: brew install mobile-dev-inc/tap/maestro",
    );
  }
  const flows = focusedFlow === null ? await orderedFlowFiles() : [focusedFlow];
  for (const [index, flow] of flows.entries()) {
    if (index > 0) restartApp(simulator, flow);
    const target = path.join(packageDir, "e2e", "maestro", flow);
    try {
      await access(target);
    } catch {
      fail(`requested Maestro flow does not exist: ${target}`);
    }

    log(`Maestro flow ${String(index + 1)}/${String(flows.length)}: ${flow}`);
    // Pin the device: maestro aborts with "Multiple devices connected" if any
    // other simulator (or a paired watch/host) is also up.
    const proc = spawn(
      "maestro",
      [
        "--device",
        simulator.udid,
        "test",
        target,
        "--env",
        `APP_URL=http://127.0.0.1:${String(CHAOS_PORT)}`,
        "--env",
        `AUTH_TOKEN=${AUTH_TOKEN}`,
      ],
      { cwd: packageDir, stdio: "inherit" },
    );
    const exitCode = await waitForExit(proc);
    if (exitCode !== 0) {
      fail(`${flow} failed with exit code ${String(exitCode)}`);
    }
  }
}

function requestedFlow(): string | null {
  const value = process.env["E2E_FLOW"];
  if (value === undefined || value === "") return null;
  if (!/^\d{2}-[a-z0-9-]+\.yaml$/.test(value)) {
    fail(
      "E2E_FLOW must be a Maestro filename such as 03-recurring-complete.yaml",
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Module scope so signal handlers can reach them: `finally` does NOT run when
// the process dies from Ctrl+C, and orphaned servers keep the fixed ports —
// every later run then silently adopts the stale server and its stale vault.
const children: ChildProcess[] = [];
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const child of children) child.kill();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

async function main(): Promise<void> {
  let vaultDir: string | null = null;
  let passed = false;
  const focusedFlow = requestedFlow();
  try {
    // (1) temp vault seeded with fixtures
    vaultDir = await mkdtemp(path.join(tmpdir(), "tasknotes-e2e-"));
    await cp(fixturesDir, vaultDir, { recursive: true });
    log(`temp vault: ${vaultDir}`);

    // (2) server, (3) chaos proxy
    children.push(await startServer(vaultDir));
    children.push(await startChaosProxy());

    // (4) simulator
    const simulator = ensureBootedSimulator();

    // (5) Metro + app build
    const metro = await ensureMetro();
    if (metro !== null) children.push(metro);
    await buildAndInstallApp(simulator);
    await waitForJsBundle();
    log(`launching ${APP_ID} for the first flow`);
    launchApp(simulator);

    // (6) Maestro flows
    await runMaestro(simulator, focusedFlow);

    // (7) vault-state assertions
    if (focusedFlow === null) {
      await assertVaultState(vaultDir, log);
    } else {
      log(`focused flow passed: ${focusedFlow}`);
    }

    log("e2e suite passed");
    passed = true;
  } finally {
    // (8) teardown — always
    await Promise.allSettled(
      children.map((child) => {
        const exited = waitForExit(child);
        child.kill();
        return exited;
      }),
    );
    if (vaultDir !== null) {
      if (passed) {
        await rm(vaultDir, { recursive: true, force: true });
      } else {
        // Keep the vault for post-mortem: the final markdown bytes are often
        // the fastest way to tell which flow mutated what.
        log(`suite failed — temp vault preserved at ${vaultDir}`);
      }
    }
  }
}

await main();
