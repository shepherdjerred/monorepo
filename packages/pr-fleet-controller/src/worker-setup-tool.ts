import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  recordAuthorizedWipState,
  requireCurrentInheritedWipInspection,
} from "./inherited-wip.ts";
import type { FleetEnvironment } from "./ports.ts";
import {
  setupEnvironment,
  setupSandboxProfile,
  type SetupDirectories,
} from "./sandbox.ts";
import type { PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

export const SETUP_COMMANDS = [
  { executable: "mise", args: ["install", "--dry-run-code"] },
  { executable: "bun", args: ["install", "--frozen-lockfile"] },
  // Turbo's default strict environment drops XDG_CACHE_HOME before invoking
  // package generators. The parent environment is already credential-scrubbed,
  // so loose propagation is required to preserve the invocation-scoped Prisma
  // engine cache (and remains bounded to that sanitized environment).
  {
    executable: "bunx",
    args: ["turbo", "run", "generate", "--env-mode=loose"],
  },
] satisfies { executable: string; args: string[] }[];

type RemoveScratchDirectory = (
  directory: string,
  options: { recursive: true; force: true },
) => Promise<void>;

export async function releaseSetupResources(options: {
  store: FleetStore;
  pr: PrState;
  miseScratchDirectory: string | undefined;
  setupFailed: boolean;
  removeScratchDirectory?: RemoveScratchDirectory;
}): Promise<void> {
  const {
    store,
    pr,
    miseScratchDirectory,
    setupFailed,
    removeScratchDirectory = rm,
  } = options;
  let cleanupFailed = false;
  let cleanupError: unknown;
  try {
    if (miseScratchDirectory !== undefined) {
      await removeScratchDirectory(miseScratchDirectory, {
        recursive: true,
        force: true,
      });
    }
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  } finally {
    store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
    store.releaseLease(pr.identity.number, "heavy", pr.stackId);
    store.releaseLease(pr.identity.number, "setup", pr.stackId);
  }
  if (cleanupFailed && !setupFailed) {
    throw cleanupError;
  }
}

async function resolveSetupDirectories(
  worktree: string,
  environment: FleetEnvironment,
  signal: AbortSignal,
): Promise<SetupDirectories> {
  const result = await environment.runLocalCommand({
    executable: "git",
    args: [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
      "--git-dir",
    ],
    cwd: worktree,
    timeoutMs: 30_000,
    signal,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to resolve git directories for setup: ${result.stderr.trim()}`,
    );
  }
  const [gitCommonDir, gitDir] = result.stdout.trim().split("\n");
  if (
    gitCommonDir === undefined ||
    gitDir === undefined ||
    gitCommonDir.length === 0 ||
    gitDir.length === 0
  ) {
    throw new Error(
      `Unexpected git directory output during setup: ${result.stdout.trim()}`,
    );
  }
  return { gitCommonDir, gitDir, checkoutRoot: path.dirname(gitCommonDir) };
}

export function createSetupWorktreeTool(options: {
  pr: PrState;
  store: FleetStore;
  environment: FleetEnvironment;
  worktree: string;
  signal: AbortSignal;
  extraSecretNames: readonly string[];
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
    extraSecretNames,
    assertNotWaitingForAnswer,
    record,
  } = options;
  return createTool({
    id: "setup_worktree",
    description:
      "Check that the pinned toolchain is already installed, then run controller-approved dependency and generation setup serially.",
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
        let miseScratchDirectory: string | undefined;
        let setupFailed = false;
        try {
          await requireCurrentInheritedWipInspection({
            store,
            pr,
            environment,
            worktree,
            signal,
          });
          const directories = await resolveSetupDirectories(
            worktree,
            environment,
            signal,
          );
          const profile = setupSandboxProfile(worktree, directories);
          miseScratchDirectory = await mkdtemp(
            path.join(tmpdir(), "pr-fleet-mise-"),
          );
          const commandEnvironment = setupEnvironment(
            extraSecretNames,
            path.join(worktree, ".mise.toml"),
            miseScratchDirectory,
          );
          for (const command of SETUP_COMMANDS) {
            const result = await environment.runLocalCommand({
              executable: "sandbox-exec",
              args: ["-p", profile, command.executable, ...command.args],
              cwd: worktree,
              timeoutMs: 900_000,
              signal,
              env: commandEnvironment,
            });
            if (result.exitCode !== 0) {
              throw new Error(
                `${command.executable} failed: ${result.stderr.trim()}`,
              );
            }
            completed.push([command.executable, ...command.args].join(" "));
          }
          await recordAuthorizedWipState({
            store,
            pr,
            environment,
            worktree,
            signal,
          });
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
        } catch (error) {
          setupFailed = true;
          throw error;
        } finally {
          await releaseSetupResources({
            store,
            pr,
            miseScratchDirectory,
            setupFailed,
          });
        }
      }),
  });
}
