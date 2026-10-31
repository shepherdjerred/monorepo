import assert from "node:assert/strict";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { childEnvironment } from "tasknotes-macos/scripts/mac-account-contract";
import { inspectOwnedMacProcesses } from "../../../mac-process-inspection";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export";
import type { GuestRuntime } from "../runtime";
import {
  MacInputPreparedSchema,
  macInputFrame,
  macInputProtocol,
  type MacInputPrepared,
} from "./protocol";
import { prepareNormalMacAccount } from "./readiness";
import type { MacLifecycle } from "./prepare";
import { macUnifiedLogQuery, type MacLogInterval } from "./unified-log";

const maximum = 8 * 1024 * 1024;
type Captured = {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number | null;
  truncated: boolean;
  timedOut: boolean;
  complete: boolean;
  startedAtUnixMilliseconds: number;
  finishedAtUnixMilliseconds: number;
};
type CapturedProcess = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exitCode: number | null;
  exited: Promise<number>;
};
type CaptureReader = {
  read: () => Promise<
    | { done: true; value?: Uint8Array | undefined }
    | { done: false; value: Uint8Array }
  >;
  cancel: () => Promise<void>;
};
export async function captureMacProcess(
  child: CapturedProcess,
  deadline: number,
  terminateOwned: () => void,
): Promise<Captured> {
  const startedAtUnixMilliseconds = Date.now();
  let truncated = false,
    timedOut = false,
    complete = true;
  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  const stop = () => {
    if (child.exitCode === null) {
      try {
        terminateOwned();
      } catch {
        complete = false;
      }
    }
  };
  const expiration = Promise.withResolvers<never>();
  const observeExpiration = async () => {
    try {
      await expiration.promise;
    } catch {
      /* The active bounded operations report expiration. */
    }
  };
  void observeExpiration();
  const cancel = () =>
    Promise.allSettled(readers.map((reader) => reader.cancel()));
  const timer = setTimeout(
    () => {
      timedOut = true;
      complete = false;
      stop();
      void cancel();
      expiration.reject(new Error("Mac log collection deadline expired"));
    },
    Math.max(0, deadline - performance.now()),
  );
  const bounded = <T>(work: Promise<T>): Promise<T> => {
    if (performance.now() >= deadline) {
      timedOut = true;
      complete = false;
      stop();
      return Promise.reject(new Error("Mac log collection deadline expired"));
    }
    return Promise.race([work, expiration.promise]);
  };
  const drain = async (reader: CaptureReader) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await bounded(reader.read());
        if (next.done) break;
        const bytes = next.value;
        if (size + bytes.length > maximum) {
          chunks.push(bytes.slice(0, Math.max(0, maximum - size)));
          truncated = true;
          complete = false;
          stop();
          break;
        }
        chunks.push(bytes);
        size += bytes.length;
      }
    } catch {
      complete = false;
      stop();
    }
    return Buffer.concat(chunks);
  };
  try {
    const [output, errors] = readers;
    assert.ok(output && errors);
    const [stdout, stderr, exitCode] = await Promise.all([
      drain(output),
      drain(errors),
      bounded(child.exited).catch(() => null),
    ]);
    try {
      await bounded(cancel());
    } catch {
      complete = false;
    }
    return {
      stdout,
      stderr,
      exitCode,
      truncated,
      timedOut,
      complete,
      startedAtUnixMilliseconds,
      finishedAtUnixMilliseconds: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
async function capture(argv: string[]): Promise<Captured> {
  const child = Bun.spawn(argv, {
    env: childEnvironment(Bun.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  return captureMacProcess(child, performance.now() + 30_000, () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  });
}
async function retain(
  directory: string,
  name: string,
  result: Captured,
  {
    argv,
    requestedInterval,
  }: { argv: string[]; requestedInterval?: MacLogInterval },
) {
  let failed = false;
  for (const [file, bytes] of [
    [name + ".stdout", result.stdout],
    [name + ".stderr", result.stderr],
    [
      name + ".json",
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          argv,
          exitCode: result.exitCode,
          truncated: result.truncated,
          timedOut: result.timedOut,
          complete: result.complete,
          startedAtUnixMilliseconds: result.startedAtUnixMilliseconds,
          finishedAtUnixMilliseconds: result.finishedAtUnixMilliseconds,
          ...(requestedInterval === undefined ? {} : { requestedInterval }),
        }),
      ),
    ],
  ] as const) {
    try {
      await writeFile(path.join(directory, file), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      failed = true;
    }
  }
  assert.equal(failed, false, "Synthetic Mac output retention incomplete");
}

export async function captureMacFileDescriptors(
  prepared: MacInputPrepared,
  phase: "before" | "after",
) {
  assert.equal(prepared.probe, true);
  const argv = [
    "/usr/sbin/lsof",
    "-n",
    "-P",
    "-a",
    "-p",
    String(prepared.input.pid),
    "-d",
    "1,2",
    "-F",
    "fn",
  ];
  const result = await capture(argv);
  await retain(prepared.evidenceDirectory, "fd-" + phase, result, { argv });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr.length, 0);
  assert.ok(result.complete && !result.truncated && !result.timedOut);
  const fields = new Map<string, string>();
  let current = "";
  for (const line of new TextDecoder("utf-8", { fatal: true })
    .decode(result.stdout)
    .split("\n")) {
    if (line.startsWith("f")) current = line.slice(1);
    else if (line.startsWith("n")) {
      assert.ok(current === "1" || current === "2");
      assert.equal(fields.has(current), false);
      fields.set(current, line.slice(1));
    }
  }
  assert.equal(fields.size, 2);
  assert.equal(
    fields.get("1"),
    path.join(prepared.evidenceDirectory, "app.stdout"),
  );
  assert.equal(
    fields.get("2"),
    path.join(prepared.evidenceDirectory, "app.stderr"),
  );
}

export async function collectGuestMacInput(
  runtime: GuestRuntime,
  sessionID: string,
) {
  const directory = path.join(
    runtime.paths.evidenceDirectory,
    "account-input/sessions",
    sessionID,
  );
  const prepared = MacInputPreparedSchema.parse(
    await readOwnedMacVMJSON(path.join(directory, "prepared.json"), 65_536),
  );
  assert.equal(prepared.input.runID, runtime.config.runID);
  assert.equal(prepared.input.sessionID, sessionID);
  assert.equal(prepared.evidenceDirectory, directory);
  assert.equal(prepared.probe, true);
  let failure: "none" | "fd" | "log" | "output" | "owner" | "capture" = "none";
  const owners = await inspectOwnedMacProcesses(
    prepared.input.executable,
    5000,
  );
  if (owners.length !== 1 || Number(owners[0]) !== prepared.input.pid)
    failure = "owner";
  else {
    try {
      await captureMacFileDescriptors(prepared, "after");
    } catch {
      failure = "fd";
    }
    await runtime.retire();
    const end = Date.now();
    const query = macUnifiedLogQuery(
      prepared.input.pid,
      prepared.input.launchDate,
      end,
    );
    try {
      const result = await capture(query.argv);
      await retain(directory, "unified", result, {
        argv: query.argv,
        requestedInterval: query.interval,
      });
      if (
        result.exitCode !== 0 ||
        result.stderr.length > 0 ||
        !result.complete ||
        result.truncated ||
        result.timedOut
      )
        failure = "log";
    } catch {
      failure = "capture";
    }
  }
  const { known, failed } = await retainIntent(runtime, prepared);
  if (failed) failure = "capture";
  const files = await readdir(directory);
  for (const name of files) {
    assert.ok(known.has(name), "Unexpected synthetic Mac evidence file");
    const stat = await lstat(path.join(directory, name));
    assert.ok(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.uid === process.getuid?.(),
    );
    assert.equal(stat.mode & 0o777, 0o600);
    if (stat.size > maximum) failure = "output";
  }
  if (failure === "none" && files.length !== known.size) failure = "capture";
  const record = {
    kind: "mac-input-collected" as const,
    sessionID,
    evidenceDirectory: directory,
    files: [...files, "capture.json"]
      .map((name) =>
        path.relative(
          runtime.paths.evidenceDirectory,
          path.join(directory, name),
        ),
      )
      .sort(),
    passed: failure === "none",
    failure,
  };
  await writeFile(
    path.join(directory, "capture.json"),
    JSON.stringify({
      schemaVersion: 1,
      ...record,
      privacyScope:
        "owned-fixture-native-transport-declared-FDs-and-PID-time-unified-logs",
      unifiedLogLevel: ["info", "debug"],
      mediaCount: 0,
    }),
    { flag: "wx", mode: 0o600 },
  );
  return record;
}
async function retainIntent(runtime: GuestRuntime, prepared: MacInputPrepared) {
  const {
    evidenceDirectory: directory,
    input: { sessionID },
  } = prepared;
  const known = new Set([
    "prepared.json",
    "app.stdout",
    "app.stderr",
    "fd-before.stdout",
    "fd-before.stderr",
    "fd-before.json",
    "fd-after.stdout",
    "fd-after.stderr",
    "fd-after.json",
    "unified.stdout",
    "unified.stderr",
    "unified.json",
  ]);
  const intentFile = path.join(
    runtime.paths.stateDirectory,
    "account-input/intents",
    sessionID + ".json",
  );
  try {
    const intent = await readFile(intentFile);
    assert.equal(
      macInputProtocol.operations[prepared.input.operation].accountSubmits,
      1,
    );
    const value = macInputFrame("intent", JSON.parse(intent.toString()));
    for (const key of [
      "runID",
      "sessionID",
      "operation",
      "pid",
      "startSeconds",
      "startMicroseconds",
      "launchDate",
      "remoteID",
      "helperSHA256",
      "protocolSHA256",
    ] as const)
      assert.equal(value[key], prepared.input[key]);
    await writeFile(path.join(directory, "native-intent.json"), intent, {
      flag: "wx",
      mode: 0o600,
    });
    known.add("native-intent.json");
  } catch (error) {
    const missing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    if (
      !missing ||
      macInputProtocol.operations[prepared.input.operation].accountSubmits !== 0
    )
      return { known, failed: true };
  }
  return { known, failed: false };
}

export async function installGuestMacInputApproval(
  runtime: GuestRuntime,
  raw: Uint8Array,
  context: { remoteID: string; lifecycle: MacLifecycle },
) {
  const { MacInputApprovalSchema } = await import("./protocol");
  const approval = MacInputApprovalSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
  );
  assert.equal(approval.runID, runtime.config.runID);
  assert.equal(approval.guestConfigSHA256, runtime.expectedConfigSHA);
  const directory = path.join(runtime.paths.stateDirectory, "account-input");
  const stat = await lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(context.lifecycle, null);
  const { prepareMacInputNative, legacyMacBinding, waitInspection } =
    await import("./prepare");
  const native = await prepareMacInputNative(runtime, false);
  for (const key of ["helperSHA256", "protocolSHA256", "timingSHA256"] as const)
    assert.equal(approval[key], native[key]);
  await writeFile(path.join(directory, "private-input-approved.json"), raw, {
    flag: "wx",
    mode: 0o600,
  });
  await prepareNormalMacAccount({
    runID: runtime.config.runID,
    launch: () =>
      runtime.command([
        "/usr/bin/env",
        "-u",
        "FACET_E2E_ACCOUNT_OPERATION",
        "-u",
        "FACET_E2E_ACCOUNT_MODE",
        "-u",
        "FACET_E2E_RUN_ID",
        "-u",
        "FACET_E2E_ACCOUNT_SESSION",
        "/usr/bin/open",
        "-n",
        runtime.paths.app,
        "--args",
        "--facet-acceptance-descriptor",
        runtime.paths.descriptor,
      ]),
    readStatus: () =>
      readOwnedMacVMJSON(
        path.join(runtime.paths.stateDirectory, "control/status.json"),
        65_536,
      ),
    inspectOwner: () =>
      waitInspection(
        native.program,
        legacyMacBinding(runtime, context.remoteID, context.lifecycle),
        "inspect_onboarding",
      ),
  });
  return {
    kind: "mac-input-approved" as const,
    approvalSHA256: new Bun.CryptoHasher("sha256").update(raw).digest("hex"),
  };
}
