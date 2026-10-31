#!/usr/bin/env bun
//
// Build a Release bundle, launch it, and require that it stays up.
//
// ## Why this exists
//
// A Release build shipped that could not start. `ENABLE_HARDENED_RUNTIME: YES`
// plus ad-hoc signing makes dyld's library validation reject the app's own
// embedded `TaskNotesCore.framework` — every loaded library must share the main
// executable's Team ID, and ad-hoc signing has none. Debug hid it completely,
// because Xcode adds `com.apple.security.get-task-allow` for debugging and that
// entitlement disables library validation as a side effect.
//
// So Debug launched, Release crashed, and `xcodebuild` said BUILD SUCCEEDED for
// both. A bundle that cannot start is still a bundle that built. `mac:verify`
// ended in a **Debug** `xcodebuild` and XCUITest drives the **Debug** app, so
// nothing in the repository ever ran the Release configuration at all. It was
// found by installing the app and watching it fail to open.
//
// ## Why launching, rather than inspecting the signature
//
// A static check would have to reproduce library validation's rule from
// `codesign` output — a *model* of what the kernel does, which can be wrong and
// which nobody would notice was wrong. Launching is ground truth. It also
// catches a crash in `AppEnvironment.init`, a missing Info.plist key, and a
// modal thrown at startup, none of which a signature check can see.
//
// ⚠️ `codesign --verify --deep --strict` is **not** a substitute: it passed on
// the broken bundle.
//
// ## Why it does not steal focus
//
// This runs from `mac:verify` and from a git hook while someone is working.
// `open -g -j` launches in the background and hidden, and the run asserts the
// app never became frontmost — so a regression that makes the app force itself
// forward fails here rather than in the middle of someone's sentence. The same
// concern produced `OffscreenSnapshot`'s `.prohibited` activation policy; that
// technique is not available here because this is the real app, so the flags
// plus the assertion stand in for it.
//
// ## Why a pre-existing copy does not fail the run
//
// The script used to refuse to launch when any copy of the Release bundle was
// already running, so a previous run could never be mistaken for this one.
// That refusal was correct attribution but a self-perpetuating wedge: build
// 17476 was canceled between `open` and the SIGTERM cleanup, the orphaned app
// survived (cancellation signals reach the job's processes, but the launched
// app was adopted by launchd and lives outside them), and every later build
// failed the pre-check without testing anything. Nothing reaps the orphan;
// the CI host persists across builds.
//
// So the run snapshots the pids it finds at startup and asserts only on pids
// that appear afterwards. A stale copy is host state, not evidence about this
// build's bundle, and ignoring it cannot bless a broken build: the survival,
// focus, and clean-shutdown assertions still run against exactly the copy this
// run launched. The script only ever signals those pids; a pre-existing copy
// is left alone, including a wedged one left running for inspection by an
// earlier run. UID, exact argv, process start time and the mapped executable
// are checked before signaling, so a reused PID cannot inherit ownership.
//
// ## Why cancellation reaps the launched copy
//
// Ordinary failures and SIGTERM/SIGINT use the same bounded owned cleanup.
// A shutdown timeout deliberately retains the process for inspection.

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const appPath = join(
  packageRoot,
  ".build/xcode/Build/Products/Release/TaskNotes.app",
);
const crashReports = join(homedir(), "Library/Logs/DiagnosticReports");
const smokeRunID = randomUUID();
const stateDirectory = join(
  homedir(),
  "Library/Containers/red.sjer.tasknotes.mac/Data/Library/Application Support/FacetReleaseSmoke",
  smokeRunID,
);

/** A live PID and successful engine/account startup must belong to this UUID. */
export function requireStartupMarker(
  runID: string,
  pid: number,
  contents: string,
): void {
  if (!Number.isSafeInteger(pid) || pid <= 0 || contents !== `${runID}\n`) {
    throw new Error("Release startup marker does not belong to this run/PID");
  }
}

/** How long the app must survive. Two probes, so a slow crash is still caught. */
const earlyProbeMs = 3_000;
const lateProbeMs = 8_000;

/** How long it gets to exit after SIGTERM before we call the run loop hung. */
const shutdownMs = 5_000;

function fail(message: string): never {
  throw new Error(message);
}

async function run(command: readonly string[]): Promise<string> {
  const child = Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0) {
    fail(
      `${command.join(" ")} exited ${status.toString()}\n${stdout}\n${stderr}`,
    );
  }
  return stdout;
}

/** Every crash report currently on disk, so a new one can be attributed. */
async function crashReportNames(): Promise<ReadonlySet<string>> {
  try {
    return new Set(await readdir(crashReports));
  } catch {
    // No directory means no crashes have ever been written. An empty set is the
    // correct answer, not an error — this is the only place in the script where
    // a missing thing is benign.
    return new Set();
  }
}

export interface SmokeProcess {
  pid: number;
  uid: number;
  startedAt: string;
  command: string;
}

/** Full argv is queried only for the exact executable; never log process tables. */
export function parseProcessTable(stdout: string): readonly SmokeProcess[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match =
        /^\s*(\d+)\s+(-?\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(
          line,
        );
      if (!match) throw new Error("Malformed process identity snapshot");
      const pid = Number(match[1]);
      // macOS ps prints some uint32_t UIDs as signed values (nobody is -2).
      // Normalize that representation to the unsigned value returned by getuid.
      const rawUID = Number(match[2]);
      const uid = rawUID < 0 ? rawUID + 4_294_967_296 : rawUID;
      const startedAt = match[3];
      const command = match[4];
      if (
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        !Number.isSafeInteger(rawUID) ||
        rawUID < -2_147_483_648 ||
        rawUID > 4_294_967_295 ||
        startedAt === undefined ||
        command === undefined
      )
        throw new Error("Invalid process identity snapshot");
      return { pid, uid, startedAt, command };
    });
}

interface SmokeProcessRuntime {
  snapshot(): Promise<readonly SmokeProcess[]>;
  executableMatches(pid: number): Promise<boolean>;
  signal(pid: number): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export class SmokeShutdownWedgedError extends Error {}

/** Pins each lifetime; baseline copies, other argv and reused PIDs are excluded. */
export class OwnedSmokeProcesses {
  private readonly lifetimes = new Map<number, string>();
  constructor(
    private readonly runtime: SmokeProcessRuntime,
    private readonly command: string,
    private readonly uid: number,
    private readonly baseline: ReadonlySet<number>,
  ) {}

  async current(): Promise<readonly SmokeProcess[]> {
    return (await this.runtime.snapshot()).filter((record) => {
      if (
        record.uid !== this.uid ||
        record.command !== this.command ||
        this.baseline.has(record.pid)
      )
        return false;
      const lifetime = this.lifetimes.get(record.pid);
      if (lifetime !== undefined && lifetime !== record.startedAt) return false;
      this.lifetimes.set(record.pid, record.startedAt);
      return true;
    });
  }

  async shutdown(): Promise<void> {
    for (const record of await this.current()) {
      if (!(await this.runtime.executableMatches(record.pid)))
        throw new Error(
          "Cannot verify owned Release smoke executable before cleanup",
        );
      // Revalidate after the executable query, immediately before signaling.
      if (
        !(await this.current()).some(
          (current) =>
            current.pid === record.pid &&
            current.startedAt === record.startedAt,
        )
      )
        continue;
      this.runtime.signal(record.pid);
    }
    const deadline = this.runtime.now() + shutdownMs;
    while (this.runtime.now() < deadline) {
      if ((await this.current()).length === 0) return;
      await this.runtime.sleep(200);
    }
    throw new SmokeShutdownWedgedError(
      `the app did not exit within ${shutdownMs / 1000}s of SIGTERM, so its run loop is wedged. Left running deliberately rather than SIGKILLed, so it can be inspected.`,
    );
  }
}

/** Cleanup all ordinary exits, preserving an already-proven shutdown wedge. */
export async function withSmokeCleanup(
  action: () => Promise<void>,
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof SmokeShutdownWedgedError) throw error;
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Release smoke failed and owned cleanup failed",
      );
    }
    throw error;
  }
  await cleanup();
}

/** Cancellation cannot outrun a Launch Services command already in flight. */
export class SmokeLaunchGate {
  private cancelled = false;
  private settled: Promise<void> | undefined;
  constructor(
    private readonly start: () => Promise<unknown>,
    private readonly adoptionWindow: () => Promise<void>,
  ) {}

  async launch(): Promise<void> {
    if (this.cancelled) throw new Error("Release smoke launch was cancelled");
    const started = this.start();
    this.settled = started.then(this.adoptionWindow, this.adoptionWindow);
    await started;
  }

  cancel(): void {
    this.cancelled = true;
  }
  async settle(): Promise<void> {
    await this.settled;
  }
}

async function processSnapshot(): Promise<readonly SmokeProcess[]> {
  const child = Bun.spawn(
    ["/bin/ps", "-ww", "-axo", "pid=,uid=,lstart=,comm="],
    {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, LC_ALL: "C" },
      timeout: 1_000,
    },
  );
  const [stdout, status] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (status !== 0)
    throw new Error("Cannot inspect Release smoke process identities");
  const executable = join(appPath, "Contents/MacOS/TaskNotes");
  const candidates = parseProcessTable(stdout).filter(
    (record) =>
      record.command === executable && record.uid === process.getuid?.(),
  );
  const snapshots = await Promise.all(
    candidates.map(async (record) => {
      const target = Bun.spawn(
        [
          "/bin/ps",
          "-ww",
          "-p",
          record.pid.toString(),
          "-o",
          "pid=,uid=,lstart=,command=",
        ],
        {
          stdout: "pipe",
          stderr: "ignore",
          env: { ...process.env, LC_ALL: "C" },
          timeout: 1_000,
        },
      );
      const [argv, exit] = await Promise.all([
        new Response(target.stdout).text(),
        target.exited,
      ]);
      if (exit === 1) return [];
      if (exit !== 0)
        throw new Error("Cannot inspect Release smoke process argv");
      return parseProcessTable(argv).filter(
        (current) =>
          current.pid === record.pid &&
          current.uid === record.uid &&
          current.startedAt === record.startedAt,
      );
    }),
  );
  return snapshots.flat();
}

export interface ExecutableMappingInspection {
  pid: number;
  status: number;
  signal: string | null;
  timedOut: boolean;
  elapsedMs: number;
  budgetMs: number;
  pidMatches: boolean;
  pathMatches: boolean;
}

/** The inspector budget is separate from the app's post-SIGTERM deadline. */
export async function inspectExecutableMapping(
  pid: number,
  executable: string,
): Promise<ExecutableMappingInspection> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !executable.startsWith("/"))
    throw new Error("Invalid executable inspection target");
  const budgetMs = 5_000;
  const deadline = new AbortController();
  const started = performance.now();
  const child = Bun.spawn(
    [
      "/usr/sbin/lsof",
      "-a",
      "-p",
      pid.toString(),
      "-d",
      "txt",
      "-Fn",
      "--",
      executable,
    ],
    {
      stdout: "pipe",
      stderr: "ignore",
      signal: deadline.signal,
      // This is only the spawned read-only lsof inspector, never the app PID.
      killSignal: "SIGKILL",
    },
  );
  const timer = setTimeout(() => deadline.abort(), budgetMs);
  try {
    const [stdout, status] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    return {
      pid,
      status,
      signal: child.signalCode,
      timedOut: deadline.signal.aborted,
      elapsedMs: Math.round(performance.now() - started),
      budgetMs,
      pidMatches: stdout.split("\n").includes(`p${pid.toString()}`),
      pathMatches: stdout.split("\n").includes(`n${executable}`),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function executableMappingMatches(
  inspection: ExecutableMappingInspection,
): boolean {
  if (
    inspection.timedOut ||
    inspection.signal !== null ||
    (inspection.status !== 0 && inspection.status !== 1)
  )
    throw new Error(
      `Cannot inspect Release smoke executable mapping (${JSON.stringify(inspection)})`,
    );
  return (
    inspection.status === 0 && inspection.pidMatches && inspection.pathMatches
  );
}

async function mappedExecutableMatches(pid: number): Promise<boolean> {
  const inspection = await inspectExecutableMapping(
    pid,
    join(appPath, "Contents/MacOS/TaskNotes"),
  );
  // Only closed metadata is logged, never lsof output or unrelated processes.
  console.log(
    `verify-launch: executable inspection ${JSON.stringify(inspection)}`,
  );
  return executableMappingMatches(inspection);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
}

/** The bundle identifier macOS currently considers frontmost. */
async function frontmostBundleId(): Promise<string> {
  const child = Bun.spawn(["lsappinfo", "front"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const asn = (await new Response(child.stdout).text()).trim();
  await child.exited;
  if (asn.length === 0) return "";
  const info = Bun.spawn(["lsappinfo", "info", "-only", "bundleid", asn], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const line = await new Response(info.stdout).text();
  await info.exited;
  // `"CFBundleIdentifier"="com.apple.Terminal"` — take the second quoted field.
  return line.split('"')[3] ?? "";
}

/**
 * SIGTERM/SIGINT arrive here on job cancellation or Ctrl-C: reap exactly the
 * copies this run launched, then exit with the conventional 128+signo status.
 * Installed before `open` so the launch-to-cleanup window is covered. A signal
 * that arrives before the launch simply finds nothing of ours to reap.
 */
async function main(
  owned: OwnedSmokeProcesses,
  launch: () => Promise<void>,
): Promise<void> {
  // The app computes this private path independently from the UUID. No launch
  // path override, normal profile read, or production Keychain service is used.
  try {
    await lstat(stateDirectory);
    fail(`refusing an existing Release smoke run directory: ${stateDirectory}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const beforeCrashes = await crashReportNames();
  const frontBefore = await frontmostBundleId();

  console.log(`verify-launch: launching ${appPath} in the background`);
  // `-g` does not bring it to the foreground, `-j` launches it hidden, `-n`
  // opens a new instance rather than activating an existing one.
  await launch();

  await sleep(earlyProbeMs);
  let pids = (await owned.current()).map((record) => record.pid);
  if (pids.length === 0) {
    const after = await crashReportNames();
    const created = [...after].filter(
      (name) => !beforeCrashes.has(name) && name.startsWith("TaskNotes"),
    );
    if (created.length > 0) {
      const report = join(crashReports, created[0] ?? "");
      const text = await Bun.file(report).text();
      // The interesting line is the termination reason — for the bug this script
      // exists to catch it names the code signature rather than a Swift frame.
      const reason =
        /"termination":\{[^}]*\}/.exec(text)?.[0] ??
        /Library not loaded[^"]{0,200}/.exec(text)?.[0] ??
        "no termination detail found";
      fail(
        `the app crashed within ${earlyProbeMs / 1000}s.\n  ${report}\n  ${reason}`,
      );
    }
    fail(
      `the app was not running ${earlyProbeMs / 1000}s after launch, and wrote no crash ` +
        "report. It may have exited cleanly, which a GUI app should not do.",
    );
  }

  if (pids.length !== 1)
    fail("expected exactly one owned Release smoke process");
  const pid = pids[0];
  if (pid === undefined) fail("missing owned Release smoke process");
  const markerPath = join(stateDirectory, `started.${pid.toString()}`);
  const marker = Bun.file(markerPath);
  if (!(await marker.exists()))
    fail(`startup did not complete: missing ${markerPath}`);
  requireStartupMarker(smokeRunID, pid, await marker.text());
  const evidenceDirectory = join(
    packageRoot,
    ".build/release-smoke",
    smokeRunID,
  );
  await mkdir(evidenceDirectory, { recursive: true });
  await Bun.write(
    join(evidenceDirectory, "provenance.json"),
    `${JSON.stringify(
      {
        runID: smokeRunID,
        processID: pid,
        appPath,
        stateDirectory,
        markerPath,
        executableSHA256: new Bun.CryptoHasher("sha256")
          .update(
            await Bun.file(`${appPath}/Contents/MacOS/TaskNotes`).arrayBuffer(),
          )
          .digest("hex"),
        liveSyncAcceptance: false,
      },
      null,
      2,
    )}\n`,
  );

  await sleep(lateProbeMs - earlyProbeMs);
  pids = (await owned.current()).map((record) => record.pid);
  if (pids.length === 0) {
    fail(
      `the app died between ${earlyProbeMs / 1000}s and ${lateProbeMs / 1000}s`,
    );
  }
  if (pids.length !== 1 || pids[0] !== pid)
    fail("the owned Release smoke process changed");

  const frontAfter = await frontmostBundleId();
  if (frontAfter !== frontBefore) {
    // Not fatal to correctness, but this script runs while someone is typing.
    fail(
      `launching the app changed the frontmost application from "${frontBefore}" to ` +
        `"${frontAfter}". It was launched with -g -j and must not activate itself.`,
    );
  }

  await owned.shutdown();
  console.log(
    `verify-launch: Release bundle launched, survived ${lateProbeMs / 1000}s, ` +
      `completed isolated startup (${smokeRunID}), never took focus, and exited on SIGTERM`,
  );
}

async function execute(): Promise<void> {
  const uid = process.getuid?.();
  if (uid === undefined)
    throw new Error("Release smoke requires a current POSIX UID");
  const baseline = new Set(
    (await processSnapshot()).map((record) => record.pid),
  );
  const owned = new OwnedSmokeProcesses(
    {
      snapshot: processSnapshot,
      executableMatches: mappedExecutableMatches,
      signal(pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          ))
            throw error;
        }
      },
      now: Date.now,
      sleep,
    },
    `${join(appPath, "Contents/MacOS/TaskNotes")} --facet-release-smoke ${smokeRunID}`,
    uid,
    baseline,
  );
  const launch = new SmokeLaunchGate(
    () =>
      run([
        "open",
        "-g",
        "-j",
        "-n",
        appPath,
        "--args",
        "--facet-release-smoke",
        smokeRunID,
      ]),
    () => sleep(earlyProbeMs),
  );
  const cleanup = async (): Promise<void> => {
    await launch.settle();
    await owned.shutdown();
  };
  let cancelling = false;
  const cancel = async (signal: "SIGTERM" | "SIGINT"): Promise<void> => {
    if (cancelling) return;
    cancelling = true;
    launch.cancel();
    try {
      await cleanup();
    } catch (error) {
      reportFailure(error);
    }
    process.exit(signal === "SIGTERM" ? 143 : 130);
  };
  const terminate = (): void => {
    void cancel("SIGTERM");
  };
  const interrupt = (): void => {
    void cancel("SIGINT");
  };
  process.on("SIGTERM", terminate);
  process.on("SIGINT", interrupt);
  try {
    await withSmokeCleanup(() => main(owned, () => launch.launch()), cleanup);
  } finally {
    process.off("SIGTERM", terminate);
    process.off("SIGINT", interrupt);
  }
}

function reportFailure(error: unknown): void {
  console.error(
    `verify-launch: ${error instanceof Error ? error.message : "unexpected failure"}`,
  );
  if (error instanceof AggregateError)
    for (const cause of error.errors) reportFailure(cause);
}

if (import.meta.main) {
  try {
    await execute();
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
  }
}
