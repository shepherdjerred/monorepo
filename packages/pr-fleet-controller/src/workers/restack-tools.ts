import { tool as defineTool } from "ai";
import { z } from "zod";
import {
  collectInheritedWipEvidence,
  invalidateInheritedWipInspection,
  requireCurrentInheritedWipInspection,
} from "./inherited-wip.ts";
import type { CommandResult, FleetEnvironment } from "#domain/ports.ts";
import type { ProgressEventKind } from "#runtime/progress-events.ts";
import type { PrState } from "#domain/schemas.ts";
import type { FleetStore } from "#domain/state.ts";

type RecordTool = <T>(
  tool: string,
  input: unknown,
  run: () => Promise<T>,
) => Promise<T>;

type RecordProgress = (
  kind: ProgressEventKind,
  payload: Record<string, unknown>,
) => void;

type RestackToolOptions = {
  store: FleetStore;
  pr: PrState;
  environment: FleetEnvironment;
  worktree: string;
  signal: AbortSignal;
  record: RecordTool;
  recordProgress?: RecordProgress;
  assertNotWaitingForAnswer: () => void;
};

async function captureLocalHead(
  options: RestackToolOptions,
  purpose: string,
): Promise<string> {
  const result = await options.environment.runLocalCommand({
    executable: "git",
    args: ["rev-parse", "HEAD"],
    cwd: options.worktree,
    timeoutMs: 30_000,
    signal: options.signal,
    maxOutputBytes: 1024,
  });
  if (result.exitCode !== 0 || result.stdoutTruncated === true) {
    throw new Error(`Failed to capture ${purpose} HEAD: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function recordActiveRestack(options: RestackToolOptions): Promise<void> {
  const expectedLocalHead = options.store.expectedWorktreeHead(options.pr);
  const localHeadSha = await captureLocalHead(options, "active restack");
  options.store.activeRestacks.set(options.pr.identity.number, {
    remoteHeadSha: options.pr.identity.headSha,
    localHeadSha,
  });
  options.store.recordControlledWorktreeHead(
    options.pr,
    localHeadSha,
    "restack",
  );
  if (expectedLocalHead !== localHeadSha) {
    options.recordProgress?.("worktree.head.transition", {
      cause: "restack",
      localHeadSha,
    });
  }
}

async function recordCompletedRestack(
  options: RestackToolOptions,
): Promise<void> {
  const expectedLocalHead = options.store.expectedWorktreeHead(options.pr);
  const localHeadSha = await captureLocalHead(options, "completed restack");
  options.store.completedRestacks.set(options.pr.identity.number, {
    remoteHeadSha: options.pr.identity.headSha,
    localHeadSha,
  });
  options.store.recordControlledWorktreeHead(
    options.pr,
    localHeadSha,
    "restack",
  );
  if (expectedLocalHead !== localHeadSha) {
    options.recordProgress?.("worktree.head.transition", {
      cause: "restack",
      localHeadSha,
    });
  }
}

function releaseStackWriteLease(options: RestackToolOptions): void {
  const durationMs = options.store.releaseLease(
    options.pr.identity.number,
    "stack-write",
    options.pr.stackId,
  );
  if (durationMs !== null) {
    options.recordProgress?.("lease.released", {
      kind: "stack-write",
      durationMs,
    });
  }
}

async function isRebaseInProgress(
  options: RestackToolOptions,
): Promise<boolean> {
  for (const controlDirectory of ["rebase-merge", "rebase-apply"]) {
    const pathResult = await options.environment.runLocalCommand({
      executable: "git",
      args: ["rev-parse", "--git-path", controlDirectory],
      cwd: options.worktree,
      timeoutMs: 30_000,
      signal: options.signal,
      maxOutputBytes: 1024,
    });
    if (pathResult.exitCode !== 0 || pathResult.stdoutTruncated === true) {
      throw new Error(
        `Failed to resolve ${controlDirectory} rebase control path: ${pathResult.stderr}`,
      );
    }
    const controlPath = pathResult.stdout.trim();
    if (controlPath.length === 0) {
      throw new Error(
        `Git returned an empty ${controlDirectory} rebase control path`,
      );
    }
    const directoryResult = await options.environment.runLocalCommand({
      executable: "test",
      args: ["-d", controlPath],
      cwd: options.worktree,
      timeoutMs: 30_000,
      signal: options.signal,
      maxOutputBytes: 1024,
    });
    if (directoryResult.exitCode === 0) return true;
    if (directoryResult.exitCode !== 1) {
      throw new Error(
        `Failed to inspect ${controlDirectory} rebase control state: ${directoryResult.stderr}`,
      );
    }
  }
  return false;
}

async function requireCurrentCompletedRestack(
  options: RestackToolOptions,
): Promise<void> {
  const expected = options.store.completedRestacks.get(
    options.pr.identity.number,
  );
  const live = await collectInheritedWipEvidence(options);
  if (
    options.store.activeRestacks.has(options.pr.identity.number) ||
    expected?.remoteHeadSha !== options.pr.identity.headSha ||
    expected.localHeadSha !== live.localHeadSha
  ) {
    throw new Error(
      "Completed restack HEAD changed before publication; inspect or restack again",
    );
  }
  if (
    live.hasWip ||
    !live.statusComplete ||
    !live.stagedDiffComplete ||
    !live.unstagedDiffComplete ||
    !live.untrackedPathsComplete
  ) {
    throw new Error(
      "Completed restack has changed or incomplete worktree evidence; inspect before publication",
    );
  }
}

export function createWorkerRestackTools(options: RestackToolOptions) {
  const { store, pr, environment, signal, record } = options;
  const recordProgress: RecordProgress = options.recordProgress ?? (() => null);
  return {
    start_restack: defineTool({
      description:
        "Start a git-spice branch restack while retaining the stack write lease.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        completed: z.boolean(),
        output: z.string(),
      }),
      execute: (input) =>
        record("start_restack", input, async () => {
          options.assertNotWaitingForAnswer();
          const stackWriteLease = store.requestLeaseDecision(pr, "stack-write");
          if (!stackWriteLease.granted) {
            recordProgress("lease.denied", {
              kind: "stack-write",
              reason: stackWriteLease.reason,
            });
            throw new Error("Stack write lease is not available");
          }
          recordProgress("lease.granted", { kind: "stack-write" });
          await requireCurrentInheritedWipInspection(options);
          invalidateInheritedWipInspection(options);
          store.completedRestacks.delete(pr.identity.number);
          await recordActiveRestack(options);
          let result: CommandResult;
          try {
            result = await environment.startRestack(pr, signal);
          } catch (error) {
            store.activeRestacks.delete(pr.identity.number);
            releaseStackWriteLease(options);
            throw error;
          }
          const output = `${result.stdout}\n${result.stderr}`.trim();
          if (await isRebaseInProgress(options)) {
            await recordActiveRestack(options);
            if (result.exitCode !== 0 && !/conflict/i.test(output)) {
              throw new Error(`git-spice restack failed: ${output}`);
            }
            return { completed: false, output };
          }
          store.activeRestacks.delete(pr.identity.number);
          if (result.exitCode !== 0) {
            releaseStackWriteLease(options);
            throw new Error(`git-spice restack failed: ${output}`);
          }
          await recordCompletedRestack(options);
          return { completed: true, output };
        }),
    }),
    continue_restack: defineTool({
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
        record("continue_restack", input, async () => {
          options.assertNotWaitingForAnswer();
          if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
            throw new Error("Worker does not hold the stack write lease");
          }
          await requireCurrentInheritedWipInspection(options);
          invalidateInheritedWipInspection(options);
          store.completedRestacks.delete(pr.identity.number);
          const result = await environment.continueRestack(
            pr,
            input.paths,
            signal,
          );
          const output = `${result.stdout}\n${result.stderr}`.trim();
          if (await isRebaseInProgress(options)) {
            await recordActiveRestack(options);
            if (result.exitCode !== 0 && !/conflict/i.test(output)) {
              throw new Error(`git-spice rebase continue failed: ${output}`);
            }
            return { completed: false, output };
          }
          store.activeRestacks.delete(pr.identity.number);
          if (result.exitCode !== 0) {
            throw new Error(`git-spice rebase continue failed: ${output}`);
          }
          await recordCompletedRestack(options);
          return { completed: true, output };
        }),
    }),
    publish_restack: defineTool({
      description:
        "Publish a completed restack and request one current-head hosted review.",
      inputSchema: z.object({}),
      outputSchema: z.object({ headSha: z.string() }),
      execute: (input) =>
        record("publish_restack", input, async () => {
          options.assertNotWaitingForAnswer();
          if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
            throw new Error("Worker does not hold the stack write lease");
          }
          try {
            await requireCurrentCompletedRestack(options);
            return await environment.publishRestack(pr, signal);
          } finally {
            store.completedRestacks.delete(pr.identity.number);
            releaseStackWriteLease(options);
          }
        }),
    }),
  };
}
