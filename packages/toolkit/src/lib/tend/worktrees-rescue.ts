import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandExecResult, CommandRunner } from "./types.ts";

/** Namespace for work saved from a worktree before it is removed. */
const RESCUE_REF_PREFIX = "refs/tend/rescue";

/** The two states of a dirty worktree, as git trees. */
export type SnapshotTrees = {
  /** What was staged: the worktree's own index, untouched. */
  readonly indexTree: string;
  /** What is on disk: tracked changes plus untracked, non-ignored files. */
  readonly workTree: string;
};

export type RescueResult =
  | {
      readonly ok: true;
      readonly ref: string;
      readonly commit: string;
      readonly trees?: SnapshotTrees | undefined;
    }
  | { readonly ok: false; readonly detail: string };

/**
 * Snapshot commits are authored by the reaper itself so that they do not
 * depend on a `user.name` being configured for an unattended launchd job.
 */
const RESCUE_IDENTITY_ENV = {
  GIT_AUTHOR_NAME: "toolkit tend",
  GIT_AUTHOR_EMAIL: "toolkit-tend@localhost",
  GIT_COMMITTER_NAME: "toolkit tend",
  GIT_COMMITTER_EMAIL: "toolkit-tend@localhost",
} as const;

function utcStamp(nowMs: number): string {
  return new Date(nowMs)
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replaceAll(/[-:]/gu, "");
}

/**
 * `refs/tend/rescue/<worktree-basename>-<UTC yyyymmddThhmmssZ>`. Characters a
 * ref name cannot carry (including dots, which rule out `..` and `.lock`)
 * become dashes.
 */
export function rescueRefName(wtPath: string, nowMs: number): string {
  const cleaned = path
    .basename(wtPath)
    .replaceAll(/[^\w-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  const name = cleaned.length === 0 ? "worktree" : cleaned;
  return `${RESCUE_REF_PREFIX}/${name}-${utcStamp(nowMs)}`;
}

function failureDetail(step: string, res: CommandExecResult): string {
  const reason =
    res.timedOut === true
      ? "timed out"
      : res.stderr.trim() || `exit ${String(res.exitCode)}`;
  return `${step}: ${reason}`;
}

type GitStep =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly detail: string };

async function gitStep(
  runner: CommandRunner,
  step: string,
  argv: readonly string[],
  options: {
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly indexFile?: string | undefined;
  },
): Promise<GitStep> {
  const res = await runner(["git", "-c", "core.fsmonitor=false", ...argv], {
    cwd: options.cwd,
    env: {
      ...RESCUE_IDENTITY_ENV,
      ...(options.indexFile === undefined
        ? {}
        : { GIT_INDEX_FILE: options.indexFile }),
    },
    timeoutMs: options.timeoutMs,
  });
  return res.exitCode === 0
    ? { ok: true, stdout: res.stdout }
    : { ok: false, detail: failureDetail(step, res) };
}

/**
 * Point a new rescue ref at `commit`. The ref must not exist yet: two
 * worktrees that share a basename and a second never overwrite each other.
 * The reaper's identity is passed because a ref update can write a reflog
 * entry, which needs one.
 */
export async function writeRescueRef(options: {
  readonly cwd: string;
  readonly ref: string;
  readonly commit: string;
  readonly runner: CommandRunner;
}): Promise<RescueResult> {
  const res = await gitStep(
    options.runner,
    "git update-ref",
    [
      "update-ref",
      "-m",
      "toolkit tend rescue",
      options.ref,
      options.commit,
      "",
    ],
    { cwd: options.cwd, timeoutMs: 10_000 },
  );
  return res.ok ? { ok: true, ref: options.ref, commit: options.commit } : res;
}

/**
 * The first gitlink in `git ls-files -s -z` output. A gitlink is a pointer to
 * a commit in another repository: a submodule, or a nested repository that
 * `git add` picked up. The files behind it are not in the snapshot, and a
 * forced removal would delete them.
 */
function findGitlink(lsFilesStdout: string): string | null {
  for (const line of lsFilesStdout.split("\0")) {
    if (line.startsWith("160000 ")) {
      return line.slice(line.indexOf("\t") + 1);
    }
  }
  return null;
}

type TreesResult =
  | ({ readonly ok: true } & SnapshotTrees)
  | { readonly ok: false; readonly detail: string };

async function removeScratchDir(scratchDir: string): Promise<void> {
  try {
    await rm(scratchDir, { recursive: true, force: true });
  } catch {
    // A temporary directory that cannot be removed does not change whether
    // the work was saved; the system clears it later.
  }
}

/**
 * Read a dirty worktree's staged state and working state as two trees.
 *
 * The worktree's own index is never touched: both trees come from a
 * temporary copy named by `GIT_INDEX_FILE`. The staged tree is written from
 * that copy before anything is added to it, because adding the working tree
 * replaces whatever was staged for the same path.
 */
export async function computeSnapshotTrees(options: {
  readonly wtPath: string;
  readonly gitDir: string;
  readonly runner: CommandRunner;
}): Promise<TreesResult> {
  let scratchDir: string;
  try {
    scratchDir = await mkdtemp(path.join(os.tmpdir(), "tend-rescue-"));
  } catch (error: unknown) {
    return {
      ok: false,
      detail: `temporary index: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const indexFile = path.join(scratchDir, "index");
  const run = (step: string, argv: readonly string[], timeoutMs: number) =>
    gitStep(options.runner, step, argv, {
      cwd: options.wtPath,
      timeoutMs,
      indexFile,
    });
  try {
    await copyFile(path.join(options.gitDir, "index"), indexFile);
    const staged = await run("git write-tree (staged)", ["write-tree"], 60_000);
    if (!staged.ok) {
      return staged;
    }
    // Everything that is not ignored, into the temporary index only.
    const added = await run("git add", ["add", "-A"], 300_000);
    if (!added.ok) {
      return added;
    }
    const listed = await run("git ls-files", ["ls-files", "-s", "-z"], 60_000);
    if (!listed.ok) {
      return listed;
    }
    const gitlink = findGitlink(listed.stdout);
    if (gitlink !== null) {
      return {
        ok: false,
        detail: `contains a submodule or nested git repository at ${gitlink}, whose files a snapshot cannot save`,
      };
    }
    const working = await run("git write-tree", ["write-tree"], 60_000);
    if (!working.ok) {
      return working;
    }
    const indexTree = staged.stdout.trim();
    const workTree = working.stdout.trim();
    return indexTree.length === 0 || workTree.length === 0
      ? { ok: false, detail: "git write-tree printed no tree" }
      : { ok: true, indexTree, workTree };
  } catch (error: unknown) {
    return {
      ok: false,
      detail: `temporary index: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await removeScratchDir(scratchDir);
  }
}

/**
 * Save a dirty worktree to a rescue ref as two commits on top of `head`:
 *
 *     head  <-  staged changes  <-  working tree   (the rescue ref)
 *
 * Keeping the staged state as its own commit matters when a file was staged
 * and then edited or restored: the working-tree commit alone would hold only
 * the later version, and removing the worktree deletes the index.
 *
 * Any failure leaves the worktree as it was and is reported, so the caller
 * keeps the worktree.
 */
export async function snapshotDirtyWorktree(options: {
  readonly wtPath: string;
  readonly gitDir: string;
  /** The commit the worktree is on, already confirmed as its current HEAD. */
  readonly head: string;
  readonly ref: string;
  readonly runner: CommandRunner;
  readonly nowMs: number;
}): Promise<RescueResult> {
  const { wtPath, runner } = options;
  const trees = await computeSnapshotTrees(options);
  if (!trees.ok) {
    return trees;
  }
  const stamp = `${wtPath} at ${new Date(options.nowMs).toISOString()}`;
  const commit = async (
    tree: string,
    parent: string,
    what: string,
  ): Promise<GitStep> => {
    const made = await gitStep(
      runner,
      "git commit-tree",
      [
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        `toolkit tend rescue: ${what} from ${stamp}`,
      ],
      { cwd: wtPath, timeoutMs: 30_000 },
    );
    return made.ok && made.stdout.trim().length === 0
      ? { ok: false, detail: "git commit-tree printed no commit" }
      : made;
  };
  const staged = await commit(trees.indexTree, options.head, "staged changes");
  if (!staged.ok) {
    return staged;
  }
  const working = await commit(
    trees.workTree,
    staged.stdout.trim(),
    "working tree",
  );
  if (!working.ok) {
    return working;
  }
  const published = await writeRescueRef({
    cwd: wtPath,
    ref: options.ref,
    commit: working.stdout.trim(),
    runner,
  });
  return published.ok
    ? {
        ...published,
        trees: { indexTree: trees.indexTree, workTree: trees.workTree },
      }
    : published;
}
