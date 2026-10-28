import assert from "node:assert/strict";
import path from "node:path";
import { z } from "zod";
import {
  MacInputPreparedSchema,
  MacInputReadySchema,
  MacInputFinishedSchema,
  macInputFrame,
  macInputProtocol,
  macVerificationTiming,
  type MacInputPrepared,
} from "./protocol";

export const NativeWindowSchema = z.strictObject({
  startedAtUnixMilliseconds: z.number().int().positive(),
  finishedAtUnixMilliseconds: z.number().int().positive(),
});
export type MacNativeWindow = z.infer<typeof NativeWindowSchema>;
const CommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  argv: z.array(z.string().max(4096)).min(1).max(32),
  exitCode: z.literal(0),
  truncated: z.literal(false),
  timedOut: z.literal(false),
  complete: z.literal(true),
  startedAtUnixMilliseconds: z.number().int().positive(),
  finishedAtUnixMilliseconds: z.number().int().positive(),
});
const CaptureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("mac-input-collected"),
  sessionID: z.uuid(),
  evidenceDirectory: z.string(),
  files: z.array(z.string()).max(32),
  passed: z.literal(true),
  failure: z.literal("none"),
  privacyScope: z.literal(
    "owned-fixture-native-transport-declared-FDs-and-PID-time-unified-logs",
  ),
  unifiedLogLevel: z.tuple([z.literal("info"), z.literal("debug")]),
  mediaCount: z.literal(0),
});
function json(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function fdMap(bytes: Uint8Array, pid: number) {
  const fields = new Map<string, string>();
  let current = "",
    owner = 0;
  for (const line of new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .split("\n")) {
    if (line.startsWith("p")) {
      owner += 1;
      assert.equal(line, "p" + String(pid));
    } else if (line.startsWith("f")) {
      current = line.slice(1);
      assert.ok(current === "1" || current === "2");
    } else if (line.startsWith("n")) {
      assert.ok(current !== "" && !fields.has(current));
      fields.set(current, line.slice(1));
    } else assert.equal(line, "");
  }
  assert.equal(owner, 1);
  assert.equal(fields.size, 2);
  return fields;
}

/** Reused at initial measurement and every proof read; hashes cannot substitute for semantics. */
export function validateMacMeasuredOutputs(options: {
  prepared: MacInputPrepared;
  nativeStdout: Uint8Array;
  nativeStderr: Uint8Array;
  guestFiles: Record<string, Uint8Array>;
  nativeWindow: MacNativeWindow;
}) {
  const { prepared, guestFiles } = options,
    { input } = prepared;
  assert.equal(prepared.probe, true);
  const operation = macInputProtocol.operations[input.operation];
  assert.equal(operation.probe, true);
  const window = NativeWindowSchema.parse(options.nativeWindow),
    skew = macVerificationTiming.maximumClockSkewMilliseconds;
  assert.ok(
    window.finishedAtUnixMilliseconds >= window.startedAtUnixMilliseconds,
  );
  assert.ok(
    window.finishedAtUnixMilliseconds - window.startedAtUnixMilliseconds <=
      macInputProtocol.limits.sessionMilliseconds,
  );
  const get = (name: string) => {
    const value = guestFiles[name];
    assert.ok(value !== undefined);
    return value;
  };
  assert.equal(options.nativeStderr.length, 0);
  assert.ok(
    options.nativeStdout.length <= macInputProtocol.limits.frameBytes * 2,
  );
  const lines = new TextDecoder("utf-8", { fatal: true })
    .decode(options.nativeStdout)
    .split("\n");
  assert.equal(lines.pop(), "");
  assert.equal(lines.length, 2);
  const ready = MacInputReadySchema.parse(
    macInputFrame("ready", JSON.parse(lines[0] ?? "")),
  );
  const finished = MacInputFinishedSchema.parse(
    macInputFrame("finished", JSON.parse(lines[1] ?? "")),
  );
  for (const key of [
    "runID",
    "sessionID",
    "operation",
    "pid",
    "startSeconds",
    "startMicroseconds",
    "launchDate",
    "requestID",
  ] as const)
    assert.equal(ready[key], input[key]);
  for (const key of ["runID", "sessionID", "operation"] as const)
    assert.equal(finished[key], input[key]);
  assert.equal(ready.phase, operation.phase);
  assert.equal(finished.phase, operation.phase);
  assert.ok(
    ready.clockUnixMilliseconds >= window.startedAtUnixMilliseconds - skew &&
      ready.clockUnixMilliseconds <= window.finishedAtUnixMilliseconds + skew,
  );
  assert.equal(finished.cleared, true);
  assert.equal(finished.secureField, operation.phase === "credentials");
  assert.equal(finished.submitActionCount, operation.accountSubmits);
  assert.equal(finished.verificationCodeSubmitActionCount, 0);
  assert.equal(finished.intentRecorded, operation.accountSubmits === 1);
  assert.deepEqual(
    MacInputPreparedSchema.parse(json(get("prepared.json"))),
    prepared,
  );
  const known = [
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
    "capture.json",
  ];
  if (operation.accountSubmits === 1) {
    known.push("native-intent.json");
    const intent = macInputFrame("intent", json(get("native-intent.json")));
    for (const key of [
      "runID",
      "sessionID",
      "operation",
      "pid",
      "startSeconds",
      "startMicroseconds",
      "launchDate",
      "requestID",
      "remoteID",
      "helperSHA256",
      "protocolSHA256",
    ] as const)
      assert.equal(intent[key], input[key]);
    assert.equal(intent["phase"], operation.phase);
  }
  assert.deepEqual(Object.keys(guestFiles).sort(), known.sort());
  const fdMetadata = ["before", "after"].map((phase) => {
    const metadata = CommandSchema.parse(json(get("fd-" + phase + ".json")));
    assert.deepEqual(metadata.argv, [
      "/usr/sbin/lsof",
      "-n",
      "-P",
      "-a",
      "-p",
      String(input.pid),
      "-d",
      "1,2",
      "-F",
      "fn",
    ]);
    assert.equal(get("fd-" + phase + ".stderr").length, 0);
    const fields = fdMap(get("fd-" + phase + ".stdout"), input.pid);
    assert.equal(
      fields.get("1"),
      path.join(prepared.evidenceDirectory, "app.stdout"),
    );
    assert.equal(
      fields.get("2"),
      path.join(prepared.evidenceDirectory, "app.stderr"),
    );
    assert.ok(
      metadata.finishedAtUnixMilliseconds >= metadata.startedAtUnixMilliseconds,
    );
    return metadata;
  });
  const [before, after] = fdMetadata;
  assert.ok(before && after);
  assert.ok(
    before.finishedAtUnixMilliseconds <=
      window.startedAtUnixMilliseconds + skew,
  );
  assert.ok(
    after.startedAtUnixMilliseconds >= window.finishedAtUnixMilliseconds - skew,
  );
  assert.ok(before.startedAtUnixMilliseconds >= input.launchDate * 1000 - skew);
  const unified = CommandSchema.parse(json(get("unified.json")));
  const end = unified.argv[9];
  assert.ok(end !== undefined && /^@\d+(?:\.\d+)?$/u.test(end));
  const endMilliseconds = Number(end.slice(1)) * 1000;
  assert.deepEqual(unified.argv, [
    "/usr/bin/log",
    "show",
    "--info",
    "--debug",
    "--style",
    "ndjson",
    "--start",
    "@" + input.launchDate.toFixed(6),
    "--end",
    end,
    "--predicate",
    "processIdentifier == " + String(input.pid),
  ]);
  assert.ok(
    endMilliseconds >= after.finishedAtUnixMilliseconds &&
      endMilliseconds <= unified.startedAtUnixMilliseconds + skew,
  );
  assert.ok(
    unified.finishedAtUnixMilliseconds >= unified.startedAtUnixMilliseconds,
  );
  assert.equal(get("unified.stderr").length, 0);
  get("unified.stdout");
  const capture = CaptureSchema.parse(json(get("capture.json")));
  assert.equal(capture.sessionID, input.sessionID);
  assert.equal(capture.evidenceDirectory, prepared.evidenceDirectory);
  const prefix = "account-input/sessions/" + input.sessionID + "/";
  assert.deepEqual(
    [...capture.files].sort(),
    known.map((name) => prefix + name).sort(),
  );
  return { nativeFrames: 2, declaredGuestFiles: known.length, mediaCount: 0 };
}
