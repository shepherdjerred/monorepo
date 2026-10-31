import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { childEnvironment } from "tasknotes-macos/scripts/mac-account-contract";
import { root } from "../../../model";
import { executePrivateTransport } from "../../host";
import { macAccountControlArguments } from "./prepare";

// Explicit macOS controls, never discovered by Vitest or allowed to touch an app.
assert.equal(
  process.platform,
  "darwin",
  "Native inspection controls require macOS",
);
const directory = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "facet-native-inspection-")),
);
const encoder = new TextEncoder();
const frame = (value: unknown, newline = true) =>
  encoder.encode(JSON.stringify(value) + (newline ? "\n" : ""));

// Only the test entry point is new: admission and decoding compile from original sources.
const fixture = String.raw`import Darwin
import Foundation

do {
    guard CommandLine.arguments.count == 1 else { exit(2) }
    let stream = try MacInputStream()
    let decoded = try stream.next(allowEOF: true)
    switch decoded["action"] as? String {
    case "echo":
        guard let payload = decoded["payload"] as? String else { exit(2) }
        FileHandle.standardOutput.write(Data(payload.utf8))
    case "reject":
        FileHandle.standardOutput.write(Data("native-rejected\n".utf8))
        exit(23)
    case "wait":
        guard let filename = decoded["pidFile"] as? String else { exit(2) }
        let data = try JSONSerialization.data(withJSONObject: ["pid": getpid(), "pgid": getpgrp()])
        try data.write(to: URL(fileURLWithPath: filename), options: .withoutOverwriting)
        while true { pause() }
    default:
        exit(2)
    }
} catch {
    FileHandle.standardOutput.write(Data("stream-rejected\n".utf8))
    exit(3)
}
`;

async function compileFixture() {
  const main = path.join(directory, "main.swift");
  await writeFile(main, fixture, { flag: "wx", mode: 0o600 });
  const original = path.join(
    root,
    "packages/tasknotes-macos/scripts/native/mac-account",
  );
  const program = path.join(directory, "native input '$;fixture");
  const compiled = spawnSync(
    "/usr/bin/xcrun",
    [
      "swiftc",
      "-warnings-as-errors",
      "-target",
      `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`,
      path.join(original, "MacAccountProtocol.swift"),
      path.join(original, "MacAccountIO.swift"),
      main,
      "-o",
      program,
    ],
    { env: childEnvironment(Bun.env), timeout: 60_000, maxBuffer: 1_048_576 },
  );
  assert.equal(compiled.status, 0, "Original native stream must compile");
  assert.equal(
    compiled.stderr.length,
    0,
    "Native compilation must be diagnostic-free",
  );
  return program;
}

async function runStreamControls(program: string) {
  const argv = macAccountControlArguments(program);
  assert.equal(argv.at(-1), program);
  assert.equal(argv.filter((entry) => entry.includes(program)).length, 1);
  const payload = "public binary-exact value\0\r\né🙂";
  const direct = await executePrivateTransport(
    [program],
    frame({ action: "echo", payload }),
    5000,
  );
  assert.equal(
    direct.exitCode,
    3,
    "Direct Bun socket stdio must remain rejected",
  );
  assert.equal(new TextDecoder().decode(direct.stdout), "stream-rejected\n");
  assert.equal(direct.stderr.length, 0);
  for (const newline of [true, false]) {
    const input = frame({ action: "echo", payload }, newline);
    const before = Uint8Array.from(input);
    const actual = await executePrivateTransport(argv, input, 5000);
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stderr.length, 0);
    assert.deepEqual(actual.stdout, encoder.encode(payload));
    assert.deepEqual(input, before);
  }
  const rejected = await executePrivateTransport(
    argv,
    frame({ action: "reject" }),
    5000,
  );
  assert.equal(
    rejected.exitCode,
    23,
    "Output relay success must not hide native failure",
  );
  assert.equal(new TextDecoder().decode(rejected.stdout), "native-rejected\n");
  assert.equal(rejected.stderr.length, 0);
  for (const input of [
    encoder.encode("{invalid\n"),
    frame({ action: "echo", payload: "A".repeat(8200) }),
  ]) {
    const actual = await executePrivateTransport(argv, input, 5000);
    assert.equal(actual.exitCode, 3);
    assert.equal(new TextDecoder().decode(actual.stdout), "stream-rejected\n");
    assert.equal(actual.stderr.length, 0);
  }
}

function groupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    assert.equal(
      z.object({ code: z.literal("ESRCH") }).safeParse(error).success,
      true,
    );
    return false;
  }
}

async function runDeadlineControl(program: string) {
  const pidFile = path.join(directory, "public-process.json");
  const started = performance.now();
  await assert.rejects(
    executePrivateTransport(
      macAccountControlArguments(program),
      frame({ action: "wait", pidFile }),
      1000,
    ),
    /submission outcome is unknown/u,
  );
  assert.ok(
    performance.now() - started < 5000,
    "Owned pipeline must retire within its bound",
  );
  const owner = z
    .strictObject({
      pid: z.number().int().positive(),
      pgid: z.number().int().positive(),
    })
    .parse(JSON.parse(await readFile(pidFile, "utf8")));
  assert.notEqual(owner.pid, process.pid);
  assert.notEqual(owner.pgid, process.pid);
  const deadline = performance.now() + 2000;
  while (groupExists(owner.pgid) && performance.now() < deadline)
    await Bun.sleep(10);
  assert.equal(
    groupExists(owner.pgid),
    false,
    "No native or relay may retain the owned group",
  );
}

try {
  const program = await compileFixture();
  await runStreamControls(program);
  await runDeadlineControl(program);
  console.log(
    JSON.stringify({
      originalMacInputStream: true,
      actualBunSpawn: true,
      controlsPassed: 7,
      binaryExact: true,
      eofComplete: true,
      nativeExit23Preserved: true,
      malformedAndOversizedRejected: true,
      wholeOwnedGroupRetired: true,
      uiActions: 0,
      credentialReads: 0,
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
