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
const snapshot = {
  open: 0,
  green: 0,
  active: 0,
  queued: 0,
  pending: 0,
  paused: 0,
  prs: [],
};

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

test("replay binds every mutable terminal summary field", async () => {
  stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-run-"));
  const recorder = await RunRecorder.create({
    stateDirectory,
    controllerVersion: "0.1.0",
    controllerCommit: "a".repeat(40),
    controllerSourceDirty: false,
    controllerSourceFingerprint: "b".repeat(64),
    model: "openai/gpt-5.6-terra",
    repository: "example/repository",
    checkout: "/repo",
    worktreeRoot: "/repo/worktrees",
    maxWorkers: 2,
  });
  recorder.record("run.started", { phase: "startup" });
  await recorder.finalize("failed", null, new Error("provider failed"));
  const bundle = await loadRunBundle(recorder.paths.runDirectory);
  const laterFinishedAt = new Date(
    Date.parse(bundle.summary.finishedAt) + 1000,
  ).toISOString();
  const tamperedSummaries = [
    { ...bundle.summary, finishedAt: laterFinishedAt },
    { ...bundle.summary, durationMs: bundle.summary.durationMs + 1 },
    { ...bundle.summary, error: { message: "different failure" } },
  ];

  for (const summary of tamperedSummaries) {
    expect(() =>
      replayRunBundle(
        { ...bundle, summary },
        { currentControllerVersion: "0.1.0", allowVersionMismatch: false },
      ),
    ).toThrow("Summary terminal metadata does not match the final run event");
  }
});

test("bundle loading verifies database sidecars against terminal digests", async () => {
  stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-run-"));
  const recorder = await RunRecorder.create({
    stateDirectory,
    controllerVersion: "0.1.0",
    controllerCommit: "a".repeat(40),
    controllerSourceDirty: false,
    controllerSourceFingerprint: "b".repeat(64),
    model: "openai/gpt-5.6-terra",
    repository: "example/repository",
    checkout: "/repo",
    worktreeRoot: "/repo/worktrees",
    maxWorkers: 2,
  });
  recorder.record("run.started", { phase: "startup" });
  await Bun.write(recorder.paths.mastra, "mastra-sidecar");
  await Bun.write(recorder.paths.observability, "observability-sidecar");
  recorder.requireSidecars();
  await recorder.finalize("completed", snapshot);

  await expect(
    loadRunBundle(recorder.paths.runDirectory),
  ).resolves.toBeDefined();
  await rm(recorder.paths.mastra);
  await expect(loadRunBundle(recorder.paths.runDirectory)).rejects.toThrow(
    "Run artifact mastra.db is missing",
  );
  await Bun.write(recorder.paths.mastra, "mastra-sidecar");
  await expect(
    loadRunBundle(recorder.paths.runDirectory),
  ).resolves.toBeDefined();
  await Bun.write(recorder.paths.observability, "replacement");
  await expect(loadRunBundle(recorder.paths.runDirectory)).rejects.toThrow(
    "Run artifact observability.duckdb does not match its recorded digest",
  );
});

test("replay reconciles emitted fleet changes with the tick report", async () => {
  stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-run-"));
  const recorder = await RunRecorder.create({
    stateDirectory,
    controllerVersion: "0.1.0",
    controllerCommit: "a".repeat(40),
    controllerSourceDirty: false,
    controllerSourceFingerprint: "b".repeat(64),
    model: "openai/gpt-5.6-terra",
    repository: "example/repository",
    checkout: "/repo",
    worktreeRoot: "/repo/worktrees",
    maxWorkers: 2,
  });
  const tickId = recorder.newId("tick");
  recorder.record("run.started", { phase: "startup" });
  recorder.record("tick.started", { trigger: "startup" }, { tickId });
  recorder.record("fleet.snapshot", { snapshot }, { tickId });
  recorder.record("fleet.change", { change: "recorded" }, { tickId });
  recorder.record(
    "tick.completed",
    {
      report: {
        trigger: "startup",
        snapshot,
        changes: ["different"],
        nextHeartbeatSeconds: 600,
      },
    },
    { tickId },
  );
  recorder.record("shutdown.started", { activeWorkers: 0 });
  recorder.record("shutdown.completed", { snapshot });
  await recorder.finalize("completed", snapshot);
  const bundle = await loadRunBundle(recorder.paths.runDirectory);

  expect(() =>
    replayRunBundle(bundle, {
      currentControllerVersion: "0.1.0",
      allowVersionMismatch: false,
    }),
  ).toThrow(`Tick ${tickId} completed with changes not emitted by that tick`);
});
