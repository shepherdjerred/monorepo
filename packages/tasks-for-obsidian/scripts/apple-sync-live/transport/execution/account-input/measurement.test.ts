import { expect, test } from "vitest";
import { z } from "zod";
import { validateMacMeasuredOutputs } from "./measurement";
import { MacInputPreparedSchema, macInputProtocol } from "./protocol";

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const text = (value: string) => new TextEncoder().encode(value);
type Phase = "credentials-probe" | "verification-probe";
const command = (argv: string[], start: number, end: number) => ({
  schemaVersion: 1,
  argv,
  exitCode: 0,
  truncated: false,
  timedOut: false,
  complete: true,
  startedAtUnixMilliseconds: start,
  finishedAtUnixMilliseconds: end,
});
function fixture(operation: Phase = "credentials-probe") {
  const selected = macInputProtocol.operations[operation];
  const sessionID = "7c94e51d-5c49-4a3b-ae5e-f94392f8caed";
  const prepared = MacInputPreparedSchema.parse({
    kind: "mac-input-prepared",
    program: "/private/tmp/probe/helper",
    evidenceDirectory: "/private/tmp/probe/evidence",
    probe: true,
    input: {
      schemaVersion: 1,
      kind: "mac-private-account-input",
      mode: "private_session",
      operation,
      sessionID,
      runID: "8a98d3ac-739b-433c-aa97-0944cd93fd03",
      remoteID: "synthetic",
      runDirectory: "/private/tmp/probe",
      executable: "/private/tmp/probe/app",
      container: "/private/tmp/probe/container",
      stateDirectory: "/private/tmp/probe/state",
      lifecycle: null,
      guestConfigSHA256: "a".repeat(64),
      pid: 123,
      startSeconds: 999,
      startMicroseconds: 0,
      launchDate: 999,
      requestID: null,
      helperSHA256: "b".repeat(64),
      protocolSHA256: "c".repeat(64),
      timingSHA256: "d".repeat(64),
      approvalSHA256: null,
    },
  });
  const { input } = prepared;
  const envelope = {
    schemaVersion: 1,
    sessionID,
    runID: input.runID,
    operation,
    phase: selected.phase,
  };
  const ready = {
    ...envelope,
    kind: "ready",
    pid: input.pid,
    startSeconds: input.startSeconds,
    startMicroseconds: input.startMicroseconds,
    launchDate: input.launchDate,
    requestID: null,
    clockUnixMilliseconds: 1_000_001,
  };
  const finished = {
    ...envelope,
    kind: "finished",
    cleared: true,
    secureField: selected.phase === "credentials",
    submitActionCount: selected.accountSubmits,
    verificationCodeSubmitActionCount: 0,
    intentRecorded: selected.accountSubmits === 1,
  };
  const nativeWindow = {
    startedAtUnixMilliseconds: 1_000_000,
    finishedAtUnixMilliseconds: 1_005_000,
  };
  const fdArgv = [
    "/usr/sbin/lsof",
    "-n",
    "-P",
    "-a",
    "-p",
    "123",
    "-d",
    "1,2",
    "-F",
    "fn",
  ];
  const descriptors =
    "p123\nf1\nn/private/tmp/probe/evidence/app.stdout\nf2\nn/private/tmp/probe/evidence/app.stderr\n";
  const guestFiles: Record<string, Uint8Array> = {
    "prepared.json": encode(prepared),
    "app.stdout": text(""),
    "app.stderr": text(""),
    "fd-before.stdout": text(descriptors),
    "fd-before.stderr": text(""),
    "fd-before.json": encode(command(fdArgv, 999_900, 999_950)),
    "fd-after.stdout": text(descriptors),
    "fd-after.stderr": text(""),
    "fd-after.json": encode(command(fdArgv, 1_005_001, 1_005_010)),
    "unified.stdout": text('{"count":0,"finished":1}\n'),
    "unified.stderr": text(""),
    "unified.json": encode({
      ...command(
        [
          "/usr/bin/log",
          "show",
          "--info",
          "--debug",
          "--style",
          "ndjson",
          "--start",
          "1970-01-01 00:16:39+0000",
          "--end",
          "1970-01-01 00:16:46+0000",
          "--predicate",
          "processIdentifier == 123",
        ],
        1_005_020,
        1_005_030,
      ),
      requestedInterval: {
        startUnixMilliseconds: 999_000,
        endUnixMilliseconds: 1_005_015,
      },
    }),
  };
  if (operation === "verification-probe")
    guestFiles["native-intent.json"] = encode({
      ...envelope,
      pid: input.pid,
      startSeconds: input.startSeconds,
      startMicroseconds: input.startMicroseconds,
      launchDate: input.launchDate,
      requestID: null,
      remoteID: input.remoteID,
      helperSHA256: input.helperSHA256,
      protocolSHA256: input.protocolSHA256,
    });
  const known = [...Object.keys(guestFiles), "capture.json"];
  guestFiles["capture.json"] = encode({
    schemaVersion: 1,
    kind: "mac-input-collected",
    sessionID,
    evidenceDirectory: prepared.evidenceDirectory,
    files: known.map((name) => `account-input/sessions/${sessionID}/${name}`),
    passed: true,
    failure: "none",
    privacyScope:
      "owned-fixture-native-transport-declared-FDs-and-PID-time-unified-logs",
    unifiedLogLevel: ["info", "debug"],
    mediaCount: 0,
  });
  return {
    prepared,
    nativeStdout: text(
      JSON.stringify(ready) + "\n" + JSON.stringify(finished) + "\n",
    ),
    nativeStderr: text(""),
    guestFiles,
    nativeWindow,
    ready,
    finished,
  };
}
function replaceJSON(
  value: ReturnType<typeof fixture>,
  name: string,
  change: (raw: Record<string, unknown>) => void,
) {
  const raw = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(new TextDecoder().decode(value.guestFiles[name])));
  change(raw);
  value.guestFiles[name] = encode(raw);
}

test.each(["credentials-probe", "verification-probe"] as const)(
  "%s accepts exact raw native/FD/unified semantics",
  (operation) => {
    const value = fixture(operation);
    expect(validateMacMeasuredOutputs(value)).toEqual({
      nativeFrames: 2,
      declaredGuestFiles: operation === "credentials-probe" ? 13 : 14,
      mediaCount: 0,
    });
  },
);

test.each([
  { pid: 124 },
  { phase: "verification" },
  { sessionID: "8a98d3ac-739b-433c-aa97-0944cd93fd03" },
])("wrong actual native READY rejects before approval (%j)", (change) => {
  const value = fixture();
  value.nativeStdout = text(
    JSON.stringify({ ...value.ready, ...change }) +
      "\n" +
      JSON.stringify(value.finished) +
      "\n",
  );
  expect(() => validateMacMeasuredOutputs(value)).toThrow();
});
test.each([
  { submitActionCount: 1 },
  { verificationCodeSubmitActionCount: 1 },
  { cleared: false },
  { secureField: false },
])("wrong actual native finished/counts reject (%j)", (change) => {
  const value = fixture();
  value.nativeStdout = text(
    JSON.stringify(value.ready) +
      "\n" +
      JSON.stringify({ ...value.finished, ...change }) +
      "\n",
  );
  expect(() => validateMacMeasuredOutputs(value)).toThrow();
});
test("native trailing output, diagnostics and incorrect FD owner/target reject", () => {
  for (const variant of ["trailing", "stderr", "fd-owner", "fd-target"]) {
    const value = fixture();
    if (variant === "trailing")
      value.nativeStdout = text(
        new TextDecoder().decode(value.nativeStdout) + "{}\n",
      );
    if (variant === "stderr") value.nativeStderr = text("synthetic-diagnostic");
    if (variant === "fd-owner")
      value.guestFiles["fd-after.stdout"] = text(
        "p124\nf1\nn/private/tmp/probe/evidence/app.stdout\nf2\nn/private/tmp/probe/evidence/app.stderr\n",
      );
    if (variant === "fd-target")
      value.guestFiles["fd-before.stdout"] = text(
        "p123\nf1\nn/dev/null\nf2\nn/private/tmp/probe/evidence/app.stderr\n",
      );
    expect(() => validateMacMeasuredOutputs(value)).toThrow();
  }
});
test("FD measurements must bracket the actual native interval", () => {
  const before = fixture();
  replaceJSON(before, "fd-before.json", (raw) => {
    raw["finishedAtUnixMilliseconds"] = 1_003_000;
  });
  expect(() => validateMacMeasuredOutputs(before)).toThrow();
  const after = fixture();
  replaceJSON(after, "fd-after.json", (raw) => {
    raw["startedAtUnixMilliseconds"] = 999_000;
  });
  expect(() => validateMacMeasuredOutputs(after)).toThrow();
});
test.each([
  "no-debug",
  "wrong-pid",
  "wrong-time",
  "failed-exit",
  "incomplete",
  "missing-interval",
  "wrong-start",
  "reversed-interval",
  "late-end",
  "fractional-end",
])(
  "invalid unified command/evidence cannot authorize input (%s)",
  (variant) => {
    const value = fixture();
    replaceJSON(value, "unified.json", (raw) => {
      const argv = z.array(z.string()).parse(raw["argv"]);
      if (variant === "no-debug") argv.splice(3, 1);
      if (variant === "wrong-pid") argv[11] = "processIdentifier == 124";
      if (variant === "wrong-time") argv[9] = "@999.000000";
      if (variant === "failed-exit") raw["exitCode"] = 1;
      if (variant === "incomplete") raw["complete"] = false;
      if (variant === "missing-interval") delete raw["requestedInterval"];
      if (
        [
          "wrong-start",
          "reversed-interval",
          "late-end",
          "fractional-end",
        ].includes(variant)
      ) {
        const interval = z
          .record(z.string(), z.number())
          .parse(raw["requestedInterval"]);
        if (variant === "wrong-start")
          interval["startUnixMilliseconds"] = 999_001;
        if (variant === "reversed-interval")
          interval["endUnixMilliseconds"] = 998_999;
        if (variant === "late-end") interval["endUnixMilliseconds"] = 1_008_000;
        if (variant === "fractional-end")
          interval["endUnixMilliseconds"] = 1_005_015.5;
        raw["requestedInterval"] = interval;
      }
      raw["argv"] = argv;
    });
    expect(() => validateMacMeasuredOutputs(value)).toThrow();
  },
);
test("unexpected output and missing/wrong verification intent reject", () => {
  const extra = fixture();
  extra.guestFiles["unowned-extra.json"] = text("{}");
  expect(() => validateMacMeasuredOutputs(extra)).toThrow();
  const missing = fixture("verification-probe");
  delete missing.guestFiles["native-intent.json"];
  expect(() => validateMacMeasuredOutputs(missing)).toThrow();
  const wrong = fixture("verification-probe");
  replaceJSON(wrong, "native-intent.json", (raw) => {
    raw["operation"] = "credentials-probe";
  });
  expect(() => validateMacMeasuredOutputs(wrong)).toThrow();
});
