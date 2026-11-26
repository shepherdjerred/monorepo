import type { CommandRunner } from "./types.ts";

const WORKTREE_STATUS_TIMEOUT_MS = 60_000;

type WorktreeStatus =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty"; readonly paths: readonly string[] }
  | { readonly kind: "timeout"; readonly timeoutMs: number }
  | { readonly kind: "failed"; readonly detail: string };

/** Paths named by `git status --porcelain -z` (rename sources are skipped). */
export function parseStatusPorcelainZ(stdout: string): string[] {
  const paths: string[] = [];
  const tokens = stdout.split("\0");
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx] ?? "";
    if (token.length < 4) {
      continue;
    }
    paths.push(token.slice(3));
    const code = token.slice(0, 2);
    if (code.includes("R") || code.includes("C")) {
      idx += 1;
    }
  }
  return paths;
}

/**
 * Read-only status. `--no-optional-locks` keeps git from rewriting the index
 * (which would look like activity and contend with a live session), and
 * fsmonitor is off so inspecting an idle worktree never starts a daemon.
 *
 * `untrackedFiles` is always given, so that a user's own setting never
 * decides it:
 *
 * - `all` names every untracked file instead of only the directory that
 *   holds it. Editing a file does not move its directory's mtime, so without
 *   the files themselves recent work inside an old untracked directory would
 *   not count as activity. It costs git its untracked cache and a full walk.
 * - `no` reports changes to tracked files only and skips that walk, for a
 *   caller that never looks at untracked files.
 */
export async function readWorktreeStatus(
  wtPath: string,
  runner: CommandRunner,
  untrackedFiles: "all" | "no",
): Promise<WorktreeStatus> {
  const res = await runner(
    [
      "git",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "status",
      "--porcelain",
      `--untracked-files=${untrackedFiles}`,
      "-z",
    ],
    { cwd: wtPath, timeoutMs: WORKTREE_STATUS_TIMEOUT_MS },
  );
  if (res.timedOut === true) {
    return { kind: "timeout", timeoutMs: WORKTREE_STATUS_TIMEOUT_MS };
  }
  if (res.exitCode !== 0) {
    return {
      kind: "failed",
      detail: res.stderr.trim() || `exit ${String(res.exitCode)}`,
    };
  }
  const paths = parseStatusPorcelainZ(res.stdout);
  return paths.length === 0 ? { kind: "clean" } : { kind: "dirty", paths };
}
