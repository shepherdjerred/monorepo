import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
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
import type { RecordedRunEvent } from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import type { FleetSnapshot } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { writeFileSinkSynchronously } from "@shepherdjerred/pr-fleet-controller/src/synchronous-file-sink.ts";
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
    controllerSourceDirty: false,
    controllerSourceFingerprint: "b".repeat(64),
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

async function runCliWithImplicitCheckout(): Promise<{
  bundle: Awaited<ReturnType<typeof loadRunBundle>>;
  exitCode: number;
  stderr: string;
}> {
  const parent = await mkdtemp(path.join(tmpdir(), "pr-fleet-cli-"));
  temporaryDirectories.push(parent);
  const stateDirectory = path.join(parent, "state");
  const binDirectory = path.join(parent, "bin");
  await mkdir(binDirectory);
  const packageDirectory = path.join(import.meta.dir, "..");
  const checkout = path.join(parent, "checkout");
  const gitPath = path.join(binDirectory, "git");
  await writeFile(
    gitPath,
    `#!/bin/sh\nif [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then\n  printf '%s\\n' "$PR_FLEET_TEST_CHECKOUT"\n  exit 0\nfi\nexit 9\n`,
  );
  await chmod(gitPath, 0o700);
  for (const executable of [
    "bk",
    "bun",
    "gh",
    "git-spice",
    "mise",
    "rg",
    "sandbox-exec",
  ]) {
    const executablePath = path.join(binDirectory, executable);
    await writeFile(executablePath, "#!/bin/sh\nexit 0\n");
    await chmod(executablePath, 0o700);
  }
  const subprocess = Bun.spawn(
    [
      process.execPath,
      path.join(packageDirectory, "src", "cli.ts"),
      "--model",
      "openai/gpt-5.6-terra",
      "--max-workers",
      "0",
      "--state-dir",
      stateDirectory,
    ],
    {
      cwd: packageDirectory,
      env: {
        ...Bun.env,
        PATH: binDirectory,
        PR_FLEET_TEST_CHECKOUT: checkout,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
  ]);
  const runs = await readdir(stateDirectory);
  expect(runs).toHaveLength(1);
  return {
    bundle: await loadRunBundle(path.join(stateDirectory, runs[0] ?? "")),
    exitCode,
    stderr,
  };
}

async function runCliInterruptedDuringCheckout(): Promise<{
  bundle: Awaited<ReturnType<typeof loadRunBundle>>;
  exitCode: number;
  stderr: string;
}> {
  const parent = await mkdtemp(path.join(tmpdir(), "pr-fleet-sigint-"));
  temporaryDirectories.push(parent);
  const stateDirectory = path.join(parent, "state");
  const binDirectory = path.join(parent, "bin");
  const readyFifo = path.join(parent, "ready.fifo");
  const releaseFifo = path.join(parent, "release.fifo");
  await mkdir(binDirectory);
  const fifoResult = Bun.spawnSync(["mkfifo", readyFifo, releaseFifo]);
  if (fifoResult.exitCode !== 0) {
    throw new Error(
      `mkfifo failed: ${new TextDecoder().decode(fifoResult.stderr)}`,
    );
  }
  const packageDirectory = path.join(import.meta.dir, "..");
  const checkout = path.join(parent, "checkout");
  const gitPath = path.join(binDirectory, "git");
  await writeFile(
    gitPath,
    `#!/bin/sh\nif [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then\n  printf 'ready\\n' > "$PR_FLEET_READY_FIFO"\n  IFS= read -r release < "$PR_FLEET_RELEASE_FIFO"\n  printf '%s\\n' "$PR_FLEET_TEST_CHECKOUT"\n  exit 0\nfi\nexit 9\n`,
  );
  await chmod(gitPath, 0o700);
  for (const executable of [
    "bk",
    "bun",
    "gh",
    "git-spice",
    "mise",
    "rg",
    "sandbox-exec",
  ]) {
    const executablePath = path.join(binDirectory, executable);
    await writeFile(executablePath, "#!/bin/sh\nexit 0\n");
    await chmod(executablePath, 0o700);
  }
  const subprocess = Bun.spawn(
    [
      process.execPath,
      path.join(packageDirectory, "src", "cli.ts"),
      "--model",
      "openai/gpt-5.6-terra",
      "--max-workers",
      "1",
      "--state-dir",
      stateDirectory,
    ],
    {
      cwd: packageDirectory,
      env: {
        ...Bun.env,
        PATH: binDirectory,
        PR_FLEET_READY_FIFO: readyFifo,
        PR_FLEET_RELEASE_FIFO: releaseFifo,
        PR_FLEET_TEST_CHECKOUT: checkout,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(await readFile(readyFifo, "utf8")).toBe("ready\n");
  subprocess.kill("SIGINT");
  await writeFile(releaseFifo, "release\n");
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
  ]);
  const runs = await readdir(stateDirectory);
  expect(runs).toHaveLength(1);
  return {
    bundle: await loadRunBundle(path.join(stateDirectory, runs[0] ?? "")),
    exitCode,
    stderr,
  };
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

async function finalizeCompletedRun(recorder: RunRecorder): Promise<void> {
  recorder.record("shutdown.started", { activeWorkers: 0 });
  recorder.record("shutdown.completed", { snapshot });
  await recorder.finalize("completed", snapshot);
}

function expectFreeFormBodiesHidden(firstEvent: RecordedRunEvent): void {
  const hidden = inspectEvents(
    [
      {
        ...firstEvent,
        payload: {
          prompt: "private model prompt",
          messages: ["private operator input"],
          input: { message: "private worker guidance" },
          args: ["pr", "comment", "--body", "private review reply"],
          reason: "private pause reason",
          lastAction: "private worker action",
          blockers: ["private worker blocker"],
          hardFailures: ["private failure detail"],
          reviewFindings: ["private structured finding"],
          validation: ["private validation detail"],
          changes: ["private fleet change"],
          change: "private singular fleet change",
          error: "Patch failed: private command stderr",
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
  for (const key of [
    "blockers",
    "changes",
    "hardFailures",
    "reviewFindings",
    "validation",
  ]) {
    expect(hidden[0]?.payload[key]).toEqual(["[hidden; pass --show-bodies]"]);
  }
  expect(hidden[0]?.payload["args"]).toEqual([
    "[hidden; pass --show-bodies]",
    "[hidden; pass --show-bodies]",
    "[hidden; pass --show-bodies]",
    "[hidden; pass --show-bodies]",
  ]);
  expect(hidden[0]?.payload["change"]).toBe("[hidden; pass --show-bodies]");
  for (const key of ["error", "lastAction", "reason"]) {
    expect(hidden[0]?.payload[key]).toBe("[hidden; pass --show-bodies]");
  }
  expect(hidden[0]?.payload["result"]).toBe("kept");
}

async function recordSyntheticWorkerRun(recorder: RunRecorder): Promise<void> {
  const tickId = recorder.newId("tick");
  const correlation = {
    tickId,
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
  recorder.record("tick.started", { trigger: "startup" }, { tickId });
  recorder.record("fleet.snapshot", { snapshot }, { tickId });
  recorder.record("worker.started", { runtimeAgent: "pr-42-g3" }, correlation);
  recorder.record(
    "tick.completed",
    {
      report: {
        trigger: "startup",
        snapshot,
        changes: ["started pr-42-g3"],
        nextHeartbeatSeconds: 300,
      },
    },
    { tickId },
  );
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
  await finalizeCompletedRun(recorder);
}

async function testSynchronousPersistenceFailure(): Promise<void> {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-run-"));
  temporaryDirectories.push(stateDirectory);
  let failNextWrite = true;
  const recorder = await RunRecorder.create({
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
    writeEvent: (sink, line) => {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("state volume is full");
      }
      writeFileSinkSynchronously(sink, line);
    },
  });

  expect(() => recorder.record("run.started", { phase: "startup" })).toThrow(
    "state volume is full",
  );
  recorder.record("run.started", { phase: "startup" });
  await recorder.finalize("failed", null, new Error("capture recovered"));

  const events = await readAndVerifyEvents(recorder.paths.runDirectory);
  expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(events.map((event) => event.kind)).toEqual([
    "run.started",
    "run.failed",
  ]);
}

describe("local run bundles", () => {
  test(
    "event persistence failures are synchronous",
    testSynchronousPersistenceFailure,
  );

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

  test("does not redact summary control fields that equal a secret", async () => {
    const recorder = await createRecorder(["completed"]);
    recorder.record("run.started", { phase: "startup" });
    const summary = await recorder.finalize("completed", snapshot);

    expect(summary.status).toBe("completed");
    expect(await loadRunBundle(recorder.paths.runDirectory)).toMatchObject({
      summary: { status: "completed" },
    });
  });

  test("rejects short explicit secrets before creating a bundle", async () => {
    await expect(createRecorder(["abc"])).rejects.toThrow(
      "Explicit run-bundle secret values must be at least 8 characters",
    );
  });

  test("resolves bootstrap metadata before recording controller data", async () => {
    const stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-run-"));
    temporaryDirectories.push(stateDirectory);
    const recorder = await RunRecorder.create({
      stateDirectory,
      controllerVersion: "unresolved",
      controllerCommit: "0".repeat(40),
      controllerSourceDirty: true,
      controllerSourceFingerprint: "0".repeat(64),
      controllerSourceResolved: false,
      model: "openai/gpt-5.6-terra",
      repository: "shepherdjerred/monorepo",
      checkout: "/bootstrap",
      worktreeRoot: "/bootstrap/worktrees",
      maxWorkers: 1,
    });
    recorder.record("run.started", { phase: "preflight" });
    await recorder.initializeController({
      controllerVersion: "0.1.0",
      controllerCommit: "a".repeat(40),
      controllerSourceDirty: false,
      controllerSourceFingerprint: "b".repeat(64),
      model: "openai/gpt-5.6-terra",
      repository: "shepherdjerred/monorepo",
      checkout: "/repo",
      worktreeRoot: "/repo/worktrees",
      maxWorkers: 5,
    });
    recorder.configureSecretValues(["private-provider-key"]);
    recorder.record("environment.result", {
      detail: "token=private-provider-key",
    });
    await recorder.finalize("failed", null, new Error("startup failed"));

    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    expect(bundle.manifest).toMatchObject({
      controllerVersion: "0.1.0",
      controllerCommit: "a".repeat(40),
      controllerSourceDirty: false,
      controllerSourceFingerprint: "b".repeat(64),
      controllerSourceResolved: true,
      checkout: "/repo",
      worktreeRoot: "/repo/worktrees",
      maxWorkers: 5,
    });
    expect(bundle.events[1]?.payload["detail"]).toBe("token=[REDACTED]");
  });
});

describe("local run bundle integrity", () => {
  test("fails closed when the selected state directory is group-readable", async () => {
    const stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-open-"));
    temporaryDirectories.push(stateDirectory);
    await chmod(stateDirectory, 0o750);
    await expect(
      RunRecorder.create({
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
      }),
    ).rejects.toThrow("permissions must be 0700");
  });

  test("detects event-stream tampering", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { marker: "original" });
    await finalizeCompletedRun(recorder);
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

  test("serializes overlapping finalization attempts around the first outcome", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { phase: "startup" });
    const failure = new Error("tick failed");
    const failed = recorder.finalize("failed", null, failure);
    const completed = recorder.finalize("completed", snapshot);
    expect(failed).toBe(completed);

    const summary = await failed;
    expect(summary.status).toBe("failed");
    expect(summary.countsByKind["run.failed"]).toBe(1);
    expect(summary.countsByKind["run.completed"]).toBeUndefined();
  });

  test("captures a missing-tool preflight failure in a replayable bundle", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "pr-fleet-cli-"));
    temporaryDirectories.push(parent);
    const stateDirectory = path.join(parent, "state");
    const packageDirectory = path.join(import.meta.dir, "..");
    const subprocess = Bun.spawn(
      [
        process.execPath,
        path.join(packageDirectory, "src", "cli.ts"),
        "--model",
        "openai/gpt-5.6-terra",
        "--checkout",
        packageDirectory,
        "--state-dir",
        stateDirectory,
      ],
      {
        cwd: packageDirectory,
        env: { ...Bun.env, PATH: "" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stderr).text(),
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Required executable is missing: bk");

    const runs = await readdir(stateDirectory);
    expect(runs).toHaveLength(1);
    const bundle = await loadRunBundle(
      path.join(stateDirectory, runs[0] ?? ""),
    );
    expect(bundle.manifest.controllerSourceResolved).toBe(false);
    expect(bundle.manifest.controllerVersion).toBe("0.1.0");
    expect(bundle.summary.status).toBe("failed");
    const report = replayRunBundle(bundle, {
      currentControllerVersion: "0.1.0",
      allowVersionMismatch: false,
    });
    expect(report.run).toEqual({
      started: 1,
      completed: 0,
      cancelled: 0,
      failed: 1,
      open: [],
    });
  });
});

describe("CLI command capture", () => {
  test("rejects an in-repository default XDG state root before writing", async () => {
    const packageDirectory = path.join(import.meta.dir, "..");
    const stateBase = path.join(
      packageDirectory,
      `.test-xdg-state-${crypto.randomUUID()}`,
    );
    temporaryDirectories.push(stateBase);
    const subprocess = Bun.spawn(
      [
        "bun",
        "run",
        "src/cli.ts",
        "--model",
        "openai/gpt-5.6-terra",
        "--repo",
        "acceptance/empty",
        "--checkout",
        "/tmp/checkout",
      ],
      {
        cwd: packageDirectory,
        env: { ...Bun.env, XDG_STATE_HOME: stateBase },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Run-bundle state directory must be outside the controller repository",
    );
    await expect(
      stat(path.join(stateBase, "pr-fleet-controller")),
    ).rejects.toThrow();
  });

  test("records implicit checkout discovery before config validation", async () => {
    const { bundle, exitCode, stderr } = await runCliWithImplicitCheckout();
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("maxWorkers");
    const discoveryEvents = bundle.events.filter(
      (event) =>
        (event.kind === "command.started" ||
          event.kind === "command.completed") &&
        event.payload["executable"] === "git",
    );
    expect(discoveryEvents).toHaveLength(2);
    expect(discoveryEvents[0]?.payload["args"]).toEqual([
      "rev-parse",
      "--show-toplevel",
    ]);
    expect(discoveryEvents[1]?.payload["stdout"]).toBe("[REDACTED]");
    const report = replayRunBundle(bundle, {
      currentControllerVersion: "0.1.0",
      allowVersionMismatch: false,
    });
    expect(report.commands).toEqual({
      started: 1,
      completed: 1,
      cancelled: 0,
      failed: 0,
      open: [],
    });
  });

  test("waits for checkout discovery before finalizing SIGINT", async () => {
    const { bundle, exitCode, stderr } =
      await runCliInterruptedDuringCheckout();
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const report = replayRunBundle(bundle, {
      currentControllerVersion: "0.1.0",
      allowVersionMismatch: false,
    });
    expect(report.status).toBe("completed");
    expect(report.commands).toEqual({
      started: 1,
      completed: 1,
      cancelled: 0,
      failed: 0,
      open: [],
    });
    expect(report.shutdown).toEqual({
      started: 1,
      completed: 1,
      cancelled: 0,
      failed: 0,
      open: [],
    });
  });
});

describe("run bundle replay", () => {
  test("reconstructs synthetic command, retry, and worker lifecycles", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    const correlation = {
      tickId,
      prNumber: 42,
      headSha: "b".repeat(40),
      generation: 3,
    };
    const firstTurn = recorder.newId("worker-turn");
    const secondTurn = recorder.newId("worker-turn");
    const commandId = recorder.newId("command");
    const toolCallId = recorder.newId("tool");
    recorder.record("run.started", { scenario: "synthetic-retry" });
    recorder.record("tick.started", { trigger: "startup" }, { tickId });
    recorder.record("fleet.snapshot", { snapshot }, { tickId });
    recorder.record(
      "worker.started",
      { runtimeAgent: "pr-42-g3" },
      correlation,
    );
    recorder.record(
      "tick.completed",
      {
        report: {
          trigger: "startup",
          snapshot,
          changes: ["started pr-42-g3"],
          nextHeartbeatSeconds: 300,
        },
      },
      { tickId },
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
    await finalizeCompletedRun(recorder);

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
  test("rejects an event whose run ID differs from the manifest", async () => {
    const recorder = await createRecorder();
    await recordSyntheticWorkerRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const firstEvent = bundle.events[0];
    if (firstEvent === undefined) {
      throw new Error("synthetic run unexpectedly had no events");
    }
    const events = [
      { ...firstEvent, runId: "different-run" },
      ...bundle.events.slice(1),
    ];

    expect(() =>
      replayRunBundle(
        { ...bundle, events },
        {
          currentControllerVersion: "0.1.0",
          allowVersionMismatch: false,
        },
      ),
    ).toThrow("Event 1 run ID does not match the manifest");
  });

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

  test("rejects correlation introduced only by a terminal event", async () => {
    const recorder = await createRecorder();
    await recordSyntheticWorkerRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const events = bundle.events.map((event) =>
      event.kind === "command.completed"
        ? {
            ...event,
            correlation: {
              ...event.correlation,
              tickId: "fabricated-tick",
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
    ).toThrow("mismatched command start correlation field tickId");
  });
});

describe("worker tick ancestry replay", () => {
  test("rejects a worker without a tick ancestor", async () => {
    const recorder = await createRecorder();
    await recordSyntheticWorkerRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const events = bundle.events.map((event) =>
      event.correlation.prNumber === 42
        ? {
            ...event,
            correlation: { ...event.correlation, tickId: undefined },
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
    ).toThrow("worker.started is missing its tick correlation");
  });

  test("rejects a worker whose tick ancestor does not exist", async () => {
    const recorder = await createRecorder();
    await recordSyntheticWorkerRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const events = bundle.events.map((event) =>
      event.correlation.prNumber === 42
        ? {
            ...event,
            correlation: {
              ...event.correlation,
              tickId: "fabricated-tick",
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
    ).toThrow(
      "worker.started references a nonexistent or inactive tick: fabricated-tick",
    );
  });

  test("rejects a worker dispatched after its tick closes", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    const correlation = {
      tickId,
      prNumber: 42,
      headSha: "b".repeat(40),
      generation: 3,
    };
    recorder.record("run.started", { scenario: "late-worker-dispatch" });
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
      "worker.started",
      { runtimeAgent: "pr-42-g3" },
      correlation,
    );
    recorder.record(
      "worker.completed",
      { result: { state: "waiting-ci" } },
      correlation,
    );
    await finalizeCompletedRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() =>
      replayRunBundle(bundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow(
      `worker.started references a nonexistent or inactive tick: ${tickId}`,
    );
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

describe("tick snapshot replay", () => {
  test("does not reuse a snapshot after its tick lifecycle closes", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    recorder.record("run.started", { scenario: "reused-tick" });
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
    recorder.record("tick.started", { trigger: "user" }, { tickId });
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
    await finalizeCompletedRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() =>
      replayRunBundle(bundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow(
      `Tick ${tickId} completed with a snapshot not emitted by that tick`,
    );
  });
});

describe("run bundle lifecycle replay", () => {
  test("rejects events recorded before run.started", async () => {
    const recorder = await createRecorder();
    const commandId = recorder.newId("command");
    recorder.record("run.started", { scenario: "misordered-run" });
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
    await finalizeCompletedRun(recorder);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);
    const runStarted = bundle.events[0];
    const commandStarted = bundle.events[1];
    if (runStarted === undefined || commandStarted === undefined) {
      throw new Error("misordered-run fixture is incomplete");
    }
    const events = [commandStarted, runStarted, ...bundle.events.slice(2)];

    expect(() =>
      replayRunBundle(
        { ...bundle, events },
        {
          currentControllerVersion: "0.1.0",
          allowVersionMismatch: false,
        },
      ),
    ).toThrow("Run bundle must begin with run.started");
  });

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

  test("rejects open and orphaned tick lifecycles", async () => {
    const openRecorder = await createRecorder();
    openRecorder.record("run.started", { scenario: "open-tick" });
    openRecorder.record(
      "tick.started",
      { trigger: "startup" },
      { tickId: openRecorder.newId("tick") },
    );
    await finalizeCompletedRun(openRecorder);
    const openBundle = await loadRunBundle(openRecorder.paths.runDirectory);
    expect(() =>
      replayRunBundle(openBundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow("Completed run has open lifecycles: ticks=");

    const orphanedRecorder = await createRecorder();
    orphanedRecorder.record("run.started", { scenario: "orphaned-tick" });
    orphanedRecorder.record(
      "tick.failed",
      { error: "failed before start" },
      { tickId: orphanedRecorder.newId("tick") },
    );
    await orphanedRecorder.finalize("failed", null);
    const orphanedBundle = await loadRunBundle(
      orphanedRecorder.paths.runDirectory,
    );
    expect(() =>
      replayRunBundle(orphanedBundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow("tick.failed has no matching tick.started");
  });

  test("rejects incomplete shutdowns and run-summary terminal mismatches", async () => {
    const recorder = await createRecorder();
    recorder.record("run.started", { scenario: "open-shutdown" });
    recorder.record("shutdown.started", { activeWorkers: 0 });
    await recorder.finalize("completed", null);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() =>
      replayRunBundle(bundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow("Completed run has open lifecycles: shutdown=");
    expect(() =>
      replayRunBundle(
        { ...bundle, summary: { ...bundle.summary, status: "failed" } },
        {
          currentControllerVersion: "0.1.0",
          allowVersionMismatch: false,
        },
      ),
    ).toThrow(
      "Summary status failed does not match final run event run.completed",
    );

    const missingRecorder = await createRecorder();
    missingRecorder.record("run.started", { scenario: "missing-shutdown" });
    await missingRecorder.finalize("completed", null);
    const missingBundle = await loadRunBundle(
      missingRecorder.paths.runDirectory,
    );
    expect(() =>
      replayRunBundle(missingBundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow(
      "Completed run must contain exactly one completed shutdown lifecycle",
    );
  });
});

describe("shutdown boundary replay", () => {
  test("rejects controller events recorded after shutdown completes", async () => {
    const recorder = await createRecorder();
    const commandId = recorder.newId("command");
    recorder.record("run.started", { scenario: "late-command" });
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
    await recorder.finalize("completed", snapshot);
    const bundle = await loadRunBundle(recorder.paths.runDirectory);

    expect(() =>
      replayRunBundle(bundle, {
        currentControllerVersion: "0.1.0",
        allowVersionMismatch: false,
      }),
    ).toThrow("command.started was recorded after shutdown.completed");
  });

  test("replays deliberate worker cancellation as a terminal lifecycle", async () => {
    const recorder = await createRecorder();
    const tickId = recorder.newId("tick");
    const correlation = {
      tickId,
      prNumber: 42,
      headSha: "b".repeat(40),
      generation: 3,
    };
    recorder.record("run.started", { scenario: "worker-cancelled" });
    recorder.record("tick.started", { trigger: "startup" }, { tickId });
    recorder.record("fleet.snapshot", { snapshot }, { tickId });
    recorder.record(
      "worker.started",
      { runtimeAgent: "pr-42-g3" },
      correlation,
    );
    recorder.record(
      "tick.completed",
      {
        report: {
          trigger: "startup",
          snapshot,
          changes: ["started pr-42-g3"],
          nextHeartbeatSeconds: 300,
        },
      },
      { tickId },
    );
    recorder.record(
      "worker.cancelled",
      { reason: "head advanced" },
      correlation,
    );
    await finalizeCompletedRun(recorder);

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
    expect(report.run).toEqual({
      started: 1,
      completed: 1,
      cancelled: 0,
      failed: 0,
      open: [],
    });
    expect(report.shutdown).toEqual({
      started: 1,
      completed: 1,
      cancelled: 0,
      failed: 0,
      open: [],
    });

    const firstEvent = bundle.events[0];
    if (firstEvent === undefined) {
      throw new Error("recorded run unexpectedly had no events");
    }
    expectFreeFormBodiesHidden(firstEvent);
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
    expect(hidden.finalSnapshot?.prs[0]?.escalation).toBe(
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
