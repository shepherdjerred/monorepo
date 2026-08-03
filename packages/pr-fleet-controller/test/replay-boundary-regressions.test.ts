import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadRunBundle,
  replayRunBundle,
} from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";
import { RunRecorder } from "@shepherdjerred/pr-fleet-controller/src/run-recorder.ts";
import type { FleetSnapshot } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

const snapshot: FleetSnapshot = {
  open: 0,
  green: 0,
  active: 0,
  queued: 0,
  pending: 0,
  paused: 0,
  prs: [],
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRecorder(): Promise<RunRecorder> {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-replay-"));
  temporaryDirectories.push(stateDirectory);
  return RunRecorder.create({
    stateDirectory,
    controllerVersion: "0.1.0",
    controllerCommit: "a".repeat(40),
    controllerSourceDirty: false,
    controllerSourceFingerprint: "b".repeat(64),
    model: "openai/gpt-5.6-terra",
    repository: "example/repository",
    checkout: "/tmp/checkout",
    worktreeRoot: "/tmp/worktrees",
    maxWorkers: 2,
  });
}

const replayOptions = {
  currentControllerVersion: "0.1.0",
  allowVersionMismatch: false,
};

describe("snapshot ancestry replay", () => {
  test("rejects a snapshot whose tick was never started", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { scenario: "orphaned-snapshot" });
    recorder.record(
      "fleet.snapshot",
      { snapshot },
      { tickId: "fabricated-tick" },
    );
    await recorder.finalize("failed", snapshot);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      "fleet.snapshot references a nonexistent or inactive tick: fabricated-tick",
    );
  });

  test("rejects a snapshot emitted after its tick failed", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    recorder.record("run.started", { scenario: "late-snapshot" });
    recorder.record("tick.started", { trigger: "startup" }, { tickId });
    recorder.record("tick.failed", { error: "refresh failed" }, { tickId });
    recorder.record("fleet.snapshot", { snapshot }, { tickId });
    await recorder.finalize("failed", snapshot);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      `fleet.snapshot references a nonexistent or inactive tick: ${tickId}`,
    );
  });
});

test("failed runs still enforce the completed-shutdown boundary", async () => {
  const recorder = await createRecorder();
  const commandId = recorder.newId("command");
  recorder.record("run.started", { scenario: "late-command-failed-run" });
  recorder.record("shutdown.started", { activeWorkers: 0 });
  recorder.record("shutdown.completed", { snapshot });
  recorder.record(
    "command.started",
    { executable: "git", args: ["status"] },
    { commandId },
  );
  recorder.record(
    "command.completed",
    { executable: "git", exitCode: 0 },
    { commandId },
  );
  await recorder.finalize(
    "failed",
    snapshot,
    new Error("runtime shutdown failed"),
  );
  const bundle = await loadRunBundle(recorder.paths.runDirectory);

  expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
    "command.started was recorded after shutdown.completed",
  );
});
