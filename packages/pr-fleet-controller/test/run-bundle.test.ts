import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFleetMastraRuntime } from "@shepherdjerred/pr-fleet-controller/src/mastra-runtime.ts";
import {
  inspectEvents,
  inspectRunSummary,
  loadRunBundle,
  replayRunBundle,
} from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";
import { PrStateSchema } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import {
  readAndVerifyEvents,
  RunRecorder,
} from "@shepherdjerred/pr-fleet-controller/src/run-recorder.ts";
import type { FleetSnapshot } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
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

async function createRecorder(secretValues: readonly string[] = []) {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-run-"));
  temporaryDirectories.push(stateDirectory);
  return RunRecorder.create({
    stateDirectory,
    controllerVersion: "0.1.0",
    controllerCommit: "a".repeat(40),
    model: "openai/gpt-5.6-terra",
    repository: "example/repository",
    checkout: "/tmp/checkout",
    worktreeRoot: "/tmp/worktrees",
    maxWorkers: 2,
    secretValues,
  });
}

async function mode(file: string): Promise<number> {
  const stats = await stat(file);
  return stats.mode & 0o777;
}

async function recordSuccessfulEmptyRun(recorder: RunRecorder): Promise<void> {
  const tickId = recorder.newId("tick");
  recorder.record("run.started", { model: "openai/gpt-5.6-terra" });
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
  recorder.record("shutdown.started", { activeWorkers: 0 });
  recorder.record("shutdown.completed", { snapshot });
  await recorder.finalize("completed", snapshot);
}

async function recordSyntheticWorkerRun(recorder: RunRecorder): Promise<void> {
  const correlation = {
    prNumber: 42,
    headSha: "b".repeat(40),
    generation: 3,
  };
  const modelTurnId = recorder.newId("worker-turn");
  const toolCallId = recorder.newId("tool");
  const commandId = recorder.newId("command");
  const modelCorrelation = { ...correlation, modelTurnId };
  const toolCorrelation = { ...modelCorrelation, toolCallId };
  const commandCorrelation = { ...toolCorrelation, commandId };
  recorder.record("run.started", { scenario: "correlation" });
  recorder.record("worker.started", { runtimeAgent: "pr-42-g3" }, correlation);
  recorder.record(
    "worker.attempt.started",
    { attempt: 1, prompt: "fix" },
    modelCorrelation,
  );
  recorder.record(
    "tool.started",
    { tool: "run_local_command", input: { executable: "git" } },
    toolCorrelation,
  );
  recorder.record(
    "command.started",
    { executable: "git", args: ["status"] },
    commandCorrelation,
  );
  recorder.record(
    "command.completed",
    { executable: "git", exitCode: 0 },
    commandCorrelation,
  );
  recorder.record(
    "tool.completed",
    { tool: "run_local_command", result: { exitCode: 0 } },
    toolCorrelation,
  );
  recorder.record(
    "worker.attempt.completed",
    { attempt: 1, result: { state: "waiting-ci" } },
    modelCorrelation,
  );
  recorder.record(
    "worker.completed",
    { result: { state: "waiting-ci" } },
    correlation,
  );
  await recorder.finalize("completed", null);
}

describe("local run bundles", () => {
  test("writes private, redacted, hash-verifiable artifacts", async () => {
    const secret = ["custom", "provider", "credential"].join("-");
    const recorder = await createRecorder([secret]);
    recorder.record("operator.input", { line: `debug ${secret}` });
    await recorder.finalize("completed", null);

    expect(await mode(recorder.paths.runDirectory)).toBe(0o700);
    for (const file of [
      recorder.paths.manifest,
      recorder.paths.events,
      recorder.paths.summary,
    ]) {
      expect(await mode(file)).toBe(0o600);
    }
    const eventsText = await readFile(recorder.paths.events, "utf8");
    expect(eventsText).not.toContain(secret);
    expect(eventsText).toContain("[REDACTED]");
    expect(await readAndVerifyEvents(recorder.paths.runDirectory)).toHaveLength(
      2,
    );
  });

  test("redacts failure details before writing the summary", async () => {
    const secret = ["summary", "only", "credential"].join("-");
    const recorder = await createRecorder([secret]);
    recorder.record("run.started", { phase: "startup" });
    const summary = await recorder.finalize(
      "failed",
      null,
      new Error(`provider rejected ${secret}`),
    );

    expect(summary.error?.message).toBe("provider rejected [REDACTED]");
    expect(await readFile(recorder.paths.summary, "utf8")).not.toContain(
      secret,
    );
  });

  test("fails closed when the selected state directory is group-readable", async () => {
    const stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-open-"));
    temporaryDirectories.push(stateDirectory);
    await chmod(stateDirectory, 0o750);
    await expect(
      RunRecorder.create({
        stateDirectory,
        controllerVersion: "0.1.0",
        controllerCommit: "a".repeat(40),
        model: "openai/gpt-5.6-terra",
        repository: "example/repository",
        checkout: "/tmp/checkout",
        worktreeRoot: "/tmp/worktrees",
        maxWorkers: 2,
      }),
    ).rejects.toThrow("permissions must be 0700");
  });

  test("detects event-stream tampering", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { marker: "original" });
    await recorder.finalize("completed", null);
    const text = await readFile(recorder.paths.events, "utf8");
    await writeFile(
      recorder.paths.events,
      text.replace("original", "tampered"),
      "utf8",
    );
    await expect(
      readAndVerifyEvents(recorder.paths.runDirectory),
    ).rejects.toThrow("Event hash mismatch");
  });

  test("finalizes startup failures into a replayable failed bundle", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { phase: "startup" });
    const summary = await recorder.finalize(
      "failed",
      null,
      new Error("provider configuration rejected"),
    );
    expect(summary.status).toBe("failed");
    expect(summary.error?.message).toBe("provider configuration rejected");
    const report = replayRunBundle(
      await loadRunBundle(recorder.paths.runDirectory),
      {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      },
    );
    expect(report.status).toBe("failed");
  });
});

describe("run bundle replay", () => {
  test("reconstructs synthetic command, retry, and worker lifecycles", async () => {
    const recorder = await createRecorder();
    const correlation = {
      prNumber: 42,
      headSha: "b".repeat(40),
      generation: 3,
    };
    const firstTurn = recorder.newId("worker-turn");
    const secondTurn = recorder.newId("worker-turn");
    const commandId = recorder.newId("command");
    const toolCallId = recorder.newId("tool");
    recorder.record("run.started", { scenario: "synthetic-retry" });
    recorder.record(
      "worker.started",
      { runtimeAgent: "pr-42-g3" },
      correlation,
    );
    recorder.record(
      "worker.attempt.started",
      { attempt: 1, prompt: "first" },
      { ...correlation, modelTurnId: firstTurn },
    );
    recorder.record(
      "worker.attempt.failed",
      { attempt: 1, error: "schema rejected" },
      { ...correlation, modelTurnId: firstTurn },
    );
    recorder.record(
      "worker.attempt.started",
      { attempt: 2, prompt: "retry" },
      { ...correlation, modelTurnId: secondTurn },
    );
    recorder.record(
      "tool.started",
      { tool: "run_local_command", input: { executable: "git" } },
      { ...correlation, modelTurnId: secondTurn, toolCallId },
    );
    recorder.record(
      "command.started",
      { executable: "git", args: ["status"] },
      { ...correlation, modelTurnId: secondTurn, toolCallId, commandId },
    );
    recorder.record(
      "command.completed",
      { executable: "git", exitCode: 0, stdout: "clean", stderr: "" },
      { ...correlation, modelTurnId: secondTurn, toolCallId, commandId },
    );
    recorder.record(
      "tool.completed",
      { tool: "run_local_command", result: { exitCode: 0 } },
      { ...correlation, modelTurnId: secondTurn, toolCallId },
    );
    recorder.record(
      "worker.attempt.completed",
      { attempt: 2, result: { state: "waiting-ci" } },
      { ...correlation, modelTurnId: secondTurn },
    );
    recorder.record(
      "worker.completed",
      { result: { state: "waiting-ci" } },
      correlation,
    );
    await recorder.finalize("completed", null);

    const report = replayRunBundle(
      await loadRunBundle(recorder.paths.runDirectory),
      {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      },
    );
    expect(report.commands).toEqual({
      started: 1,
      completed: 1,
      cancelled: 0,
      failed: 0,
      open: [],
    });
    expect(report.workers).toEqual({
      started: 1,
      completed: 1,
      cancelled: 0,
      failed: 0,
      open: [],
    });
    expect(report.tools).toEqual({
      started: 1,
      completed: 1,
      cancelled: 0,
      failed: 0,
      open: [],
    });
    expect(report.workerAttempts).toEqual({
      started: 2,
      completed: 1,
      cancelled: 0,
      failed: 1,
      open: [],
    });
  });
});

describe("run bundle correlation replay", () => {
  test("rejects tools whose model-turn parent does not exist", async () => {
    const recorder = await createRecorder();
    await recordSyntheticWorkerRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const events = bundle.events.map((event) =>
      event.kind === "tool.started"
        ? {
            ...event,
            correlation: {
              ...event.correlation,
              modelTurnId: "missing-model-turn",
            },
          }
        : event,
    );

    expect(() =>
      replayRunBundle(
        { ...bundle, events },
        {
          currentControllerVersion: "0.1.0",
          allowVersionMismatch: false,
        },
      ),
    ).toThrow("nonexistent or inactive model turn");
  });

  test("rejects commands whose identity differs from their tool parent", async () => {
    const recorder = await createRecorder();
    await recordSyntheticWorkerRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const events = bundle.events.map((event) =>
      event.kind === "command.started"
        ? {
            ...event,
            correlation: {
              ...event.correlation,
              headSha: "c".repeat(40),
            },
          }
        : event,
    );

    expect(() =>
      replayRunBundle(
        { ...bundle, events },
        {
          currentControllerVersion: "0.1.0",
          allowVersionMismatch: false,
        },
      ),
    ).toThrow("mismatched tool correlation field headSha");
  });

  test("rejects a model turn that closes before its tool", async () => {
    const recorder = await createRecorder();
    await recordSyntheticWorkerRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const events = bundle.events.toSorted((left, right) => {
      if (
        left.kind === "worker.attempt.completed" &&
        right.kind === "tool.completed"
      ) {
        return -1;
      }
      if (
        left.kind === "tool.completed" &&
        right.kind === "worker.attempt.completed"
      ) {
        return 1;
      }
      return left.sequence - right.sequence;
    });

    expect(() =>
      replayRunBundle(
        { ...bundle, events },
        {
          currentControllerVersion: "0.1.0",
          allowVersionMismatch: false,
        },
      ),
    ).toThrow("closed before its active tool");
  });
});

describe("run bundle lifecycle replay", () => {
  test("rejects completed runs with open command or model lifecycles", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { scenario: "incomplete-capture" });
    recorder.record(
      "command.started",
      { executable: "git", args: ["status"] },
      { commandId: recorder.newId("command") },
    );
    recorder.record(
      "master.turn.started",
      { prompt: "status" },
      { modelTurnId: recorder.newId("master-turn") },
    );
    await recorder.finalize("completed", null);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() =>
      replayRunBundle(bundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow("Completed run has open lifecycles");
  });

  test("replays deliberate worker cancellation as a terminal lifecycle", async () => {
    const recorder = await createRecorder();
    const correlation = {
      prNumber: 42,
      headSha: "b".repeat(40),
      generation: 3,
    };
    recorder.record("run.started", { scenario: "worker-cancelled" });
    recorder.record(
      "worker.started",
      { runtimeAgent: "pr-42-g3" },
      correlation,
    );
    recorder.record(
      "worker.cancelled",
      { reason: "head advanced" },
      correlation,
    );
    await recorder.finalize("completed", null);

    const report = replayRunBundle(
      await loadRunBundle(recorder.paths.runDirectory),
      {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      },
    );
    expect(report.workers).toEqual({
      started: 1,
      completed: 0,
      cancelled: 1,
      failed: 0,
      open: [],
    });
  });

  test("replays an empty-fleet control plane and hides bodies by default", async () => {
    const recorder = await createRecorder();
    await recordSuccessfulEmptyRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const report = replayRunBundle(bundle, {
      currentControllerVersion: "0.1.0",
      allowVersionMismatch: false,
    });
    expect(report.status).toBe("completed");
    expect(report.finalSnapshot).toEqual(snapshot);
    expect(report.eventCount).toBe(7);

    const firstEvent = bundle.events[0];
    if (firstEvent === undefined) {
      throw new Error("recorded run unexpectedly had no events");
    }
    const hidden = inspectEvents(
      [
        {
          ...firstEvent,
          payload: {
            prompt: "private model prompt",
            messages: ["private operator input"],
            input: { message: "private worker guidance" },
            result: "kept",
          },
        },
      ],
      { showBodies: false },
    );
    expect(hidden[0]?.payload["prompt"]).toBe("[hidden; pass --show-bodies]");
    expect(hidden[0]?.payload["messages"]).toBe("[hidden; pass --show-bodies]");
    expect(hidden[0]?.payload["input"]).toEqual({
      message: "[hidden; pass --show-bodies]",
    });
    expect(hidden[0]?.payload["result"]).toBe("kept");
  });
});

describe("run bundle inspection", () => {
  test("hides payload-bearing snapshot fields in inspected summaries", async () => {
    const recorder = await createRecorder();
    const pr = identity(42);
    const state = PrStateSchema.parse({
      identity: pr,
      logicalOwner: "fleet-controller",
      runtimeAgent: null,
      agentGeneration: 1,
      model: "openai/gpt-5.6-terra",
      status: "paused",
      classification: "paused",
      stackId: "pr-42",
      worktree: "/tmp/worktrees/pr-42",
      setupComplete: true,
      evidence: evidence(pr, {
        buildkiteFailure: {
          jobId: "job-1",
          name: "verify",
          state: "failed",
          webUrl: "https://buildkite.com/example/builds/1#job-1",
          startedAt: "2026-08-03T00:00:00.000Z",
          log: "private command log",
        },
        reviewFindings: [
          {
            id: "thread-1",
            author: "reviewer",
            body: "private review body",
            severity: "P2",
            resolved: false,
            outdated: false,
          },
        ],
      }),
      lastAgentReportAt: null,
      lastProgressAt: "2026-08-03T00:00:00.000Z",
      noProgressTicks: 0,
      prodSentAt: null,
      escalation: "review blocked",
      priority: 0,
    });
    recorder.record("run.started", { scenario: "summary-masking" });
    await recorder.finalize("completed", {
      open: 1,
      green: 0,
      active: 0,
      queued: 0,
      pending: 0,
      paused: 1,
      prs: [state],
    });
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    const hidden = inspectRunSummary(bundle.summary, false);
    expect(hidden.finalSnapshot?.prs[0]?.evidence.reviewFindings[0]?.body).toBe(
      "[hidden; pass --show-bodies]",
    );
    expect(hidden.finalSnapshot?.prs[0]?.evidence.buildkiteFailure?.log).toBe(
      "[hidden; pass --show-bodies]",
    );
    expect(inspectRunSummary(bundle.summary, true)).toEqual(bundle.summary);
  });
});

describe("run-scoped Mastra storage", () => {
  test("initializes and closes private Mastra and DuckDB stores", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { test: "storage" });
    const runtime = await createFleetMastraRuntime(recorder);
    expect(await mode(recorder.paths.mastra)).toBe(0o600);
    expect(await mode(recorder.paths.observability)).toBe(0o600);
    await runtime.shutdown();
    await recorder.finalize("completed", null);
    const artifacts = await readdir(recorder.paths.runDirectory);
    for (const artifact of artifacts) {
      expect(await mode(path.join(recorder.paths.runDirectory, artifact))).toBe(
        0o600,
      );
    }
  });
});
