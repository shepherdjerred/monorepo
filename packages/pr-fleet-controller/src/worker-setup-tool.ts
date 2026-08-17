import { tool as defineTool } from "ai";
import { z } from "zod";
import {
  invalidateInheritedWipInspection,
  requireCurrentInheritedWipInspection,
} from "./inherited-wip.ts";
import type { FleetEnvironment } from "./ports.ts";
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
}) {
  const {
    pr,
    store,
    environment,
    worktree,
    signal,
    assertNotWaitingForAnswer,
    record,
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
        if (!store.requestLease(pr, "stack-write")) {
          throw new Error("Stack write lease is not available for setup");
        }
        if (!store.requestLease(pr, "setup")) {
          store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
          throw new Error("Setup lease is not available");
        }
        if (!store.requestLease(pr, "heavy")) {
          store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
          store.releaseLease(pr.identity.number, "setup", pr.stackId);
          throw new Error("Heavy lease is not available for generation");
        }
        const completed: string[] = [];
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
          return { commands: completed };
        } finally {
          store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
          store.releaseLease(pr.identity.number, "heavy", pr.stackId);
          store.releaseLease(pr.identity.number, "setup", pr.stackId);
        }
      }),
  });
}
