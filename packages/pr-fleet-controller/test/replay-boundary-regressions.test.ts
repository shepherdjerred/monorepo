import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadRunBundle,
  replayRunBundle,
} from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";
import { RunRecorder } from "@shepherdjerred/pr-fleet-controller/src/run-recorder.ts";
import {
  PrStateSchema,
  type FleetSnapshot,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { evidence, identity } from "./fixtures.ts";

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

test("resolved controller provenance is bound into the event chain", async () => {
  const recorder = await createRecorder();
  recorder.record("run.started", { marker: "source-bound" });
  await recorder.finalize("failed", null, new Error("synthetic stop"));
  const bundle = await loadRunBundle(recorder.paths.runDirectory);
  await writeFile(
    recorder.paths.manifest,
    `${JSON.stringify({ ...bundle.manifest, controllerCommit: "c".repeat(40) }, null, 2)}\n`,
    "utf8",
  );
  const tamperedBundle = await loadRunBundle(recorder.paths.runDirectory);

  expect(() => replayRunBundle(tamperedBundle, replayOptions)).toThrow(
    "Resolved manifest digest does not match the event chain",
  );
});

test("event and summary snapshots use one redaction policy", async () => {
  const recorder = await createRecorder();
  const pr = identity(42, {
    headRefName: "feature/token=cleanup",
    labels: ["token=cleanup"],
  });
  const state = PrStateSchema.parse({
    identity: pr,
    logicalOwner: "fleet-controller",
    runtimeAgent: null,
    agentGeneration: 0,
    model: "openai/gpt-5.6-terra",
    status: "paused",
    classification: "paused",
    stackId: "pr-42",
    worktree: null,
    setupComplete: false,
    evidence: evidence(pr),
    lastAgentReportAt: null,
    lastProgressAt: "2026-08-03T00:00:00.000Z",
    noProgressTicks: 0,
    prodSentAt: null,
    escalation: null,
    priority: 0,
  });
  const sensitiveSnapshot: FleetSnapshot = {
    open: 1,
    green: 0,
    active: 0,
    queued: 0,
    pending: 0,
    paused: 1,
    prs: [state],
  };
  const tickId = recorder.newId("tick");
  recorder.record("run.started", { scenario: "snapshot-redaction" });
  recorder.record("tick.started", { trigger: "startup" }, { tickId });
  recorder.record(
    "fleet.snapshot",
    { snapshot: sensitiveSnapshot },
    { tickId },
  );
  recorder.record(
    "tick.completed",
    {
      report: {
        trigger: "startup",
        snapshot: sensitiveSnapshot,
        changes: [],
        nextHeartbeatSeconds: 600,
      },
    },
    { tickId },
  );
  recorder.record("shutdown.started", { activeWorkers: 0 });
  recorder.record("shutdown.completed", { snapshot: sensitiveSnapshot });
  await recorder.finalize("completed", sensitiveSnapshot);

  const report = replayRunBundle(
    await loadRunBundle(recorder.paths.runDirectory),
    replayOptions,
  );
  expect(report.finalSnapshot?.prs[0]?.identity.headRefName).toBe(
    "feature/token=[REDACTED]",
  );
  expect(report.finalSnapshot?.prs[0]?.identity.labels).toEqual([
    "token=[REDACTED]",
  ]);
});

describe("tick command ancestry replay", () => {
  test("rejects an environment result with a fabricated tick", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { scenario: "orphaned-environment-result" });
    recorder.record(
      "environment.result",
      { operation: "listOpenPrs", prs: [] },
      { tickId: "fabricated-tick" },
    );
    await recorder.finalize("failed", null, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      "environment.result references a nonexistent or inactive tick: fabricated-tick",
    );
  });

  test("rejects an environment result after its tick fails", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    recorder.record("run.started", { scenario: "late-environment-result" });
    recorder.record("tick.started", { trigger: "heartbeat" }, { tickId });
    recorder.record("tick.failed", { error: "refresh failed" }, { tickId });
    recorder.record(
      "environment.result",
      { operation: "listOpenPrs", prs: [] },
      { tickId },
    );
    await recorder.finalize("failed", null, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      `environment.result references a nonexistent or inactive tick: ${tickId}`,
    );
  });

  test("rejects a standalone command with a fabricated tick", async () => {
    const recorder = await createRecorder();
    const commandId = recorder.newId("command");
    recorder.record("run.started", { scenario: "orphaned-tick-command" });
    recorder.record(
      "command.started",
      { executable: "gh", args: ["pr", "list"] },
      { tickId: "fabricated-tick", commandId },
    );
    recorder.record(
      "command.completed",
      { executable: "gh", exitCode: 0 },
      { tickId: "fabricated-tick", commandId },
    );
    await recorder.finalize("failed", null, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      "command.started references a nonexistent or inactive tick: fabricated-tick",
    );
  });

  test("rejects a standalone command after its tick fails", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    const commandId = recorder.newId("command");
    recorder.record("run.started", { scenario: "late-tick-command" });
    recorder.record("tick.started", { trigger: "heartbeat" }, { tickId });
    recorder.record("tick.failed", { error: "refresh failed" }, { tickId });
    recorder.record(
      "command.started",
      { executable: "gh", args: ["pr", "list"] },
      { tickId, commandId },
    );
    recorder.record(
      "command.completed",
      { executable: "gh", exitCode: 0 },
      { tickId, commandId },
    );
    await recorder.finalize("failed", null, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      `command.started references a nonexistent or inactive tick: ${tickId}`,
    );
  });

  test("rejects a master tool command after its tick completes", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    const modelTurnId = recorder.newId("master-turn");
    const toolCallId = recorder.newId("tool");
    const commandId = recorder.newId("command");
    recorder.record("run.started", { scenario: "late-master-tick-command" });
    recorder.record(
      "master.turn.started",
      { prompt: "tick", messages: [] },
      { modelTurnId },
    );
    recorder.record(
      "tool.started",
      { tool: "run_fleet_tick", input: {} },
      { modelTurnId, toolCallId },
    );
    recorder.record("tick.started", { trigger: "user" }, { tickId });
    recorder.record("fleet.snapshot", { snapshot }, { tickId });
    recorder.record(
      "tick.completed",
      {
        report: {
          trigger: "user",
          snapshot,
          changes: [],
          nextHeartbeatSeconds: 600,
        },
      },
      { tickId },
    );
    recorder.record(
      "command.started",
      { executable: "gh", args: ["pr", "list"] },
      { tickId, modelTurnId, toolCallId, commandId },
    );
    await recorder.finalize("failed", snapshot, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      `command.started references a nonexistent or inactive tick: ${tickId}`,
    );
  });
});

describe("master text ancestry replay", () => {
  test("rejects master text after its turn completes", async () => {
    const recorder = await createRecorder();
    const modelTurnId = recorder.newId("master-turn");
    recorder.record("run.started", { scenario: "late-master-text" });
    recorder.record(
      "master.turn.started",
      { prompt: "status", messages: [] },
      { modelTurnId },
    );
    recorder.record(
      "master.turn.completed",
      { response: "done" },
      { modelTurnId },
    );
    recorder.record("master.text", { text: "late" }, { modelTurnId });
    await recorder.finalize("failed", null, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      `master.text references a nonexistent or inactive model turn: ${modelTurnId}`,
    );
  });

  test("rejects master text with a fabricated turn", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { scenario: "orphaned-master-text" });
    recorder.record(
      "master.text",
      { text: "orphaned" },
      { modelTurnId: "fabricated-turn" },
    );
    await recorder.finalize("failed", null, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      "master.text references a nonexistent or inactive model turn: fabricated-turn",
    );
  });
});

describe("fleet change ancestry replay", () => {
  test("rejects a fleet change with a fabricated tick", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { scenario: "orphaned-fleet-change" });
    recorder.record(
      "fleet.change",
      { change: "queued PR #42" },
      { tickId: "fabricated-tick" },
    );
    await recorder.finalize("failed", null, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      "fleet.change references a nonexistent or inactive tick: fabricated-tick",
    );
  });

  test("rejects a fleet change after its tick completes", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    recorder.record("run.started", { scenario: "late-fleet-change" });
    recorder.record("tick.started", { trigger: "heartbeat" }, { tickId });
    recorder.record("fleet.snapshot", { snapshot }, { tickId });
    recorder.record(
      "tick.completed",
      {
        report: {
          trigger: "heartbeat",
          snapshot,
          changes: [],
          nextHeartbeatSeconds: 600,
        },
      },
      { tickId },
    );
    recorder.record("fleet.change", { change: "late change" }, { tickId });
    await recorder.finalize("failed", snapshot, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      `fleet.change references a nonexistent or inactive tick: ${tickId}`,
    );
  });
});

describe("queued tick ancestry replay", () => {
  test("rejects a queued tick with a fabricated cause", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { scenario: "orphaned-queued-tick" });
    recorder.record(
      "tick.queued",
      { trigger: "user", snapshot },
      { causationId: "fabricated-tick" },
    );
    await recorder.finalize("failed", null, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      "tick.queued references a nonexistent or inactive tick: fabricated-tick",
    );
  });

  test("rejects a queued tick after its cause completes", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    recorder.record("run.started", { scenario: "late-queued-tick" });
    recorder.record("tick.started", { trigger: "startup" }, { tickId });
    recorder.record("fleet.snapshot", { snapshot }, { tickId });
    recorder.record(
      "tick.completed",
      {
        report: {
          trigger: "startup",
          snapshot,
          changes: [],
          nextHeartbeatSeconds: 600,
        },
      },
      { tickId },
    );
    recorder.record(
      "tick.queued",
      { trigger: "user", snapshot },
      { causationId: tickId },
    );
    await recorder.finalize("failed", snapshot, new Error("capture rejected"));
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() => replayRunBundle(bundle, replayOptions)).toThrow(
      `tick.queued references a nonexistent or inactive tick: ${tickId}`,
    );
  });
});

test("failed shutdown events preserve the final replay snapshot", async () => {
  const recorder = await createRecorder();
  recorder.record("run.started", { scenario: "failed-shutdown-snapshot" });
  recorder.record("shutdown.started", { activeWorkers: 0 });
  recorder.record("shutdown.failed", {
    snapshot,
    error: "shutdown start persistence failed",
  });
  await recorder.finalize(
    "failed",
    snapshot,
    new Error("shutdown start persistence failed"),
  );

  const report = replayRunBundle(
    await loadRunBundle(recorder.paths.runDirectory),
    replayOptions,
  );
  expect(report.finalSnapshot).toEqual(snapshot);
  expect(report.shutdown.failed).toBe(1);
  expect(report.shutdown.open).toEqual([]);
});

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
    "command.started was recorded after shutdown terminal",
  );
});
