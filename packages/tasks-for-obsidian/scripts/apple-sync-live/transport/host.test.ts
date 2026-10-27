import { expect, test, vi } from "vitest";
import { GuestExecutionSchema } from "./contract.ts";
import {
  executePrivateTransport,
  guestCall,
  type TransportCommand,
} from "./host.ts";

import { manifest } from "./fixtures.test-support.ts";
const encoder = new TextEncoder();
const verifyFixture = () => Promise.resolve();
const failedChild: TransportCommand = () =>
  Promise.resolve({
    exitCode: 1,
    stdout: encoder.encode("private-stderr-value"),
    stderr: encoder.encode("private-stderr-value"),
  });

test("private stdin carries credentials while argv and closed receipts contain none", async () => {
  const secret = "synthetic-private-input-sentinel",
    email = "synthetic@example.invalid";
  let verified = 0;
  const execute: TransportCommand = async (argv, bytes) => {
    expect(argv.slice(0, 4)).toEqual([
      "tart",
      "exec",
      "-i",
      "facet-macos-acceptance",
    ]);
    expect(argv.join(" ")).not.toContain(secret);
    const request = JSON.parse(new TextDecoder().decode(bytes));
    expect(request.operation.action.password).toBe(secret);
    return {
      exitCode: 0,
      stderr: new Uint8Array(),
      stdout: encoder.encode(
        JSON.stringify({
          schemaVersion: 1,
          binding: request.binding,
          requestID: request.requestID,
          capturedAt: new Date().toISOString(),
          result: { kind: "account", receipt: { credentialsEntered: true } },
        }),
      ),
    };
  };
  const reply = await guestCall(
    manifest,
    {
      kind: "account",
      action: {
        mode: "fill_credentials",
        email,
        password: secret,
        lifetime: { startSeconds: 1, startMicroseconds: 1, launchDate: 1 },
      },
    },
    execute,
    async () => {
      verified++;
    },
  );
  expect(reply).toEqual({
    kind: "account",
    receipt: { credentialsEntered: true },
  });
  expect(verified).toBe(2);
});

test("wrong run, request, operation, freshness and leaked receipt fields fail closed", async () => {
  for (const change of ["run", "request", "kind", "stale", "secret"] as const) {
    const execute: TransportCommand = async (_, bytes) => {
      const request = JSON.parse(new TextDecoder().decode(bytes));
      const reply = {
        schemaVersion: 1,
        binding: request.binding,
        requestID: request.requestID,
        capturedAt: new Date().toISOString(),
        result: { kind: "snapshot", target: "official", files: {} },
      };
      if (change === "run") reply.binding.runID = crypto.randomUUID();
      if (change === "request") reply.requestID = crypto.randomUUID();
      if (change === "kind") reply.result.kind = "retire";
      if (change === "stale")
        reply.capturedAt = new Date(Date.now() - 10_000).toISOString();
      const raw =
        change === "secret" ? { ...reply, password: "must-not-echo" } : reply;
      return {
        exitCode: 0,
        stderr: new Uint8Array(),
        stdout: encoder.encode(JSON.stringify(raw)),
      };
    };
    await expect(
      guestCall(
        manifest,
        { kind: "snapshot", target: "official" },
        execute,
        verifyFixture,
      ),
    ).rejects.toThrow();
  }
});

test("unknown export paths or leaked child diagnostics cannot establish success", async () => {
  expect(() =>
    GuestExecutionSchema.parse({
      ...manifest.execution,
      guestBundlePath: "/Applications/personal.js",
    }),
  ).toThrow();
  await expect(
    guestCall(manifest, { kind: "status" }, failedChild, verifyFixture),
  ).rejects.not.toThrow("private-stderr-value");
  await expect(
    guestCall(
      { ...manifest, runID: crypto.randomUUID() },
      { kind: "status" },
      failedChild,
      verifyFixture,
    ),
  ).rejects.toThrow();
});

test("owned transport stop signals a timed-out child once and never signals a retired child", async () => {
  const submit = process.kill.bind(process),
    signals: number[] = [];
  const signal = vi.spyOn(process, "kill").mockImplementation((pid, value) => {
    signals.push(pid);
    return submit(pid, value);
  });
  try {
    const retired = await executePrivateTransport(
      [process.execPath, "-e", 'process.stdout.write("owned")'],
      new Uint8Array(),
      1000,
    );
    expect(retired.exitCode).toBe(0);
    expect(signals).toHaveLength(0);
    await expect(
      executePrivateTransport(
        [process.execPath, "-e", "setInterval(()=>{},1000)"],
        new Uint8Array(),
        30,
      ),
    ).rejects.toThrow("outcome is unknown");
    expect(signals).toHaveLength(1);
  } finally {
    signal.mockRestore();
  }
});
