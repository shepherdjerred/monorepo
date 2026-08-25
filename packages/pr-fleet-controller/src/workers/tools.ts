import { tool as defineTool } from "ai";
import { z } from "zod";
import { currentCommandCorrelation } from "#runtime/command-correlation.ts";
import { captureTelemetryOperation } from "#runtime/telemetry.ts";
import {
  invalidateInheritedWipInspection,
  requireCurrentInheritedWipInspection,
  WorktreeHeadChangedError,
} from "./inherited-wip.ts";
import { workerCommandEnvironment } from "#runtime/command-environment.ts";
import type { FleetEnvironment, FleetTelemetry } from "#domain/ports.ts";
import {
  recordProgressEvent,
  type ProgressEventKind,
} from "#runtime/progress-events.ts";
import { runRecordedToolOperation } from "#runtime/recorded-tool.ts";
import type { RunEventCorrelation } from "#domain/run-events.ts";
import {
  LeaseKindSchema,
  PrStateSchema,
  type PrState,
} from "#domain/schemas.ts";
import type { FleetStore } from "#domain/state.ts";
import { containedPath, createFileEditTools } from "./file-edits.ts";
import { createWorkerRestackTools } from "./restack-tools.ts";
import { createSetupWorktreeTool } from "./setup-tool.ts";
import { createWorkerWipTools } from "./wip-tools.ts";

const MAX_WORKER_COMMAND_OUTPUT_BYTES = 100_000;

function resolveWorkerShell(): string {
  const configuredShell = Bun.env["SHELL"];
  if (configuredShell !== undefined) {
    const resolved = Bun.which(configuredShell);
    if (resolved !== null) {
      return resolved;
    }
  }
  const zsh = Bun.which("zsh");
  if (zsh === null) {
    throw new Error("A POSIX worker shell is required (SHELL or zsh)");
  }
  return zsh;
}

async function assertCurrentWorktreeHead(options: {
  environment: FleetEnvironment;
  pr: PrState;
  store: FleetStore;
  worktree: string;
  signal: AbortSignal;
}): Promise<void> {
  const result = await options.environment.runLocalCommand({
    executable: "git",
    args: ["rev-parse", "HEAD"],
    cwd: options.worktree,
    timeoutMs: 30_000,
    signal: options.signal,
    sensitiveOutput: true,
    maxOutputBytes: 128,
    env: workerCommandEnvironment(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`Could not read worktree HEAD: ${result.stderr.trim()}`);
  }
  const expected = options.store.expectedWorktreeHead(options.pr);
  if (expected === undefined || result.stdout.trim() !== expected) {
    throw new WorktreeHeadChangedError(
      "Worktree HEAD changed before publication; inspect again before publishing",
    );
  }
}

export const ConventionalCommitMessageSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\([a-z0-9][a-z0-9-]*\))?!?: \S.*$/);

async function runRecordedTool<T>(
  tool: string,
  input: unknown,
  context: {
    pr: PrState;
    telemetry: FleetTelemetry | undefined;
    parentCorrelation: () => RunEventCorrelation;
  },
  run: () => Promise<T>,
): Promise<T> {
  const { pr, telemetry } = context;
  if (telemetry === undefined) {
    return run();
  }
  const toolCallId = captureTelemetryOperation("tool correlation", () =>
    telemetry.newId("tool"),
  );
  const correlation = {
    ...context.parentCorrelation(),
    prNumber: pr.identity.number,
    headSha: pr.identity.headSha,
    generation: pr.agentGeneration,
    toolCallId,
  };
  return runRecordedToolOperation({ tool, input, telemetry, correlation, run });
}

export function createWorkerTools(
  pr: PrState,
  store: FleetStore,
  environment: FleetEnvironment,
  options: {
    signal: AbortSignal;
    telemetry?: FleetTelemetry;
    parentCorrelation?: () => RunEventCorrelation;
  },
) {
  const { signal, telemetry, parentCorrelation = () => ({}) } = options;
  if (pr.worktree === null) {
    throw new Error(
      `PR #${String(pr.identity.number)} has no assigned worktree`,
    );
  }
  const worktree = pr.worktree;
  const toolContext = { pr, telemetry, parentCorrelation };
  const recordProgress = (
    kind: ProgressEventKind,
    payload: Record<string, unknown>,
  ): void => {
    recordProgressEvent({
      telemetry,
      kind,
      payload,
      correlation: {
        ...currentCommandCorrelation(),
        ...parentCorrelation(),
        prNumber: pr.identity.number,
        headSha: pr.identity.headSha,
        generation: pr.agentGeneration,
      },
    });
  };
  const assertNotWaitingForAnswer = (): void => {
    if (store.operatorRequests.has(pr.identity.number)) {
      throw new Error(
        "PR is waiting for operator input; return waiting-for-answer now",
      );
    }
  };

  return {
    get_pr_context: defineTool({
      description:
        "Get the current normalized PR identity, evidence, and ownership.",
      inputSchema: z.object({}),
      outputSchema: PrStateSchema,
      execute: (input) =>
        runRecordedTool("get_pr_context", input, toolContext, () =>
          Promise.resolve(pr),
        ),
    }),
    ...createWorkerWipTools({
      pr,
      store,
      environment,
      worktree,
      signal,
      telemetry,
      parentCorrelation,
      record: (tool, input, run) =>
        runRecordedTool(tool, input, toolContext, run),
      recordProgress,
      assertNotWaitingForAnswer,
    }),
    read_file: defineTool({
      description: "Read a UTF-8 file beneath the assigned worktree.",
      inputSchema: z.object({ path: z.string().min(1) }),
      outputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: (input) =>
        runRecordedTool("read_file", input, toolContext, async () => {
          const absolute = await containedPath(worktree, input.path);
          return {
            path: input.path,
            content: await Bun.file(absolute).text(),
          };
        }),
    }),
    grep_files: defineTool({
      description: "Search text beneath the assigned worktree with ripgrep.",
      inputSchema: z.object({
        pattern: z.string().min(1),
        paths: z.array(z.string().min(1)).max(20).default(["."]),
      }),
      outputSchema: z.object({ output: z.string(), exitCode: z.number() }),
      execute: (input) =>
        runRecordedTool("grep_files", input, toolContext, async () => {
          for (const requestedPath of input.paths) {
            await containedPath(worktree, requestedPath);
          }
          const result = await environment.runLocalCommand({
            executable: "rg",
            args: ["--max-count", "200", "--", input.pattern, ...input.paths],
            cwd: worktree,
            timeoutMs: 30_000,
          });
          return {
            output: result.stdout.slice(0, 50_000),
            exitCode: result.exitCode,
          };
        }),
    }),
    git_status: defineTool({
      description: "Read porcelain Git status in the assigned worktree.",
      inputSchema: z.object({}),
      outputSchema: z.object({ output: z.string() }),
      execute: (input) =>
        runRecordedTool("git_status", input, toolContext, async () => {
          const result = await environment.runLocalCommand({
            executable: "git",
            args: ["status", "--short"],
            cwd: worktree,
            timeoutMs: 30_000,
          });
          return { output: result.stdout };
        }),
    }),
    git_diff: defineTool({
      description: "Read the bounded unstaged Git diff.",
      inputSchema: z.object({}),
      outputSchema: z.object({ output: z.string() }),
      execute: (input) =>
        runRecordedTool("git_diff", input, toolContext, async () => {
          const result = await environment.runLocalCommand({
            executable: "git",
            args: ["diff", "--"],
            cwd: worktree,
            timeoutMs: 30_000,
          });
          return { output: result.stdout.slice(0, 100_000) };
        }),
    }),
    apply_patch: defineTool({
      description:
        "Apply a unified patch whose paths are inside the assigned worktree.",
      inputSchema: z.object({ patch: z.string().min(1) }),
      outputSchema: z.object({ applied: z.boolean(), stderr: z.string() }),
      execute: (input) =>
        runRecordedTool("apply_patch", input, toolContext, async () => {
          assertNotWaitingForAnswer();
          if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
            throw new Error("Worker does not hold the stack write lease");
          }
          await requireCurrentInheritedWipInspection({
            store,
            pr,
            environment,
            worktree,
            signal,
          });
          const paths = input.patch
            .split("\n")
            .filter(
              (line) => line.startsWith("+++ b/") || line.startsWith("--- a/"),
            )
            .map((line) => line.slice(6))
            .filter((changedPath) => changedPath !== "/dev/null");
          if (paths.length === 0) {
            throw new Error("Patch has no explicit repository paths");
          }
          for (const changedPath of paths) {
            await containedPath(worktree, changedPath);
          }
          invalidateInheritedWipInspection({ store, pr });
          const result = await environment.runLocalCommand({
            executable: "git",
            args: ["apply", "--whitespace=error-all", "-"],
            cwd: worktree,
            timeoutMs: 30_000,
            signal,
            stdin: input.patch,
          });
          if (result.exitCode !== 0) {
            throw new Error(`Patch failed: ${result.stderr.trim()}`);
          }
          return { applied: true, stderr: result.stderr };
        }),
    }),
    // Reliable exact-match / full-file edit tools (see worker-file-edits.ts).
    ...createFileEditTools({
      worktree,
      store,
      pr,
      environment,
      signal,
      record: (tool, input, run) =>
        runRecordedTool(tool, input, toolContext, run),
    }),
    request_lease: defineTool({
      description: "Request setup, heavy-command, or stack-write authority.",
      inputSchema: z.object({ kind: LeaseKindSchema }),
      outputSchema: z.object({
        granted: z.boolean(),
        reason: z
          .enum(["setup-held", "heavy-capacity", "stack-write-held"])
          .nullable(),
      }),
      execute: (input) =>
        runRecordedTool("request_lease", input, toolContext, () => {
          assertNotWaitingForAnswer();
          const decision = store.requestLeaseDecision(pr, input.kind);
          if (decision.granted) {
            recordProgress("lease.granted", { kind: input.kind });
          } else {
            recordProgress("lease.denied", {
              kind: input.kind,
              reason: decision.reason,
            });
          }
          return Promise.resolve({
            granted: decision.granted,
            reason: decision.granted ? null : decision.reason,
          });
        }),
    }),
    setup_worktree: createSetupWorktreeTool({
      pr,
      store,
      environment,
      worktree,
      signal,
      assertNotWaitingForAnswer,
      record: (tool, input, run) =>
        runRecordedTool(tool, input, toolContext, run),
      recordProgress,
    }),
    ...createWorkerRestackTools({
      store,
      pr,
      environment,
      worktree,
      signal,
      assertNotWaitingForAnswer,
      record: (tool, input, run) =>
        runRecordedTool(tool, input, toolContext, run),
      recordProgress,
    }),
    run_local_command: defineTool({
      description:
        "Run any shell command in the assigned worktree with the operator's normal environment. Use this for builds, tests, diagnostics, toolchain commands, and PR repair work. The command is recorded with bounded output and can be cancelled with the worker.",
      inputSchema: z.object({
        command: z.string().min(1),
        timeoutMs: z.number().int().min(1000).max(900_000).default(120_000),
      }),
      outputSchema: z.object({
        exitCode: z.number(),
        stdout: z.string(),
        stderr: z.string(),
        termination: z.enum(["exit", "timeout", "abort"]),
      }),
      execute: (input) =>
        runRecordedTool("run_local_command", input, toolContext, async () => {
          assertNotWaitingForAnswer();
          if (store.setupWorktrees.get(worktree) !== pr.identity.headSha) {
            recordProgress("setup.required", {
              reason: "current-head-unprepared",
            });
            throw new Error(
              "Worktree setup must complete for the current head before validation; call setup_worktree before retrying this command",
            );
          }
          const heavyLease = store.requestLeaseDecision(pr, "heavy");
          if (!heavyLease.granted) {
            recordProgress("lease.denied", {
              kind: "heavy",
              reason: heavyLease.reason,
            });
            throw new Error("Heavy lease is not available");
          }
          try {
            recordProgress("lease.granted", { kind: "heavy" });
            const result = await environment.runLocalCommand({
              executable: resolveWorkerShell(),
              args: ["-c", input.command],
              cwd: worktree,
              timeoutMs: input.timeoutMs,
              signal,
              env: workerCommandEnvironment(),
              sensitiveOutput: true,
              maxOutputBytes: MAX_WORKER_COMMAND_OUTPUT_BYTES,
            });
            return {
              exitCode: result.exitCode,
              stdout: result.stdout.slice(0, 100_000),
              stderr: result.stderr.slice(0, 100_000),
              termination: result.termination,
            };
          } finally {
            const durationMs = store.releaseLease(
              pr.identity.number,
              "heavy",
              pr.stackId,
            );
            if (durationMs !== null) {
              recordProgress("lease.released", {
                kind: "heavy",
                durationMs,
              });
            }
          }
        }),
    }),
    publish_fix: defineTool({
      description:
        "Publish explicit changed paths through hooks and git-spice from an exact-head worktree. Use the inherited-commit tool first when local commits are ahead of the captured PR head.",
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(100),
        message: ConventionalCommitMessageSchema,
      }),
      outputSchema: z.object({ headSha: z.string() }),
      execute: (input) =>
        runRecordedTool("publish_fix", input, toolContext, async () => {
          assertNotWaitingForAnswer();
          const stackWriteLease = store.requestLeaseDecision(pr, "stack-write");
          if (!stackWriteLease.granted) {
            recordProgress("lease.denied", {
              kind: "stack-write",
              reason: stackWriteLease.reason,
            });
            throw new Error("Stack write lease is not available");
          }
          try {
            recordProgress("lease.granted", { kind: "stack-write" });
            await assertCurrentWorktreeHead({
              environment,
              pr,
              store,
              worktree,
              signal,
            });
            await requireCurrentInheritedWipInspection({
              store,
              pr,
              environment,
              worktree,
              signal,
            });
            const published = await environment.publishFix(
              pr,
              input.paths,
              input.message,
              signal,
            );
            store.recordControlledWorktreeHead(
              pr,
              published.headSha,
              "publication",
            );
            recordProgress("worktree.head.transition", {
              cause: "publication",
              localHeadSha: published.headSha,
            });
            return published;
          } finally {
            const durationMs = store.releaseLease(
              pr.identity.number,
              "stack-write",
              pr.stackId,
            );
            if (durationMs !== null) {
              recordProgress("lease.released", {
                kind: "stack-write",
                durationMs,
              });
            }
          }
        }),
    }),
  };
}
