import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandExecResult, CommandRunner } from "./types.ts";

/** Namespace for work saved from a worktree before it is removed. */
const RESCUE_REF_PREFIX = "refs/tend/rescue";

export type RescueResult =
  | { readonly ok: true; readonly ref: string; readonly commit: string }
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

/**
 * Point a new rescue ref at `commit`. The ref must not exist yet: two
 * worktrees that share a basename and a second never overwrite each other.
 */
export async function writeRescueRef(options: {
  readonly cwd: string;
  readonly ref: string;
  readonly commit: string;
  readonly runner: CommandRunner;
}): Promise<RescueResult> {
  const res = await options.runner(
    [
      "git",
      "update-ref",
      "-m",
      "toolkit tend rescue",
      options.ref,
      options.commit,
      "",
    ],
    { cwd: options.cwd, timeoutMs: 10_000 },
  );
  return res.exitCode === 0
    ? { ok: true, ref: options.ref, commit: options.commit }
    : { ok: false, detail: failureDetail("git update-ref", res) };
}

/**
 * A gitlink the snapshot would record without the files behind it: `git add`
 * stores an untracked nested repository as a bare commit pointer.
 * Input is `git diff-index --raw -z`: `:<modes> <shas> <status>`, NUL, path.
 */
function findUnpreservableGitlink(diffIndexStdout: string): string | null {
  const tokens = diffIndexStdout.split("\0");
  for (let idx = 0; idx + 1 < tokens.length; idx += 2) {
    const fields = (tokens[idx] ?? "").replace(/^:/u, "").split(" ");
    if (fields[1] === "160000" && fields[2] !== fields[3]) {
      return tokens[idx + 1] ?? "(unknown path)";
    }
  }
  return null;
}

type SnapshotStep =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly detail: string };

/**
 * Commit a dirty worktree's tracked changes and untracked, non-ignored files
 * to a rescue ref whose parent is HEAD.
 *
 * The worktree's own index is never touched: staging happens in a temporary
 * copy named by `GIT_INDEX_FILE`. Any failure leaves the worktree as it was
 * and is reported, so the caller keeps the worktree.
 */
export async function snapshotDirtyWorktree(options: {
  readonly wtPath: string;
  readonly gitDir: string;
  readonly ref: string;
  readonly runner: CommandRunner;
  readonly nowMs: number;
}): Promise<RescueResult> {
  const { wtPath, runner } = options;
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
  const run = async (
    step: string,
    argv: readonly string[],
    timeoutMs: number,
  ): Promise<SnapshotStep> => {
    const res = await runner(["git", "-c", "core.fsmonitor=false", ...argv], {
      cwd: wtPath,
      env: { ...RESCUE_IDENTITY_ENV, GIT_INDEX_FILE: indexFile },
      timeoutMs,
    });
    return res.exitCode === 0
      ? { ok: true, stdout: res.stdout }
      : { ok: false, detail: failureDetail(step, res) };
  };

  try {
    await copyFile(path.join(options.gitDir, "index"), indexFile);

    // Everything that is not ignored, into the temporary index only.
    const added = await run("git add", ["add", "-A"], 300_000);
    if (!added.ok) {
      return added;
    }
    const diff = await run(
      "git diff-index",
      ["diff-index", "--cached", "--raw", "--no-abbrev", "-z", "HEAD"],
      60_000,
    );
    if (!diff.ok) {
      return diff;
    }
    const gitlink = findUnpreservableGitlink(diff.stdout);
    if (gitlink !== null) {
      return {
        ok: false,
        detail: `embedded git repository at ${gitlink} cannot be saved in a snapshot`,
      };
    }
    const tree = await run("git write-tree", ["write-tree"], 60_000);
    if (!tree.ok) {
      return tree;
    }
    const message = `toolkit tend rescue: uncommitted work from ${wtPath} at ${new Date(options.nowMs).toISOString()}`;
    const commit = await run(
      "git commit-tree",
      ["commit-tree", tree.stdout.trim(), "-p", "HEAD", "-m", message],
      30_000,
    );
    if (!commit.ok) {
      return commit;
    }
    const commitSha = commit.stdout.trim();
    if (commitSha.length === 0) {
      return { ok: false, detail: "git commit-tree printed no commit" };
    }
    return await writeRescueRef({
      cwd: wtPath,
      ref: options.ref,
      commit: commitSha,
      runner,
    });
  } catch (error: unknown) {
    return {
      ok: false,
      detail: `temporary index: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}
