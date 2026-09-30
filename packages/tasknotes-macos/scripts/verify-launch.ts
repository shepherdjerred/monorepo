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
// earlier run. (Pid reuse inside the ~10s probe window would require the
// allocator to wrap all the way around to a baseline value; macOS pids are
// sequential to 99999, so this is not a real attribution hazard.)
//
// ## Why cancellation reaps the launched copy
//
// The trap below exists to close the orphaning window, not to duplicate the
// normal shutdown. On SIGTERM/SIGINT it SIGTERMs exactly the pids this run
// launched and then exits, so a canceled job stops leaking one idle GUI app
// per cancellation onto the persistent CI host.

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const appPath = join(
  packageRoot,
  ".build/xcode/Build/Products/Release/TaskNotes.app",
);
const crashReports = join(homedir(), "Library/Logs/DiagnosticReports");

/** How long the app must survive. Two probes, so a slow crash is still caught. */
const earlyProbeMs = 3_000;
const lateProbeMs = 8_000;

/** How long it gets to exit after SIGTERM before we call the run loop hung. */
const shutdownMs = 5_000;

function fail(message: string): never {
  console.error(`verify-launch: ${message}`);
  process.exit(1);
}

async function run(command: readonly string[]): Promise<string> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const status = await child.exited;
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

/** Parse `pgrep` output into pids, ignoring blank and malformed lines. */
export function parsePids(stdout: string): readonly number[] {
  return stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * The pids in `current` that were not already running at startup: exactly the
 * copies this run launched. Everything this script asserts on or signals goes
 * through this subtraction.
 */
export function excludeBaseline(
  current: readonly number[],
  baseline: ReadonlySet<number>,
): readonly number[] {
  return current.filter((pid) => !baseline.has(pid));
}

/** The pids of every running copy of the app bundle under test. */
async function runningPids(
  executablePath = `${appPath}/Contents/MacOS/TaskNotes`,
): Promise<readonly number[]> {
  const child = Bun.spawn(["pgrep", "-f", executablePath], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(child.stdout).text();
  await child.exited;
  return parsePids(stdout);
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

/** Pids already running when this run started. Never asserted on, never signaled. */
let baselinePids: ReadonlySet<number> = new Set();

/**
 * SIGTERM/SIGINT arrive here on job cancellation or Ctrl-C: reap exactly the
 * copies this run launched, then exit with the conventional 128+signo status.
 * Installed before `open` so the launch-to-cleanup window is covered. A signal
 * that arrives before the launch simply finds nothing of ours to reap.
 */
async function reapOursAndExit(signal: "SIGTERM" | "SIGINT"): Promise<never> {
  const ours = excludeBaseline(await runningPids(), baselinePids);
  for (const pid of ours) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone; the run is over either way.
    }
  }
  const deadline = Date.now() + shutdownMs;
  while (Date.now() < deadline) {
    if (excludeBaseline(await runningPids(), baselinePids).length === 0) break;
    await sleep(200);
  }
  process.exit(signal === "SIGTERM" ? 143 : 130);
}

async function main(): Promise<void> {
  const beforeCrashes = await crashReportNames();
  const frontBefore = await frontmostBundleId();

  baselinePids = new Set(await runningPids());
  if (baselinePids.size > 0) {
    // Host state, not evidence about this build's bundle: a copy orphaned by
    // a canceled run (or left running deliberately for inspection) must not
    // fail this run, and must not be mistaken for the copy launched below.
    console.warn(
      `verify-launch: ignoring ${baselinePids.size.toString()} already-running ` +
        `copies (pids ${[...baselinePids].join(", ")}); asserting only on the copy launched below`,
    );
  }
  process.on("SIGTERM", () => void reapOursAndExit("SIGTERM"));
  process.on("SIGINT", () => void reapOursAndExit("SIGINT"));

  console.log(`verify-launch: launching ${appPath} in the background`);
  // `-g` does not bring it to the foreground, `-j` launches it hidden, `-n`
  // opens a new instance rather than activating an existing one.
  await run(["open", "-g", "-j", "-n", appPath]);

  await sleep(earlyProbeMs);
  let pids = excludeBaseline(await runningPids(), baselinePids);
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

  await sleep(lateProbeMs - earlyProbeMs);
  pids = excludeBaseline(await runningPids(), baselinePids);
  if (pids.length === 0) {
    fail(
      `the app died between ${earlyProbeMs / 1000}s and ${lateProbeMs / 1000}s`,
    );
  }

  const frontAfter = await frontmostBundleId();
  if (frontAfter !== frontBefore) {
    // Not fatal to correctness, but this script runs while someone is typing.
    fail(
      `launching the app changed the frontmost application from "${frontBefore}" to ` +
        `"${frontAfter}". It was launched with -g -j and must not activate itself.`,
    );
  }

  for (const pid of pids) {
    process.kill(pid, "SIGTERM");
  }

  const deadline = Date.now() + shutdownMs;
  while (Date.now() < deadline) {
    if (excludeBaseline(await runningPids(), baselinePids).length === 0) {
      console.log(
        `verify-launch: Release bundle launched, survived ${lateProbeMs / 1000}s, ` +
          "never took focus, and exited on SIGTERM",
      );
      process.exit(0);
    }
    await sleep(200);
  }

  fail(
    `the app did not exit within ${shutdownMs / 1000}s of SIGTERM, so its run loop is ` +
      "wedged. Left running deliberately rather than SIGKILLed, so it can be inspected.",
  );
}

if (import.meta.main) await main();
