import { realpath } from "node:fs/promises";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { FleetEnvironment } from "./ports.ts";
import { LeaseKindSchema, PrStateSchema, type PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

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

const ALLOWED_EXECUTABLES = new Set([
  "bun",
  "bunx",
  "cargo",
  "go",
  "helm",
  "mise",
  "rg",
  "swift",
  "tofu",
]);
const FORBIDDEN_ARGUMENT =
  /deploy|publish|release|apply|destroy|merge|close|approve|--fix|update-snapshot/i;
const ALLOWED_FIRST_ARGUMENTS = new Map<string, Set<string>>([
  ["bun", new Set(["run", "test"])],
  ["bunx", new Set(["eslint", "turbo"])],
  ["cargo", new Set(["check", "clippy", "fmt", "test"])],
  ["go", new Set(["test", "vet"])],
  ["helm", new Set(["lint", "template"])],
  ["mise", new Set(["exec"])],
  ["rg", new Set()],
  ["swift", new Set(["build", "test"])],
  ["tofu", new Set(["fmt", "plan", "validate"])],
]);

export function validateWorkerCommand(
  executable: string,
  args: string[],
): void {
  if (!ALLOWED_EXECUTABLES.has(executable)) {
    throw new Error(`Executable is not allowed: ${executable}`);
  }
  if (args.some((argument) => FORBIDDEN_ARGUMENT.test(argument))) {
    throw new Error(
      "Command requests an external mutation or publication action",
    );
  }
  const allowedFirstArguments = ALLOWED_FIRST_ARGUMENTS.get(executable);
  const firstArgument = args[0];
  if (
    allowedFirstArguments === undefined ||
    (allowedFirstArguments.size > 0 &&
      (firstArgument === undefined ||
        !allowedFirstArguments.has(firstArgument)))
  ) {
    throw new Error(`Command form is not allowed for ${executable}`);
  }
  if (
    executable === "bun" &&
    args[0] === "run" &&
    args[1] === "verify" &&
    !args.includes("--affected")
  ) {
    throw new Error("Repository-wide verification is not allowed");
  }
  if (
    executable === "bunx" &&
    args[0] === "turbo" &&
    args[1] === "run" &&
    !args.some((argument) => argument.startsWith("--filter="))
  ) {
    throw new Error("Turbo commands require an explicit package filter");
  }
}

function sandboxProfile(worktree: string): string {
  if (worktree.includes('"')) {
    throw new Error("Worktree path cannot contain a double quote");
  }
  return `(version 1)
(deny default)
(allow process*)
(allow sysctl-read)
(allow file-read*)
(allow file-write* (subpath "${worktree}"))
(allow file-write* (subpath "/private/tmp"))
(allow file-write* (subpath "/private/var/folders"))
(deny network*)`;
}

export function createWorkerTools(
  pr: PrState,
  store: FleetStore,
  environment: FleetEnvironment,
  signal: AbortSignal,
) {
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
        if (store.setupWorktrees.has(worktree)) {
          return { commands: ["already complete"] };
        }
        if (!store.requestLease(pr, "setup")) {
          throw new Error("Setup lease is not available");
        }
        if (!store.requestLease(pr, "heavy")) {
          store.releaseLease(pr.identity.number, "setup", pr.stackId);
          throw new Error("Heavy lease is not available for generation");
        }
        const commands: { executable: string; args: string[] }[] = [
          { executable: "mise", args: ["trust", "-y", "--all"] },
          { executable: "mise", args: ["install"] },
          { executable: "bun", args: ["install", "--frozen-lockfile"] },
          { executable: "bunx", args: ["turbo", "run", "generate"] },
          { executable: "bunx", args: ["lefthook", "install"] },
        ];
        const completed: string[] = [];
        try {
          for (const command of commands) {
            const result = await environment.runLocalCommand({
              ...command,
              cwd: worktree,
              timeoutMs: 900_000,
              signal,
            });
            if (result.exitCode !== 0) {
              throw new Error(
                `${command.executable} failed: ${result.stderr.trim()}`,
              );
            }
            completed.push([command.executable, ...command.args].join(" "));
          }
          store.setupWorktrees.add(worktree);
          for (const [number, state] of store.prs) {
            if (state.worktree === worktree) {
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
        const result = await environment.startRestack(pr);
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
        const result = await environment.continueRestack(pr, paths);
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
          return await environment.publishRestack(pr);
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
        if (!store.setupWorktrees.has(worktree)) {
          throw new Error("Worktree setup must complete before validation");
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
          return await environment.publishFix(pr, paths, message);
        } finally {
          store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
        }
      },
    }),
  };
}
