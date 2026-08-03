import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadRunBundle,
  replayRunBundle,
} from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";
import { RunRecorder } from "@shepherdjerred/pr-fleet-controller/src/run-recorder.ts";
import { writeFileSinkSynchronously } from "@shepherdjerred/pr-fleet-controller/src/synchronous-file-sink.ts";

let stateDirectory: string | undefined;

afterEach(async () => {
  if (stateDirectory !== undefined) {
    await rm(stateDirectory, { recursive: true, force: true });
    stateDirectory = undefined;
  }
});

test("initialization capture failure restores replayable bootstrap provenance", async () => {
  stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-run-"));
  let failInitialization = true;
  const recorder = await RunRecorder.create({
    stateDirectory,
    controllerVersion: "unresolved",
    controllerCommit: "0".repeat(40),
    controllerSourceDirty: true,
    controllerSourceFingerprint: "0".repeat(64),
    controllerSourceResolved: false,
    model: "openai/gpt-5.6-terra",
    repository: "example/repository",
    checkout: "/bootstrap",
    worktreeRoot: "/bootstrap/worktrees",
    maxWorkers: 1,
    writeEvent: (fileDescriptor, line) => {
      writeFileSinkSynchronously(fileDescriptor, line);
      if (
        failInitialization &&
        line.includes('"kind":"controller.initialized"')
      ) {
        failInitialization = false;
        throw new Error("controller initialization capture failed");
      }
    },
  });
  recorder.record("run.started", { phase: "preflight" });

  await expect(
    recorder.initializeController({
      controllerVersion: "0.1.0",
      controllerCommit: "a".repeat(40),
      controllerSourceDirty: false,
      controllerSourceFingerprint: "b".repeat(64),
      model: "openai/gpt-5.6-terra",
      repository: "example/repository",
      checkout: "/repo",
      worktreeRoot: "/repo/worktrees",
      maxWorkers: 2,
    }),
  ).rejects.toThrow("controller initialization capture failed");
  await recorder.finalize(
    "failed",
    null,
    new Error("controller initialization capture failed"),
  );

  const bundle = await loadRunBundle(recorder.paths.runDirectory);
  expect(bundle.manifest.controllerSourceResolved).toBe(false);
  expect(
    bundle.events.some((event) => event.kind === "controller.initialized"),
  ).toBe(false);
  expect(() =>
    replayRunBundle(bundle, {
      currentControllerVersion: "unresolved",
      allowVersionMismatch: false,
    }),
  ).not.toThrow();
});
