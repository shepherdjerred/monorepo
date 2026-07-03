#!/usr/bin/env bun
/**
 * Maestro e2e orchestrator. Run with `bun run e2e` from the package root.
 *
 * Pipeline:
 *   1. temp vault seeded from e2e/fixtures/seed-vault
 *   2. tasknotes-server on 127.0.0.1:18901 over that vault
 *   3. chaos proxy on 127.0.0.1:18902 -> 18901 (offline/online control)
 *   4. booted iPhone simulator (boots the newest available one if needed)
 *   5. Metro + `bun run ios` debug build (skippable with E2E_SKIP_BUILD=1)
 *   6. `maestro test e2e/maestro` pointing the app at the proxy
 *   7. vault-state assertions against the real markdown files
 *   8. teardown (always): kill children, remove the temp vault
 *
 * (node:child_process rather than Bun.spawn so the file typechecks against
 * the repo-pinned @types/node — Bun implements node:child_process natively.)
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const SERVER_PORT = 18_901;
const CHAOS_PORT = 18_902;
const AUTH_TOKEN = "e2e-test-token";
const TASKS_DIR = "TaskNotes";
const METRO_PORT = 8081;

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

function runSimctl(args: string[]): string {
  const proc = spawnSync("xcrun", ["simctl", ...args], { encoding: "utf8" });
  if (proc.status !== 0) {
    fail(`xcrun simctl ${args.join(" ")} failed:\n${proc.stderr}`);
  }
  return proc.stdout;
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

async function startServer(vaultDir: string): Promise<ChildProcess> {
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

  log(`installing ${appPath}`);
  runSimctl(["install", simulator.udid, appPath]);
}

// ---------------------------------------------------------------------------
// Maestro
// ---------------------------------------------------------------------------

async function runMaestro(): Promise<void> {
  const which = spawnSync("which", ["maestro"], { encoding: "utf8" });
  if (which.status !== 0) {
    fail(
      "maestro CLI not found — install it: curl -Ls https://get.maestro.mobile.dev | bash",
    );
  }
  const proc = spawn(
    "maestro",
    [
      "test",
      path.join("e2e", "maestro"),
      "--env",
      `APP_URL=http://127.0.0.1:${String(CHAOS_PORT)}`,
      "--env",
      `AUTH_TOKEN=${AUTH_TOKEN}`,
    ],
    { cwd: packageDir, stdio: "inherit" },
  );
  const exitCode = await waitForExit(proc);
  if (exitCode !== 0) {
    fail(`maestro test failed with exit code ${String(exitCode)}`);
  }
}

// ---------------------------------------------------------------------------
// Vault-state assertions
// ---------------------------------------------------------------------------

type VaultAssertion = {
  name: string;
  check: (files: Map<string, string>) => boolean;
};

function fileWithTitle(
  files: Map<string, string>,
  title: string,
): string | undefined {
  for (const content of files.values()) {
    if (content.includes(`title: ${title}`)) return content;
  }
  return undefined;
}

const VAULT_ASSERTIONS: VaultAssertion[] = [
  {
    name: 'a task file containing "Created by e2e" exists (01-create-task)',
    check: (files) => fileWithTitle(files, "Created by e2e") !== undefined,
  },
  {
    name: '"Seeded open task" has status done (02-complete-task)',
    check: (files) =>
      fileWithTitle(files, "Seeded open task")?.includes("status: done") ===
      true,
  },
  {
    name: '"Water plants" has a complete_instances entry (03-recurring-complete)',
    check: (files) => {
      const content = fileWithTitle(files, "Water plants");
      if (content === undefined) return false;
      // Server writes block-style YAML: "complete_instances:\n  - '2026-…'"
      return /complete_instances:\n\s+- /.test(content);
    },
  },
];

async function assertVaultState(vaultDir: string): Promise<void> {
  const tasksDir = path.join(vaultDir, TASKS_DIR);
  const files = new Map<string, string>();
  for (const entry of await readdir(tasksDir)) {
    if (!entry.endsWith(".md")) continue;
    files.set(entry, await readFile(path.join(tasksDir, entry), "utf8"));
  }
  log(
    `vault contains ${String(files.size)} task file(s): ${[...files.keys()].join(", ")}`,
  );

  let failures = 0;
  for (const assertion of VAULT_ASSERTIONS) {
    const passed = assertion.check(files);
    console.log(`[e2e] ${passed ? "PASS" : "FAIL"} — ${assertion.name}`);
    if (!passed) failures += 1;
  }
  if (failures > 0) {
    fail(`${String(failures)} vault assertion(s) failed`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let vaultDir: string | null = null;
  const children: ChildProcess[] = [];
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

    // (6) Maestro flows
    await runMaestro();

    // (7) vault-state assertions
    await assertVaultState(vaultDir);

    log("e2e suite passed");
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
      await rm(vaultDir, { recursive: true, force: true });
    }
  }
}

await main();
