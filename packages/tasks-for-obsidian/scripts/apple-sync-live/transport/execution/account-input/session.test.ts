import { expect, test } from "vitest";
import { driveMacInput, type MacInputIO } from "./session";
import {
  macInputProtocol,
  macVerificationTiming,
  type MacInputOperation,
  type MacInputPrepared,
} from "./protocol";

function fixture(operation: MacInputOperation = "credentials") {
  const selected = macInputProtocol.operations[operation];
  const now = 1_000_000;
  const input: MacInputPrepared["input"] = {
    schemaVersion: 1,
    kind: "mac-private-account-input",
    mode: "private_session",
    operation,
    sessionID: "7c94e51d-5c49-4a3b-ae5e-f94392f8caed",
    runID: "8a98d3ac-739b-433c-aa97-0944cd93fd03",
    remoteID: "synthetic",
    runDirectory: "/private/tmp/synthetic",
    executable: "/private/tmp/synthetic/app",
    container: "/private/tmp/synthetic/container",
    stateDirectory: "/private/tmp/synthetic/state",
    lifecycle: null,
    guestConfigSHA256: "a".repeat(64),
    pid: 123,
    startSeconds: 456,
    startMicroseconds: 789,
    launchDate: 456.000789,
    requestID:
      selected.initialStage === "credentials"
        ? null
        : "d26bba45-f2f7-44cf-bb54-a0bc67ad389a",
    helperSHA256: "b".repeat(64),
    protocolSHA256: "c".repeat(64),
    timingSHA256: "d".repeat(64),
    approvalSHA256: selected.probe ? null : "e".repeat(64),
  };
  const prepared: MacInputPrepared = {
    kind: "mac-input-prepared",
    program: "/private/tmp/synthetic/helper",
    input,
    evidenceDirectory: "/private/tmp/synthetic/evidence",
    probe: selected.probe,
  };
  const ready = {
    schemaVersion: 1,
    kind: "ready",
    sessionID: input.sessionID,
    runID: input.runID,
    operation,
    phase: selected.phase,
    pid: input.pid,
    startSeconds: input.startSeconds,
    startMicroseconds: input.startMicroseconds,
    launchDate: input.launchDate,
    requestID: input.requestID,
    clockUnixMilliseconds: now,
  };
  const finished = {
    schemaVersion: 1,
    kind: "finished",
    sessionID: input.sessionID,
    runID: input.runID,
    operation,
    phase: selected.phase,
    cleared: selected.probe,
    secureField: selected.phase !== "verification",
    submitActionCount:
      selected.accountSubmits + selected.codeSubmits + selected.connects,
    verificationCodeSubmitActionCount: selected.codeSubmits,
    intentRecorded: !selected.probe || selected.accountSubmits === 1,
  };
  const events: string[] = [];
  const replies: unknown[] = [ready, finished];
  const io: MacInputIO = {
    send: async (kind) => {
      events.push(`send:${kind}`);
    },
    read: async () => {
      events.push("read");
      return replies.shift();
    },
    finish: async () => {
      events.push("finish");
    },
    abort: async () => {
      events.push("abort");
    },
  };
  const action = async (): Promise<Record<string, unknown>> => {
    events.push("action");
    if (operation === "verification")
      return {
        code: "123456",
        expiresAtUnixMilliseconds:
          now + macVerificationTiming.minimumValidityMilliseconds,
      };
    if (operation === "vault")
      return { vaultPassword: "synthetic-fixture-password" };
    return {
      email: "synthetic@example.invalid",
      password: "synthetic-fixture-password",
      ...(selected.probe ? { code: "123456" } : {}),
    };
  };
  const options = {
    now: () => now,
    fresh: async () => {
      events.push("fresh");
    },
    action,
    recordIntent: async () => {
      events.push("intent");
    },
  };
  return { now, prepared, ready, finished, events, replies, io, options };
}

test.each([
  { pid: 124 },
  { startSeconds: 457 },
  { startMicroseconds: 790 },
  { launchDate: 456.001 },
  { requestID: "d26bba45-f2f7-44cf-bb54-a0bc67ad389a" },
  { phase: "verification" },
  {
    clockUnixMilliseconds:
      1_000_000 + macVerificationTiming.maximumClockSkewMilliseconds + 1,
  },
  { unexpected: true },
])(
  "READY owner/phase/clock/shape mismatch rejects before credential supplier (%j)",
  async (change) => {
    const value = fixture();
    value.replies[0] = { ...value.ready, ...change };
    await expect(
      driveMacInput(value.prepared, value.io, value.options),
    ).rejects.toThrow();
    expect(value.events).toEqual(["send:init", "read"]);
  },
);

test("fresh full gate precedes credential supplier; durable intent precedes action send", async () => {
  const value = fixture();
  expect(await driveMacInput(value.prepared, value.io, value.options)).toEqual(
    value.finished,
  );
  expect(value.events).toEqual([
    "send:init",
    "read",
    "fresh",
    "action",
    "intent",
    "send:credentials",
    "read",
    "finish",
  ]);
});

test("failed fresh gate prevents credential reads and intents", async () => {
  const value = fixture();
  value.options.fresh = async () => {
    value.events.push("fresh-failed");
    throw new Error("synthetic gate rejection");
  };
  await expect(
    driveMacInput(value.prepared, value.io, value.options),
  ).rejects.toThrow("gate rejection");
  expect(value.events).toEqual(["send:init", "read", "fresh-failed"]);
});

test("failed private supplier prevents intent and input; failed intent prevents private send", async () => {
  const supplier = fixture();
  supplier.options.action = async () => {
    supplier.events.push("action-failed");
    throw new Error("synthetic unavailable");
  };
  await expect(
    driveMacInput(supplier.prepared, supplier.io, supplier.options),
  ).rejects.toThrow("unavailable");
  expect(supplier.events).toEqual([
    "send:init",
    "read",
    "fresh",
    "action-failed",
  ]);
  const intent = fixture();
  intent.options.recordIntent = async () => {
    intent.events.push("intent-failed");
    throw new Error("synthetic duplicate");
  };
  await expect(
    driveMacInput(intent.prepared, intent.io, intent.options),
  ).rejects.toThrow("duplicate");
  expect(intent.events).toEqual([
    "send:init",
    "read",
    "fresh",
    "action",
    "intent-failed",
  ]);
});

test.each([
  0,
  -1,
  macVerificationTiming.maximumValidityMilliseconds +
    macVerificationTiming.maximumClockSkewMilliseconds +
    1,
])(
  "expired or out-of-bound verification rejects before intent/private send (%i)",
  async (offset) => {
    const value = fixture("verification");
    value.options.action = async () => {
      value.events.push("action");
      return { code: "123456", expiresAtUnixMilliseconds: value.now + offset };
    };
    await expect(
      driveMacInput(value.prepared, value.io, value.options),
    ).rejects.toThrow();
    expect(value.events).toEqual(["send:init", "read", "fresh", "action"]);
  },
);

test("code expiring during durable intent cannot be sent; retained intent prevents retry", async () => {
  const value = fixture("verification");
  let clock = value.now;
  value.options.now = () => clock;
  value.options.recordIntent = async () => {
    value.events.push("intent");
    clock += macVerificationTiming.minimumValidityMilliseconds;
  };
  await expect(
    driveMacInput(value.prepared, value.io, value.options),
  ).rejects.toThrow("expired");
  expect(value.events).toEqual([
    "send:init",
    "read",
    "fresh",
    "action",
    "intent",
  ]);
});

test.each(["credentials-probe", "verification-probe"] as const)(
  "%s verifies exact native fake counts without a real Host intent",
  async (operation) => {
    const value = fixture(operation);
    expect(
      await driveMacInput(value.prepared, value.io, value.options),
    ).toEqual(value.finished);
    expect(value.events).toEqual([
      "send:init",
      "read",
      "fresh",
      "action",
      "send:probe",
      "read",
      "finish",
    ]);
  },
);

test("fake receipt mismatch and failed EOF validation cannot yield approved completion", async () => {
  const wrong = fixture("verification-probe");
  wrong.replies[1] = {
    ...wrong.finished,
    verificationCodeSubmitActionCount: 1,
  };
  await expect(
    driveMacInput(wrong.prepared, wrong.io, wrong.options),
  ).rejects.toThrow();
  expect(wrong.events).not.toContain("finish");
  const eof = fixture("credentials-probe");
  eof.io.finish = async () => {
    eof.events.push("finish-failed");
    throw new Error("synthetic trailing bytes");
  };
  await expect(
    driveMacInput(eof.prepared, eof.io, eof.options),
  ).rejects.toThrow("trailing bytes");
});
