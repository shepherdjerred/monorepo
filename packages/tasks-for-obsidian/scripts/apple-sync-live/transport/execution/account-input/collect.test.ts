import { expect, test } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { captureMacProcess, collectGuestMacInput } from "./collect";
import { MacInputCollectedSchema, MacInputPreparedSchema } from "./protocol";

const bytes = new TextEncoder().encode("public-synthetic-output");
function stream(open: boolean, stalledCancel = false) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      if (!open) controller.close();
    },
    cancel() {
      if (stalledCancel)
        return new Promise<void>(() => {
          /* Intentionally unresponsive producer. */
        });
      return Promise.resolve();
    },
  });
}
test.each(["stdout", "stderr"])(
  "collector bounds inherited %s after leader exit without signaling reused owners",
  async (opened) => {
    let signals = 0;
    const child = {
      stdout: stream(opened === "stdout"),
      stderr: stream(opened === "stderr"),
      exitCode: 0,
      exited: Promise.resolve(0),
    };
    const captured = await captureMacProcess(
      child,
      performance.now() + 50,
      () => {
        signals += 1;
      },
    );
    expect(captured.complete).toBe(false);
    expect(captured.timedOut).toBe(true);
    expect(Buffer.from(captured.stdout)).toEqual(Buffer.from(bytes));
    expect(Buffer.from(captured.stderr)).toEqual(Buffer.from(bytes));
    expect(signals).toBe(0);
  },
);
test("unresponsive stream cancellation cannot extend the original collection deadline", async () => {
  const child = {
    stdout: stream(true, true),
    stderr: stream(false),
    exitCode: 0,
    exited: Promise.resolve(0),
  };
  const captured = await captureMacProcess(
    child,
    performance.now() + 50,
    () => {
      throw new Error("Exited leader cannot be signaled");
    },
  );
  expect(captured.complete).toBe(false);
  expect(captured.timedOut).toBe(true);
  expect(Buffer.from(captured.stdout)).toEqual(Buffer.from(bytes));
});
test("only both real EOFs and settled exit produce complete captured output", async () => {
  const child = {
    stdout: stream(false),
    stderr: stream(false),
    exitCode: 0,
    exited: Promise.resolve(0),
  };
  const captured = await captureMacProcess(
    child,
    performance.now() + 1000,
    () => {
      throw new Error("No live leader");
    },
  );
  expect(captured.complete).toBe(true);
  expect(captured.timedOut).toBe(false);
  expect(captured.exitCode).toBe(0);
});

test.each([true, false])(
  "retirement failure=%s retains honest collection evidence without private errors",
  async (retirementFails) => {
    const root = await realpath(
      await mkdtemp("/tmp/facet-collection-control-"),
    );
    try {
      const sessionID = crypto.randomUUID();
      const evidenceDirectory = path.join(root, "evidence");
      const directory = path.join(
        evidenceDirectory,
        "account-input/sessions",
        sessionID,
      );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const prepared = MacInputPreparedSchema.parse({
        kind: "mac-input-prepared",
        program: path.join(root, "native-helper"),
        evidenceDirectory: directory,
        probe: true,
        input: {
          schemaVersion: 1,
          kind: "mac-private-account-input",
          mode: "private_session",
          operation: "credentials-probe",
          sessionID,
          runID: crypto.randomUUID(),
          remoteID: "synthetic",
          runDirectory: root,
          executable: path.join(root, "synthetic-app"),
          container: path.join(root, "container"),
          stateDirectory: path.join(root, "state"),
          lifecycle: null,
          guestConfigSHA256: "a".repeat(64),
          pid: 123,
          startSeconds: 999,
          startMicroseconds: 0,
          launchDate: Date.now() / 1000 - 1,
          requestID: null,
          helperSHA256: "b".repeat(64),
          protocolSHA256: "c".repeat(64),
          timingSHA256: "d".repeat(64),
          approvalSHA256: null,
        },
      });
      const retainFixture = (file: string, value: string) =>
        writeFile(path.join(directory, file), value, {
          flag: "wx",
          mode: 0o600,
        });
      await retainFixture("prepared.json", JSON.stringify(prepared));
      for (const file of [
        "app.stdout",
        "app.stderr",
        "fd-before.stdout",
        "fd-before.stderr",
        "fd-before.json",
      ])
        await retainFixture(file, "");
      let retireCalls = 0,
        captureCalls = 0;
      const privateError = "must-not-retain-retirement-exception-payload";
      const runtime = {
        paths: {
          evidenceDirectory,
          stateDirectory: prepared.input.stateDirectory,
        },
        config: { runID: prepared.input.runID },
        retire: () => {
          retireCalls += 1;
          if (retirementFails) return Promise.reject(new Error(privateError));
          return Promise.resolve({
            signalSubmitted: true,
            observedExit: true as const,
          });
        },
      };
      const result = MacInputCollectedSchema.parse(
        await collectGuestMacInput(runtime, sessionID, {
          inspectOwners: () => Promise.resolve([String(prepared.input.pid)]),
          captureDescriptors: async () => {
            for (const file of [
              "fd-after.stdout",
              "fd-after.stderr",
              "fd-after.json",
            ])
              await retainFixture(file, "");
          },
          captureLog: () => {
            captureCalls += 1;
            return Promise.resolve({
              stdout: new Uint8Array(),
              stderr: new Uint8Array(),
              exitCode: 0,
              truncated: false,
              timedOut: false,
              complete: true,
              startedAtUnixMilliseconds: Date.now(),
              finishedAtUnixMilliseconds: Date.now(),
            });
          },
        }),
      );
      expect(retireCalls).toBe(1);
      expect(captureCalls).toBe(retirementFails ? 0 : 1);
      expect(result.passed).toBe(!retirementFails);
      expect(result.failure).toBe(retirementFails ? "capture" : "none");
      const captureText = await readFile(
        path.join(directory, "capture.json"),
        "utf8",
      );
      expect(captureText).not.toContain(privateError);
      const captureRecord: unknown = JSON.parse(captureText);
      expect(captureRecord).toMatchObject(result);
      if (retirementFails)
        expect(captureRecord).toHaveProperty("failureStage", "retirement");
      else expect(captureRecord).not.toHaveProperty("failureStage");
      const names = await readdir(directory);
      expect(names.includes("unified.json")).toBe(!retirementFails);
      expect(result.files.sort()).toEqual(
        names
          .map((name) => "account-input/sessions/" + sessionID + "/" + name)
          .sort(),
      );
      // The exclusive capture remains immutable even if another collector is attempted.
      await expect(
        collectGuestMacInput(runtime, sessionID, {
          inspectOwners: () => Promise.resolve([]),
          captureDescriptors: () => Promise.reject(new Error("No owner")),
          captureLog: () => Promise.reject(new Error("No owner")),
        }),
      ).rejects.toThrow();
      expect(await readFile(path.join(directory, "capture.json"), "utf8")).toBe(
        captureText,
      );
    } finally {
      await rm(root, { recursive: true });
    }
  },
);
