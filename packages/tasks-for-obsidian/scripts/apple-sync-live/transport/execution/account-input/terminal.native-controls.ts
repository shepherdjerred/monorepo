import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { childEnvironment } from "tasknotes-macos/scripts/mac-account-contract";
import { root } from "../../../model";
import { macAccountControlArguments } from "./prepare";
import { createMacPrivateIO } from "./session";

// Explicit native controls; no app, UI, credential backend or live run is opened.
assert.equal(process.platform, "darwin");
const controlArguments = Bun.argv.slice(2);
assert.ok(
  controlArguments.length === 0 ||
    JSON.stringify(controlArguments) === '["--deadline-only"]',
);
const deadlineOnly = controlArguments.length === 1;
const directory = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "facet-native-terminal-")),
);
const source = path.join(
  root,
  "packages/tasknotes-macos/scripts/native/mac-account",
);
const program = path.join(directory, "terminal-controls");
const compile = spawnSync(
  "/usr/bin/xcrun",
  [
    "swiftc",
    "-warnings-as-errors",
    path.join(source, "MacAccountProtocol.swift"),
    path.join(source, "MacAccountIO.swift"),
    path.join(source, "terminal-controls/main.swift"),
    "-o",
    program,
  ],
  { env: childEnvironment(Bun.env), timeout: 60_000, maxBuffer: 1_048_576 },
);

async function control(
  mode: "fixed" | "nonzero" | "diagnostic" | "trailing-output",
  extraInput = false,
) {
  const child = Bun.spawn(macAccountControlArguments(program), {
    env: childEnvironment(Bun.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const io = createMacPrivateIO(child, true, performance.now() + 5000, () => {
    process.kill(-child.pid, "SIGKILL");
  });
  let passed = false;
  try {
    await child.stdin.write(JSON.stringify({ mode }) + "\n");
    await child.stdin.flush();
    const receipt = await io.read();
    assert.ok(receipt !== null && typeof receipt === "object");
    assert.equal(Reflect.get(receipt, "kind"), "finished");
    const pid: unknown = Reflect.get(receipt, "pid");
    assert.ok(typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0);
    // The original receiver has emitted FINISHED while its real pipe remains open.
    process.kill(pid, 0);
    assert.equal(child.exitCode, null);
    if (extraInput) {
      await child.stdin.write("X");
      await child.stdin.flush();
    }
    const failure =
      extraInput || mode === "trailing-output"
        ? /Mac private trailing output/u
        : mode === "nonzero"
          ? /Mac private native rejected operation/u
          : mode === "diagnostic"
            ? /Mac private native emitted diagnostics/u
            : null;
    if (failure === null) {
      await io.finish();
      assert.equal(io.capture().complete, true);
      passed = true;
    } else {
      await assert.rejects(io.finish(), failure);
      assert.equal(io.capture().complete, false);
    }
    const captured = io.capture();
    assert.equal(
      new TextDecoder().decode(captured.stderr),
      mode === "diagnostic" ? "synthetic diagnostic\n" : "",
    );
    if (extraInput) {
      assert.match(
        new TextDecoder().decode(captured.stdout),
        /"reason":"input"/u,
      );
    }
  } finally {
    if (!passed) await io.abort();
  }
}

async function deadlineControl(mode: "native-deadline" | "long-deadline") {
  const child = Bun.spawn(macAccountControlArguments(program), {
    env: childEnvironment(Bun.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const io = createMacPrivateIO(child, true, performance.now() + 5000, () => {
    process.kill(-child.pid, "SIGKILL");
  });
  try {
    await child.stdin.write(JSON.stringify({ mode }) + "\n");
    await child.stdin.flush();
    if (mode === "native-deadline") {
      const finished = await io.read();
      assert.ok(finished !== null && typeof finished === "object");
      assert.equal(Reflect.get(finished, "kind"), "finished");
    }
    // No end()/finish()/abort() has run: the actual source pipe is still open.
    assert.deepEqual(await io.read(), { kind: "rejected", reason: "deadline" });
    await assert.rejects(io.finish(), /Mac private native rejected operation/u);
    assert.equal(child.exitCode, 3);
    assert.equal(io.capture().complete, false);
    assert.equal(io.capture().stderr.length, 0);
  } finally {
    await io.abort();
  }
  assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
}

try {
  assert.equal(compile.status, 0, "Original terminal stream must compile");
  assert.equal(compile.stderr.length, 0);
  if (deadlineOnly) {
    await deadlineControl("native-deadline");
    await deadlineControl("long-deadline");
    console.log(
      JSON.stringify({
        originalMacInputStream: true,
        nativeEOFDeadlineRejectedBeforeSourceEOF: true,
        longerThan120SecondsRejected: true,
        ownedGroupsRetired: true,
        productionDefaultSeconds: 120,
        uiActions: 0,
        credentialReads: 0,
      }),
    );
  } else {
    await control("fixed");
    await control("fixed", true);
    await control("nonzero");
    await control("diagnostic");
    await control("trailing-output");
    console.log(
      JSON.stringify({
        originalMacInputStream: true,
        actualBunAndDarwinPipes: true,
        heldUntilEOF: true,
        emptyEOFCleanExit: true,
        trailingInputRejected: true,
        nativeExit23Preserved: true,
        diagnosticsRejected: true,
        trailingOutputRejected: true,
        uiActions: 0,
        credentialReads: 0,
      }),
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
