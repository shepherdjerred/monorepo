import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  spawnPassthroughInvocation,
  type PassthroughInvocation,
} from "#lib/passthrough.ts";
import { effectiveCwd, isRebaseContinueCommand } from "./spice-args.ts";
import {
  gitExecutable,
  listWorktrees,
  readGitConfig,
  readSpiceBranches,
  readSpiceRebaseContinue,
  readSpiceRepoConfig,
  resolveGitDir,
  resolveGitToplevel,
  type SpiceBranchMetadata,
} from "./spice-state.ts";

export type RebaseContinueOptions = {
  readonly cwd?: string | undefined;
  readonly stdoutToStderr?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly stdin?: "inherit" | "ignore" | undefined;
};

type ActiveRebaseState =
  | { readonly inProgress: false }
  | { readonly inProgress: true; readonly branch: string | null };

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readActiveRebaseState(
  gitDir: string,
): Promise<ActiveRebaseState> {
  for (const dirName of ["rebase-merge", "rebase-apply"] as const) {
    const rebaseDir = path.join(gitDir, dirName);
    if (!(await pathExists(rebaseDir))) continue;
    try {
      const rawContent = await readFile(
        path.join(rebaseDir, "head-name"),
        "utf8",
      );
      const rawHead = rawContent.trim();
      const branch = rawHead.startsWith("refs/heads/")
        ? rawHead.slice("refs/heads/".length)
        : null;
      return {
        inProgress: true,
        branch: branch !== null && branch.length > 0 ? branch : null,
      };
    } catch {
      return { inProgress: true, branch: null };
    }
  }
  return { inProgress: false };
}

function stackRootOf(
  branch: string,
  branches: ReadonlyMap<string, SpiceBranchMetadata>,
  trunk: string,
): string | null {
  if (!branches.has(branch)) return null;
  let current = branch;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const meta = branches.get(current);
    const base = meta?.baseName;
    if (
      base === undefined ||
      base === "" ||
      base === trunk ||
      !branches.has(base)
    ) {
      return current;
    }
    current = base;
  }
  return current;
}

function areInSameStack(
  branchA: string,
  branchB: string,
  branches: ReadonlyMap<string, SpiceBranchMetadata>,
  trunk: string,
): boolean {
  if (branchA === branchB) return true;
  const rootA = stackRootOf(branchA, branches, trunk);
  const rootB = stackRootOf(branchB, branches, trunk);
  return rootA !== null && rootA === rootB;
}

function editFlagsFromArgs(args: readonly string[]): {
  readonly forceEdit: boolean;
  readonly forceNoEdit: boolean;
} {
  const boundary = args.indexOf("--");
  const head = boundary === -1 ? args : args.slice(0, boundary);
  let forceEdit = false;
  let forceNoEdit = false;
  for (const token of head) {
    if (token === "--edit" || token === "--edit=true") {
      forceEdit = true;
      forceNoEdit = false;
    } else if (token === "--no-edit" || token === "--edit=false") {
      forceNoEdit = true;
      forceEdit = false;
    }
  }
  return { forceEdit, forceNoEdit };
}

async function resolveRebaseContinueEnvironment(
  cwd: string,
  invocation: PassthroughInvocation,
): Promise<Record<string, string | undefined>> {
  const { forceEdit, forceNoEdit } = editFlagsFromArgs(invocation.args);
  const env: Record<string, string | undefined> = { ...invocation.env };
  delete env["OP_SERVICE_ACCOUNT_TOKEN"];

  if (!forceEdit) {
    const editSetting = await readGitConfig(
      cwd,
      "spice.rebaseContinue.edit",
      invocation.env,
    );
    if (forceNoEdit || editSetting?.toLowerCase() === "false") {
      env["GIT_EDITOR"] = "true";
    }
  }
  return env;
}

async function runGitRebaseContinue(
  cwd: string,
  invocation: PassthroughInvocation,
  options: RebaseContinueOptions,
): Promise<number> {
  const env = await resolveRebaseContinueEnvironment(cwd, invocation);
  const git = gitExecutable(invocation.env);
  const child = Bun.spawn([git, "-C", cwd, "rebase", "--continue"], {
    cwd,
    env,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    stdio: [
      options.stdin ?? "inherit",
      options.stdoutToStderr === true ? 2 : "inherit",
      "inherit",
    ],
  });
  return child.exited;
}

/**
 * Intercept `git-spice rebase continue` when `refs/spice/data:rebase-continue`
 * is missing or holds a continuation belonging to another worktree or another
 * stack (`AI-154`).
 */
export async function maybeHandleRebaseContinue(
  invocation: PassthroughInvocation,
  options: RebaseContinueOptions = {},
): Promise<number | null> {
  if (!isRebaseContinueCommand(invocation.args)) {
    return null;
  }

  const cwd = effectiveCwd(invocation.args, options.cwd ?? process.cwd());
  const gitDir = await resolveGitDir(cwd, invocation.env);
  if (gitDir === null) {
    return null;
  }

  const [
    rebaseState,
    continuations,
    worktrees,
    toplevel,
    branches,
    repoConfig,
  ] = await Promise.all([
    readActiveRebaseState(gitDir),
    readSpiceRebaseContinue(cwd, invocation.env),
    listWorktrees(cwd, invocation.env),
    resolveGitToplevel(cwd, invocation.env),
    readSpiceBranches(cwd, invocation.env),
    readSpiceRepoConfig(cwd, invocation.env),
  ]);

  const otherWorktreeBranches = new Set(
    worktrees
      .filter((wt) => toplevel === null || wt.realPath !== toplevel)
      .flatMap((wt) => (wt.branch === undefined ? [] : [wt.branch])),
  );

  const hasForeignWorktreeContinuation = continuations.some((entry) =>
    otherWorktreeBranches.has(entry.branch),
  );

  if (!rebaseState.inProgress) {
    return hasForeignWorktreeContinuation
      ? runGitRebaseContinue(cwd, invocation, options)
      : null;
  }

  const rebasedBranch = rebaseState.branch;
  const trunk = repoConfig?.trunk ?? "main";
  const hasUnrelatedStackContinuation =
    rebasedBranch === null ||
    continuations.some(
      (entry) => !areInSameStack(rebasedBranch, entry.branch, branches, trunk),
    );

  const shouldBypassSpiceQueue =
    continuations.length === 0 ||
    hasForeignWorktreeContinuation ||
    hasUnrelatedStackContinuation;

  if (!shouldBypassSpiceQueue) {
    const env = await resolveRebaseContinueEnvironment(cwd, invocation);
    return spawnPassthroughInvocation(
      { ...invocation, env },
      {
        cwd: options.cwd,
        stdoutToStderr: options.stdoutToStderr,
        signal: options.signal,
        stdin: options.stdin,
      },
    );
  }

  const rebaseExit = await runGitRebaseContinue(cwd, invocation, options);
  if (rebaseExit !== 0) {
    return rebaseExit;
  }

  return rebasedBranch !== null && branches.has(rebasedBranch)
    ? spawnPassthroughInvocation(
        {
          executable: invocation.executable,
          args: [
            "branch",
            "restack",
            "-C",
            cwd,
            "--no-prompt",
            "--branch",
            rebasedBranch,
          ],
          env: invocation.env,
        },
        {
          cwd,
          stdoutToStderr: options.stdoutToStderr,
          signal: options.signal,
          stdin: "ignore",
        },
      )
    : 0;
}
