import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexProvider } from "@shepherdjerred/code-review";
import { withCommandCorrelation } from "@shepherdjerred/pr-fleet-controller/src/command-correlation.ts";
import { CommandFleetEnvironment } from "@shepherdjerred/pr-fleet-controller/src/environment.ts";
import type { FleetTelemetry } from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type {
  RunEventCorrelation,
  RunEventKind,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";

class RecordingTelemetry implements FleetTelemetry {
  readonly runId = "environment-test";
  readonly events: {
    kind: RunEventKind;
    correlation: RunEventCorrelation;
    payload: Record<string, unknown>;
  }[] = [];
  #nextId = 0;

  newId(prefix: string): string {
    this.#nextId += 1;
    return `${prefix}-${String(this.#nextId)}`;
  }

  traceId(): string {
    return "0".repeat(32);
  }

  record(
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation: RunEventCorrelation = {},
  ): void {
    this.events.push({ kind, correlation, payload });
  }
}

class EnvironmentResultFailingTelemetry extends RecordingTelemetry {
  readonly failure = new Error("environment result persistence failed");

  override record(
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation: RunEventCorrelation = {},
  ): void {
    if (kind === "environment.result") {
      throw this.failure;
    }
    super.record(kind, payload, correlation);
  }
}

class StubCommandFleetEnvironment extends CommandFleetEnvironment {
  override runLocalCommand(): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    termination: "exit";
  }> {
    return Promise.resolve({
      exitCode: 0,
      stdout: "[]",
      stderr: "",
      termination: "exit",
    });
  }
}

test("environment result persistence failures use the fatal capture boundary", async () => {
  const telemetry = new EnvironmentResultFailingTelemetry();
  const environment = new StubCommandFleetEnvironment({
    repo: "shepherdjerred/monorepo",
    checkout: "/tmp/repo",
    worktreeRoot: "/tmp/worktrees",
    provider: codexProvider,
    telemetry,
  });

  await expect(environment.listOpenPrs()).rejects.toMatchObject({
    name: "TelemetryCaptureError",
    cause: telemetry.failure,
  });
});

test("environment results inherit the active reconciliation tick", async () => {
  const telemetry = new RecordingTelemetry();
  const environment = new StubCommandFleetEnvironment({
    repo: "shepherdjerred/monorepo",
    checkout: "/tmp/repo",
    worktreeRoot: "/tmp/worktrees",
    provider: codexProvider,
    telemetry,
  });

  await withCommandCorrelation({ tickId: "tick-1" }, () =>
    environment.listOpenPrs(),
  );

  expect(
    telemetry.events.find((event) => event.kind === "environment.result")
      ?.correlation,
  ).toEqual({ tickId: "tick-1" });
});

describe("command process-group termination", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pr-fleet-process-group-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const environment = new CommandFleetEnvironment({
    repo: "shepherdjerred/monorepo",
    checkout: "/tmp/repo",
    worktreeRoot: "/tmp/worktrees",
    provider: codexProvider,
  });

  async function runDescendant(output: string, signal?: AbortSignal) {
    const bun = Bun.which("bun");
    if (bun === null) {
      throw new Error("bun is required for process-group tests");
    }
    const script = `
      const output = Bun.argv.at(-1);
      if (output === undefined) throw new Error("missing output path");
      const child = Bun.spawn([
        "sh",
        "-c",
        'sleep 0.25; printf survived > "$1"',
        "child",
        output,
      ]);
      await child.exited;
    `;
    return environment.runLocalCommand({
      executable: bun,
      args: ["-e", script, output],
      cwd: directory,
      timeoutMs: signal === undefined ? 50 : 5000,
      signal,
    });
  }

  test("a timeout kills grandchildren before they can outlive the command", async () => {
    const output = path.join(directory, "timeout-survivor.txt");
    const result = await runDescendant(output);
    expect(result.exitCode).not.toBe(0);
    expect(result.termination).toBe("timeout");
    await Bun.sleep(400);
    expect(await Bun.file(output).exists()).toBe(false);
  });

  test("an abort kills the same complete process group", async () => {
    const output = path.join(directory, "abort-survivor.txt");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 50);
    try {
      const result = await runDescendant(output, controller.signal);
      expect(result.exitCode).not.toBe(0);
      expect(result.termination).toBe("abort");
    } finally {
      clearTimeout(timer);
    }
    await Bun.sleep(400);
    expect(await Bun.file(output).exists()).toBe(false);
  });

  test("an abort bounds a command blocked while writing stdin", async () => {
    const controller = new AbortController();
    const command = environment.runLocalCommand({
      executable: "sh",
      args: ["-c", "sleep 30"],
      cwd: directory,
      timeoutMs: 5000,
      signal: controller.signal,
      stdin: "x".repeat(8_388_608),
    });
    const timer = setTimeout(() => {
      controller.abort();
    }, 50);
    try {
      const result = await command;
      expect(result.exitCode).not.toBe(0);
      expect(result.termination).toBe("abort");
    } finally {
      clearTimeout(timer);
    }
  });
});

test("command events inherit their worker tool and model correlation", async () => {
  const telemetry = new RecordingTelemetry();
  const environment = new CommandFleetEnvironment({
    repo: "shepherdjerred/monorepo",
    checkout: "/tmp/repo",
    worktreeRoot: "/tmp/worktrees",
    provider: codexProvider,
    telemetry,
  });
  const parentCorrelation = {
    traceId: "1".repeat(32),
    prNumber: 42,
    headSha: "a".repeat(40),
    generation: 3,
    modelTurnId: "worker-turn-1",
    toolCallId: "tool-1",
  };
  await withCommandCorrelation(parentCorrelation, () =>
    environment.runLocalCommand({
      executable: process.execPath,
      args: [
        "-e",
        "const input = await Bun.stdin.text(); process.stdout.write(input)",
      ],
      cwd: tmpdir(),
      timeoutMs: 30_000,
      stdin: "captured input",
    }),
  );

  expect(telemetry.events).toHaveLength(2);
  expect(telemetry.events[0]?.kind).toBe("command.started");
  expect(telemetry.events[0]?.payload["hasStdin"]).toBe(true);
  expect(telemetry.events[1]?.kind).toBe("command.completed");
  expect(telemetry.events[0]?.correlation).toEqual({
    ...parentCorrelation,
    commandId: "command-1",
  });
  expect(telemetry.events[1]?.correlation).toEqual(
    telemetry.events[0]?.correlation,
  );
  expect(telemetry.events[1]?.payload["termination"]).toBe("exit");
  expect(telemetry.events[1]?.payload["stdout"]).toBe("captured input");
});

test("sensitive command output is returned but never recorded", async () => {
  const telemetry = new RecordingTelemetry();
  const environment = new CommandFleetEnvironment({
    repo: "shepherdjerred/monorepo",
    checkout: "/tmp/repo",
    worktreeRoot: "/tmp/worktrees",
    provider: codexProvider,
    telemetry,
  });
  const result = await environment.runLocalCommand({
    executable: process.execPath,
    args: [
      "-e",
      "const input = await Bun.stdin.text(); process.stdout.write(input)",
    ],
    cwd: tmpdir(),
    timeoutMs: 30_000,
    stdin: "credential-value",
    sensitiveOutput: true,
  });

  expect(result.stdout).toBe("credential-value");
  expect(telemetry.events[0]?.payload["sensitiveOutput"]).toBe(true);
  expect(telemetry.events[1]?.payload["stdout"]).toBe("[REDACTED]");
  expect(telemetry.events[1]?.payload["stderr"]).toBe("[REDACTED]");
  expect(JSON.stringify(telemetry.events)).not.toContain("credential-value");
});
