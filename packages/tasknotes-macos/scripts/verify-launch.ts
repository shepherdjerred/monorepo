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
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
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

/** The pids of every running copy of the app bundle under test. */
async function runningPids(): Promise<readonly number[]> {
  const child = Bun.spawn(
    ["pgrep", "-f", `${appPath}/Contents/MacOS/TaskNotes`],
    {
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  const stdout = await new Response(child.stdout).text();
  await child.exited;
  return stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
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

const beforeCrashes = await crashReportNames();
const frontBefore = await frontmostBundleId();

if ((await runningPids()).length > 0) {
  fail(
    "a copy of the Release bundle is already running; refusing to launch a second " +
      "and mistake its survival for this one's",
  );
}

console.log(`verify-launch: launching ${appPath} in the background`);
// `-g` does not bring it to the foreground, `-j` launches it hidden, `-n` opens
// a new instance rather than activating an existing one.
await run(["open", "-g", "-j", "-n", appPath]);

await sleep(earlyProbeMs);
let pids = await runningPids();
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
pids = await runningPids();
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
  if ((await runningPids()).length === 0) {
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
