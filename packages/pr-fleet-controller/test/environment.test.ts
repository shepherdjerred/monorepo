import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { noopObserve } from "@mastra/core/tools";
import { codexProvider } from "@shepherdjerred/code-review";
import { buildPrState } from "@shepherdjerred/pr-fleet-controller/src/fleet-logic.ts";
import {
  currentCommandCorrelation,
  withCommandCorrelation,
  withoutCommandCorrelation,
} from "@shepherdjerred/pr-fleet-controller/src/command-correlation.ts";
import { CommandFleetEnvironment } from "@shepherdjerred/pr-fleet-controller/src/environment.ts";
import { settleEvidenceParts } from "@shepherdjerred/pr-fleet-controller/src/environment-refresh.ts";
import { collectInheritedWipEvidence } from "@shepherdjerred/pr-fleet-controller/src/inherited-wip.ts";
import type {
  CommandRequest,
  FleetTelemetry,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type {
  RunEventCorrelation,
  RunEventKind,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import {
  PrStateSchema,
  type PrState,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { FleetStore } from "@shepherdjerred/pr-fleet-controller/src/state.ts";
import { createWorkerRestackTools } from "@shepherdjerred/pr-fleet-controller/src/worker-restack-tools.ts";
import { evidence, identity } from "./fixtures.ts";

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
  override runLocalCommand(_request: CommandRequest): Promise<{
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

class CapturingCommandFleetEnvironment extends StubCommandFleetEnvironment {
  request: CommandRequest | undefined;

  override runLocalCommand(request: CommandRequest) {
    this.request = request;
    return super.runLocalCommand(request);
  }
}

class RestackPublishingEnvironment extends CommandFleetEnvironment {
  published = false;
  continued = false;

  override continueRestack(): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    termination: "exit";
  }> {
    this.continued = true;
    return Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      termination: "exit",
    });
  }

  override publishRestack(pr: PrState): Promise<{ headSha: string }> {
    this.published = true;
    return Promise.resolve({ headSha: pr.identity.headSha });
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

test("failed evidence refreshes record a correlated terminal event", async () => {
  const telemetry = new RecordingTelemetry();
  const environment = new StubCommandFleetEnvironment({
    repo: "shepherdjerred/monorepo",
    checkout: "/tmp/repo",
    worktreeRoot: "/tmp/worktrees",
    provider: codexProvider,
    telemetry,
  });
  const pr = identity(42);

  await expect(
    withCommandCorrelation({ tickId: "tick-2" }, () =>
      environment.refreshEvidence(pr),
    ),
  ).rejects.toBeInstanceOf(Error);

  expect(
    telemetry.events.find((event) => event.kind === "environment.failed"),
  ).toMatchObject({
    payload: { operation: "refreshEvidence" },
    correlation: {
      tickId: "tick-2",
      prNumber: pr.number,
      headSha: pr.headSha,
    },
  });
});

test("evidence refresh failure waits for concurrent siblings to settle", async () => {
  const firstError = new Error("checks failed");
  const events: string[] = [];
  const delayedReviews = (async () => {
    await Bun.sleep(20);
    events.push("reviews settled");
    return "reviews";
  })();

  await expect(
    settleEvidenceParts(
      Promise.reject(firstError),
      delayedReviews,
      Promise.resolve("conflict"),
    ),
  ).rejects.toBe(firstError);
  expect(events).toEqual(["reviews settled"]);
});

test("autonomous work can clear inherited command correlation", async () => {
  await withCommandCorrelation(
    {
      modelTurnId: "master-turn-1",
      toolCallId: "tool-1",
    },
    async () => {
      await withoutCommandCorrelation(async () => {
        expect(currentCommandCorrelation()).toEqual({});
      });
    },
  );
});

test("author scope is passed to GitHub without excluding drafts", async () => {
  const environment = new CapturingCommandFleetEnvironment({
    repo: "shepherdjerred/monorepo",
    checkout: "/tmp/repo",
    worktreeRoot: "/tmp/worktrees",
    provider: codexProvider,
    author: "shepherdjerred",
  });

  await environment.listOpenPrs();

  expect(environment.request?.args).toContain("--author");
  expect(environment.request?.args).toContain("shepherdjerred");
  expect(environment.request?.args).not.toContain("--draft");
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

  test("retains bounded output while draining both subprocess streams", async () => {
    const result = await environment.runLocalCommand({
      executable: process.execPath,
      args: [
        "-e",
        'process.stdout.write("x".repeat(1000000)); process.stderr.write("y".repeat(1000000))',
      ],
      cwd: directory,
      timeoutMs: 30_000,
      maxOutputBytes: 1024,
    });
    expect(Buffer.byteLength(result.stdout)).toBe(1024);
    expect(Buffer.byteLength(result.stderr)).toBe(1024);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
  });
});

test("inherited WIP keeps untracked contents out of evidence and bounds diffs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr-fleet-wip-"));
  const runGit = async (args: string[]) => {
    const process = Bun.spawn(["git", ...args], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(stderr);
  };
  try {
    await runGit(["init"]);
    await Bun.write(path.join(directory, "tracked.txt"), "base\n");
    await runGit(["add", "tracked.txt"]);
    await runGit([
      "-c",
      "user.name=Test Operator",
      "-c",
      "user.email=operator@example.com",
      "commit",
      "-m",
      "test: initialize fixture",
    ]);
    await Bun.write(path.join(directory, "tracked.txt"), "x".repeat(200_000));
    await Bun.write(
      path.join(directory, ".env.local"),
      "SECRET=credential-value\n",
    );
    const telemetry = new RecordingTelemetry();
    const environment = new CommandFleetEnvironment({
      repo: "shepherdjerred/monorepo",
      checkout: directory,
      worktreeRoot: path.join(directory, "worktrees"),
      provider: codexProvider,
      telemetry,
    });
    const wipEvidence = await collectInheritedWipEvidence({
      environment,
      worktree: directory,
      signal: new AbortController().signal,
    });

    expect(wipEvidence.untrackedPaths).toEqual([".env.local"]);
    expect(wipEvidence.unstagedDiffComplete).toBe(false);
    expect(Buffer.byteLength(wipEvidence.unstagedDiff)).toBeLessThanOrEqual(
      100_000,
    );
    expect(JSON.stringify(wipEvidence)).not.toContain("credential-value");
    expect(JSON.stringify(telemetry.events)).not.toContain("credential-value");
    expect(JSON.stringify(telemetry.events)).not.toContain("--no-index");
    await Bun.write(
      path.join(directory, ".env.local"),
      "SECRET=changed-credential-value\n",
    );
    const changedEvidence = await collectInheritedWipEvidence({
      environment,
      worktree: directory,
      signal: new AbortController().signal,
    });
    expect(changedEvidence.fingerprint).not.toBe(wipEvidence.fingerprint);
    expect(JSON.stringify(changedEvidence)).not.toContain(
      "changed-credential-value",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restack publication revalidates its captured head and clean worktree", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr-fleet-restack-"));
  const runGit = async (args: string[]): Promise<string> => {
    const process = Bun.spawn(["git", ...args], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(stderr);
    return stdout.trim();
  };
  try {
    await runGit(["init"]);
    await Bun.write(path.join(directory, "tracked.txt"), "base\n");
    await runGit(["add", "tracked.txt"]);
    await runGit([
      "-c",
      "user.name=Test Operator",
      "-c",
      "user.email=operator@example.com",
      "commit",
      "-m",
      "test: initialize fixture",
    ]);
    const headSha = await runGit(["rev-parse", "HEAD"]);
    const prIdentity = identity(88, { headSha });
    const initial = buildPrState(
      {
        identity: prIdentity,
        evidence: evidence(prIdentity),
        stackId: "pr-88",
      },
      {
        previous: undefined,
        pausedReason: undefined,
        model: "openai/gpt-5.6-terra",
      },
    ).state;
    const pr = PrStateSchema.parse({
      ...initial,
      worktree: directory,
      worktreeContext: {
        ownership: "operator",
        remoteHeadSha: headSha,
        localHeadSha: headSha,
        relation: "exact",
        dirty: false,
        stagedPaths: [],
        unstagedPaths: [],
      },
      setupComplete: true,
    });
    const store = new FleetStore(1);
    const environment = new RestackPublishingEnvironment({
      repo: "shepherdjerred/monorepo",
      checkout: directory,
      worktreeRoot: path.join(directory, "worktrees"),
      provider: codexProvider,
    });
    const tools = createWorkerRestackTools({
      store,
      pr,
      environment,
      worktree: directory,
      signal: new AbortController().signal,
      record: (_tool, _input, run) => run(),
      assertNotWaitingForAnswer: () => null,
    });
    const publishRestack = tools.publish_restack.execute;
    const continueRestack = tools.continue_restack.execute;
    if (publishRestack === undefined) {
      throw new Error("publish restack tool has no executor");
    }
    if (continueRestack === undefined) {
      throw new Error("continue restack tool has no executor");
    }
    const armPublication = () => {
      store.requestLease(pr, "stack-write");
      store.completedRestacks.set(pr.identity.number, {
        remoteHeadSha: headSha,
        localHeadSha: headSha,
      });
    };

    store.requestLease(pr, "stack-write");
    store.activeRestacks.add(pr.identity.number);
    await expect(
      continueRestack({ paths: ["tracked.txt"] }, { observe: noopObserve }),
    ).rejects.toThrow(/inspect again/);
    expect(environment.continued).toBe(false);
    const inspected = await collectInheritedWipEvidence({
      environment,
      worktree: directory,
      signal: new AbortController().signal,
    });
    store.inheritedWipInspections.set(pr.identity.number, {
      remoteHeadSha: headSha,
      localHeadSha: inspected.localHeadSha,
      fingerprint: inspected.fingerprint,
      complete: true,
    });
    await Bun.write(path.join(directory, "tracked.txt"), "late edit\n");
    await expect(
      continueRestack({ paths: ["tracked.txt"] }, { observe: noopObserve }),
    ).rejects.toThrow(/differs from the complete inspection/);
    expect(environment.continued).toBe(false);
    await Bun.write(path.join(directory, "tracked.txt"), "base\n");
    await continueRestack({ paths: ["tracked.txt"] }, { observe: noopObserve });
    expect(environment.continued).toBe(true);
    expect(store.activeRestacks.has(pr.identity.number)).toBe(false);

    armPublication();
    await publishRestack({}, { observe: noopObserve });
    expect(environment.published).toBe(true);

    environment.published = false;
    await Bun.write(path.join(directory, "operator-note.txt"), "new work\n");
    armPublication();
    await expect(publishRestack({}, { observe: noopObserve })).rejects.toThrow(
      /changed or incomplete worktree evidence/,
    );
    expect(environment.published).toBe(false);

    await rm(path.join(directory, "operator-note.txt"));
    await Bun.write(path.join(directory, "tracked.txt"), "operator commit\n");
    await runGit(["add", "tracked.txt"]);
    await runGit([
      "-c",
      "user.name=Test Operator",
      "-c",
      "user.email=operator@example.com",
      "commit",
      "-m",
      "test: concurrent operator commit",
    ]);
    armPublication();
    await expect(publishRestack({}, { observe: noopObserve })).rejects.toThrow(
      /HEAD changed before publication/,
    );
    expect(environment.published).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
