import { realpath } from "node:fs/promises";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { validateWorkerCommand } from "./command-policy.ts";
import type { FleetEnvironment } from "./ports.ts";
import {
  sandboxProfile,
  sanitizedEnvironment,
  setupEnvironment,
  setupSandboxProfile,
  type SetupDirectories,
} from "./sandbox.ts";
import { LeaseKindSchema, PrStateSchema, type PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

export const SETUP_COMMANDS = [
  { executable: "mise", args: ["install"] },
  { executable: "bun", args: ["install", "--frozen-lockfile"] },
  { executable: "bunx", args: ["turbo", "run", "generate"] },
  { executable: "bunx", args: ["lefthook", "install"] },
] satisfies { executable: string; args: string[] }[];

async function containedPath(
  root: string,
  requestedPath: string,
): Promise<string> {
  if (
    path.isAbsolute(requestedPath) ||
    requestedPath.split("/").includes("..")
  ) {
    throw new Error(`Unsafe worktree path: ${requestedPath}`);
  }
  const canonicalRoot = await realpath(root);
  const absolute = path.resolve(canonicalRoot, requestedPath);
  const targetExists = await Bun.file(absolute).exists();
  const canonicalTarget = await realpath(
    targetExists ? absolute : path.dirname(absolute),
  );
  const fromRoot = path.relative(canonicalRoot, canonicalTarget);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new Error(`Path escapes assigned worktree: ${requestedPath}`);
  }
  return absolute;
}

// Resolve the git directories and outer checkout root that the setup sandbox
// profile needs. A linked worktree's git store lives outside the worktree tree,
// and the fleet worktrees are nested inside the checkout that turbo treats as
// the workspace root, so these must be discovered rather than assumed.
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

export function createWorkerTools(
  pr: PrState,
  store: FleetStore,
  environment: FleetEnvironment,
  options: {
    signal: AbortSignal;
    // Additional env-var names to scrub from validation/setup subprocesses
    // beyond the credential heuristic — the operator's `--api-key-env` name.
    extraSecretNames?: readonly string[];
  },
) {
  const { signal, extraSecretNames = [] } = options;
  if (pr.worktree === null) {
    throw new Error(
      `PR #${String(pr.identity.number)} has no assigned worktree`,
    );
  }
  const worktree = pr.worktree;

  return {
    get_pr_context: createTool({
      id: "get_pr_context",
      description:
        "Get the current normalized PR identity, evidence, and ownership.",
      inputSchema: z.object({}),
      outputSchema: PrStateSchema,
      execute: () => Promise.resolve(pr),
    }),
    read_file: createTool({
      id: "read_file",
      description: "Read a UTF-8 file beneath the assigned worktree.",
      inputSchema: z.object({ path: z.string().min(1) }),
      outputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path: requestedPath }) => {
        const absolute = await containedPath(worktree, requestedPath);
        return {
          path: requestedPath,
          content: await Bun.file(absolute).text(),
        };
      },
    }),
    grep_files: createTool({
      id: "grep_files",
      description: "Search text beneath the assigned worktree with ripgrep.",
      inputSchema: z.object({
        pattern: z.string().min(1),
        paths: z.array(z.string().min(1)).max(20).default(["."]),
      }),
      outputSchema: z.object({ output: z.string(), exitCode: z.number() }),
      execute: async ({ pattern, paths }) => {
        for (const requestedPath of paths) {
          await containedPath(worktree, requestedPath);
        }
        const result = await environment.runLocalCommand({
          executable: "rg",
          args: ["--max-count", "200", "--", pattern, ...paths],
          cwd: worktree,
          timeoutMs: 30_000,
        });
        return {
          output: result.stdout.slice(0, 50_000),
          exitCode: result.exitCode,
        };
      },
    }),
    git_status: createTool({
      id: "git_status",
      description: "Read porcelain Git status in the assigned worktree.",
      inputSchema: z.object({}),
      outputSchema: z.object({ output: z.string() }),
      execute: async () => {
        const result = await environment.runLocalCommand({
          executable: "git",
          args: ["status", "--short"],
          cwd: worktree,
          timeoutMs: 30_000,
        });
        return { output: result.stdout };
      },
    }),
    git_diff: createTool({
      id: "git_diff",
      description: "Read the bounded unstaged Git diff.",
      inputSchema: z.object({}),
      outputSchema: z.object({ output: z.string() }),
      execute: async () => {
        const result = await environment.runLocalCommand({
          executable: "git",
          args: ["diff", "--"],
          cwd: worktree,
          timeoutMs: 30_000,
        });
        return { output: result.stdout.slice(0, 100_000) };
      },
    }),
    apply_patch: createTool({
      id: "apply_patch",
      description:
        "Apply a unified patch whose paths are inside the assigned worktree.",
      inputSchema: z.object({ patch: z.string().min(1) }),
      outputSchema: z.object({ applied: z.boolean(), stderr: z.string() }),
      execute: async ({ patch }) => {
        if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
          throw new Error("Worker does not hold the stack write lease");
        }
        const paths = patch
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
        const subprocess = Bun.spawn(
          ["git", "apply", "--whitespace=error-all", "-"],
          {
            cwd: worktree,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            signal,
          },
        );
        await subprocess.stdin.write(patch);
        await subprocess.stdin.end();
        const [exitCode, stderr] = await Promise.all([
          subprocess.exited,
          new Response(subprocess.stderr).text(),
        ]);
        if (exitCode !== 0) {
          throw new Error(`Patch failed: ${stderr.trim()}`);
        }
        return { applied: true, stderr };
      },
    }),
    request_lease: createTool({
      id: "request_lease",
      description: "Request setup, heavy-command, or stack-write authority.",
      inputSchema: z.object({ kind: LeaseKindSchema }),
      outputSchema: z.object({ granted: z.boolean() }),
      execute: ({ kind }) =>
        Promise.resolve({ granted: store.requestLease(pr, kind) }),
    }),
    setup_worktree: createTool({
      id: "setup_worktree",
      description:
        "Run the controller-approved serial toolchain, dependency, generation, and hook setup.",
      inputSchema: z.object({}),
      outputSchema: z.object({ commands: z.array(z.string()) }),
      execute: async () => {
        // Setup validity is tied to the checked-out head: a shared worktree that
        // moved to a sibling branch, or a PR with a new head, may have different
        // dependencies/generated artifacts. Only skip when setup already ran for
        // exactly this head.
        const headSha = pr.identity.headSha;
        if (store.setupWorktrees.get(worktree) === headSha) {
          return { commands: ["already complete"] };
        }
        if (!store.requestLease(pr, "setup")) {
          throw new Error("Setup lease is not available");
        }
        if (!store.requestLease(pr, "heavy")) {
          store.releaseLease(pr.identity.number, "setup", pr.stackId);
          throw new Error("Heavy lease is not available for generation");
        }
        const completed: string[] = [];
        try {
          // These commands execute PR-controlled code (dependency lifecycle
          // scripts, `turbo` generators, `.mise.toml`). The worker never
          // persists trust for PR-controlled configuration: setup grants the
          // exact worktree config invocation-scoped trust in paranoid mode.
          // Run each command under the setup sandbox profile with scrubbed
          // credentials so a malicious PR cannot read or exfiltrate operator
          // credentials before validation.
          const directories = await resolveSetupDirectories(
            worktree,
            environment,
            signal,
          );
          const profile = setupSandboxProfile(worktree, directories);
          const commandEnvironment = setupEnvironment(
            extraSecretNames,
            path.join(worktree, ".mise.toml"),
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
          store.setupWorktrees.set(worktree, headSha);
          // Mark setup complete only for PRs sharing this worktree AT this head;
          // a sibling on a different head still needs its own setup pass.
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
          store.releaseLease(pr.identity.number, "heavy", pr.stackId);
          store.releaseLease(pr.identity.number, "setup", pr.stackId);
        }
      },
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
      execute: async () => {
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
      },
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
      execute: async ({ paths }) => {
        if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
          throw new Error("Worker does not hold the stack write lease");
        }
        const result = await environment.continueRestack(pr, paths, signal);
        const output = `${result.stdout}\n${result.stderr}`.trim();
        if (result.exitCode !== 0 && !/conflict/i.test(output)) {
          throw new Error(`git-spice rebase continue failed: ${output}`);
        }
        return { completed: result.exitCode === 0, output };
      },
    }),
    publish_restack: createTool({
      id: "publish_restack",
      description:
        "Publish a completed restack and request one current-head hosted review.",
      inputSchema: z.object({}),
      outputSchema: z.object({ headSha: z.string() }),
      execute: async () => {
        if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
          throw new Error("Worker does not hold the stack write lease");
        }
        try {
          return await environment.publishRestack(pr, signal);
        } finally {
          store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
        }
      },
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
      }),
      execute: async ({ executable, args, timeoutMs }) => {
        validateWorkerCommand(executable, args);
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
            args: ["-p", sandboxProfile(worktree), executable, ...args],
            cwd: worktree,
            timeoutMs,
            signal,
            env: sanitizedEnvironment(extraSecretNames),
          });
          return {
            exitCode: result.exitCode,
            stdout: result.stdout.slice(0, 100_000),
            stderr: result.stderr.slice(0, 100_000),
          };
        } finally {
          store.releaseLease(pr.identity.number, "heavy", pr.stackId);
        }
      },
    }),
    publish_fix: createTool({
      id: "publish_fix",
      description:
        "Publish explicit changed paths through hooks and git-spice.",
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(100),
        message: z.string().regex(/^[a-z]+\\([a-z0-9-]+\\): .+/),
      }),
      outputSchema: z.object({ headSha: z.string() }),
      execute: async ({ paths, message }) => {
        if (!store.requestLease(pr, "stack-write")) {
          throw new Error("Stack write lease is not available");
        }
        try {
          return await environment.publishFix(pr, paths, message, signal);
        } finally {
          store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
        }
      },
    }),
  };
}
