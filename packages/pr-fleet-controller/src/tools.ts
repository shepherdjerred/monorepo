import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { validateWorkerCommand } from "./command-policy.ts";
import { captureTelemetryOperation } from "./controller-telemetry.ts";
import type { FleetEnvironment, FleetTelemetry } from "./ports.ts";
import { runRecordedToolOperation } from "./recorded-tool.ts";
import type { RunEventCorrelation } from "./run-events.ts";
import { sandboxProfile, sanitizedEnvironment } from "./sandbox.ts";
import { LeaseKindSchema, PrStateSchema, type PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";
import { containedPath, createFileEditTools } from "./worker-file-edits.ts";
import { createSetupWorktreeTool } from "./worker-setup-tool.ts";
import { createWorkerWipTools } from "./worker-wip-tools.ts";

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
    // Additional env-var names to scrub from validation/setup subprocesses
    // beyond the credential heuristic — the operator's `--api-key-env` name.
    extraSecretNames?: readonly string[];
    telemetry?: FleetTelemetry;
    parentCorrelation?: () => RunEventCorrelation;
  },
) {
  const {
    signal,
    extraSecretNames = [],
    telemetry,
    parentCorrelation = () => ({}),
  } = options;
  if (pr.worktree === null) {
    throw new Error(
      `PR #${String(pr.identity.number)} has no assigned worktree`,
    );
  }
  const worktree = pr.worktree;
  const toolContext = { pr, telemetry, parentCorrelation };
  const assertNotWaitingForAnswer = (): void => {
    if (store.operatorRequests.has(pr.identity.number)) {
      throw new Error(
        "PR is waiting for operator input; return waiting-for-answer now",
      );
    }
  };

  return {
    get_pr_context: createTool({
      id: "get_pr_context",
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
      assertNotWaitingForAnswer,
    }),
    read_file: createTool({
      id: "read_file",
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
    grep_files: createTool({
      id: "grep_files",
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
    git_status: createTool({
      id: "git_status",
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
    git_diff: createTool({
      id: "git_diff",
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
    apply_patch: createTool({
      id: "apply_patch",
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
    request_lease: createTool({
      id: "request_lease",
      description: "Request setup, heavy-command, or stack-write authority.",
      inputSchema: z.object({ kind: LeaseKindSchema }),
      outputSchema: z.object({ granted: z.boolean() }),
      execute: (input) =>
        runRecordedTool("request_lease", input, toolContext, () => {
          assertNotWaitingForAnswer();
          return Promise.resolve({
            granted: store.requestLease(pr, input.kind),
          });
        }),
    }),
    setup_worktree: createSetupWorktreeTool({
      pr,
      store,
      environment,
      worktree,
      signal,
      extraSecretNames,
      assertNotWaitingForAnswer,
      record: (tool, input, run) =>
        runRecordedTool(tool, input, toolContext, run),
    }),
    start_restack: createTool({
      id: "start_restack",
      description:
        "Start a git-spice branch restack while retaining the stack write lease.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        completed: z.boolean(),
        output: z.string(),
      }),
      execute: (input) =>
        runRecordedTool("start_restack", input, toolContext, async () => {
          assertNotWaitingForAnswer();
          if (!store.requestLease(pr, "stack-write")) {
            throw new Error("Stack write lease is not available");
          }
          const result = await environment.startRestack(pr, signal);
          const output = `${result.stdout}\n${result.stderr}`.trim();
          if (result.exitCode !== 0 && !/conflict/i.test(output)) {
            store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
            throw new Error(`git-spice restack failed: ${output}`);
          }
          return { completed: result.exitCode === 0, output };
        }),
    }),
    continue_restack: createTool({
      id: "continue_restack",
      description:
        "Stage explicit resolved conflict paths and continue the git-spice rebase.",
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(100),
      }),
      outputSchema: z.object({
        completed: z.boolean(),
        output: z.string(),
      }),
      execute: (input) =>
        runRecordedTool("continue_restack", input, toolContext, async () => {
          assertNotWaitingForAnswer();
          if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
            throw new Error("Worker does not hold the stack write lease");
          }
          const result = await environment.continueRestack(
            pr,
            input.paths,
            signal,
          );
          const output = `${result.stdout}\n${result.stderr}`.trim();
          if (result.exitCode !== 0 && !/conflict/i.test(output)) {
            throw new Error(`git-spice rebase continue failed: ${output}`);
          }
          return { completed: result.exitCode === 0, output };
        }),
    }),
    publish_restack: createTool({
      id: "publish_restack",
      description:
        "Publish a completed restack and request one current-head hosted review.",
      inputSchema: z.object({}),
      outputSchema: z.object({ headSha: z.string() }),
      execute: (input) =>
        runRecordedTool("publish_restack", input, toolContext, async () => {
          assertNotWaitingForAnswer();
          if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
            throw new Error("Worker does not hold the stack write lease");
          }
          try {
            return await environment.publishRestack(pr, signal);
          } finally {
            store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
          }
        }),
    }),
    run_local_command: createTool({
      id: "run_local_command",
      description:
        "Run an approved local build, test, lint, typecheck, generator, or search command.",
      inputSchema: z.object({
        executable: z.string().min(1),
        args: z.array(z.string()).max(100),
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
          validateWorkerCommand(input.executable, input.args);
          if (store.setupWorktrees.get(worktree) !== pr.identity.headSha) {
            throw new Error(
              "Worktree setup must complete for the current head before validation",
            );
          }
          if (!store.requestLease(pr, "heavy")) {
            throw new Error("Heavy lease is not available");
          }
          try {
            const result = await environment.runLocalCommand({
              executable: "sandbox-exec",
              args: [
                "-p",
                sandboxProfile(worktree),
                input.executable,
                ...input.args,
              ],
              cwd: worktree,
              timeoutMs: input.timeoutMs,
              signal,
              env: sanitizedEnvironment(extraSecretNames),
            });
            return {
              exitCode: result.exitCode,
              stdout: result.stdout.slice(0, 100_000),
              stderr: result.stderr.slice(0, 100_000),
              termination: result.termination,
            };
          } finally {
            store.releaseLease(pr.identity.number, "heavy", pr.stackId);
          }
        }),
    }),
    publish_fix: createTool({
      id: "publish_fix",
      description:
        "Publish explicit changed paths through hooks and git-spice.",
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(100),
        message: ConventionalCommitMessageSchema,
      }),
      outputSchema: z.object({ headSha: z.string() }),
      execute: (input) =>
        runRecordedTool("publish_fix", input, toolContext, async () => {
          assertNotWaitingForAnswer();
          if (!store.requestLease(pr, "stack-write")) {
            throw new Error("Stack write lease is not available");
          }
          try {
            return await environment.publishFix(
              pr,
              input.paths,
              input.message,
              signal,
            );
          } finally {
            store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
          }
        }),
    }),
  };
}
