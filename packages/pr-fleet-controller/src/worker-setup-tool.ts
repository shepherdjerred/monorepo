import { tool as defineTool } from "ai";
import { z } from "zod";
import { workerCommandEnvironment } from "./command-environment.ts";
import {
  invalidateInheritedWipInspection,
  requireCurrentInheritedWipInspection,
} from "./inherited-wip.ts";
import type { FleetEnvironment } from "./ports.ts";
import {
  classifyFleetFailure,
  type ProgressEventKind,
} from "./progress-events.ts";
import type { PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

export const SETUP_COMMANDS = [
  { executable: "mise", args: ["trust", "--yes", ".mise.toml"] },
  { executable: "mise", args: ["install", "--dry-run-code"] },
  { executable: "bun", args: ["install", "--frozen-lockfile"] },
  {
    executable: "bunx",
    args: ["turbo", "run", "generate", "--env-mode=loose"],
  },
] satisfies { executable: string; args: string[] }[];

const MAX_SETUP_COMMAND_OUTPUT_BYTES = 100_000;

export function createSetupWorktreeTool(options: {
  pr: PrState;
  store: FleetStore;
  environment: FleetEnvironment;
  worktree: string;
  signal: AbortSignal;
  assertNotWaitingForAnswer: () => void;
  record: <T>(
    tool: string,
    input: unknown,
    run: () => Promise<T>,
  ) => Promise<T>;
  recordProgress: (
    kind: ProgressEventKind,
    payload: Record<string, unknown>,
  ) => void;
}) {
  const {
    pr,
    store,
    environment,
    worktree,
    signal,
    assertNotWaitingForAnswer,
    record,
    recordProgress,
  } = options;
  return defineTool({
    description:
      "Trust the assigned repository Mise configuration, then run dependency installation and code generation serially in the assigned worktree.",
    inputSchema: z.object({}),
    outputSchema: z.object({ commands: z.array(z.string()) }),
    execute: (input) =>
      record("setup_worktree", input, async () => {
        assertNotWaitingForAnswer();
        const headSha = pr.identity.headSha;
        if (store.setupWorktrees.get(worktree) === headSha) {
          return { commands: ["already complete"] };
        }
        const stackWriteLease = store.requestLeaseDecision(pr, "stack-write");
        if (!stackWriteLease.granted) {
          recordProgress("lease.denied", {
            kind: "stack-write",
            reason: stackWriteLease.reason,
          });
          throw new Error("Stack write lease is not available for setup");
        }
        recordProgress("lease.granted", { kind: "stack-write" });
        const setupLease = store.requestLeaseDecision(pr, "setup");
        if (!setupLease.granted) {
          recordProgress("lease.denied", {
            kind: "setup",
            reason: setupLease.reason,
          });
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
          throw new Error("Setup lease is not available");
        }
        recordProgress("lease.granted", { kind: "setup" });
        const heavyLease = store.requestLeaseDecision(pr, "heavy");
        if (!heavyLease.granted) {
          recordProgress("lease.denied", {
            kind: "heavy",
            reason: heavyLease.reason,
          });
          for (const kind of ["stack-write", "setup"] as const) {
            const durationMs = store.releaseLease(
              pr.identity.number,
              kind,
              pr.stackId,
            );
            if (durationMs !== null) {
              recordProgress("lease.released", { kind, durationMs });
            }
          }
          throw new Error("Heavy lease is not available for generation");
        }
        recordProgress("lease.granted", { kind: "heavy" });
        const completed: string[] = [];
        recordProgress("setup.started", { headSha });
        try {
          await requireCurrentInheritedWipInspection({
            store,
            pr,
            environment,
            worktree,
            signal,
          });
          invalidateInheritedWipInspection({ store, pr });
          for (const command of SETUP_COMMANDS) {
            const result = await environment.runLocalCommand({
              executable: command.executable,
              args: command.args,
              cwd: worktree,
              timeoutMs: 900_000,
              signal,
              env: workerCommandEnvironment(),
              sensitiveOutput: true,
              maxOutputBytes: MAX_SETUP_COMMAND_OUTPUT_BYTES,
            });
            if (result.exitCode !== 0) {
              const detail =
                result.stderr.trim() ||
                result.stdout.trim() ||
                "no diagnostic output";
              throw new Error(`${command.executable} failed: ${detail}`);
            }
            completed.push([command.executable, ...command.args].join(" "));
          }
          store.setupWorktrees.set(worktree, headSha);
          for (const [number, state] of store.prs) {
            if (
              state.worktree === worktree &&
              state.identity.headSha === headSha
            ) {
              store.prs.set(number, { ...state, setupComplete: true });
            }
          }
          recordProgress("setup.completed", {
            headSha,
            commandCount: completed.length,
          });
          return { commands: completed };
        } catch (error) {
          recordProgress("setup.failed", {
            headSha,
            failureClass: classifyFleetFailure(error),
          });
          throw error;
        } finally {
          for (const kind of ["stack-write", "heavy", "setup"] as const) {
            const durationMs = store.releaseLease(
              pr.identity.number,
              kind,
              pr.stackId,
            );
            if (durationMs !== null) {
              recordProgress("lease.released", { kind, durationMs });
            }
          }
        }
      }),
  });
}
