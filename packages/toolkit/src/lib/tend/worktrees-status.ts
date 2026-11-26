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
 */
export async function readWorktreeStatus(
  wtPath: string,
  runner: CommandRunner,
): Promise<WorktreeStatus> {
  const res = await runner(
    [
      "git",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "status",
      "--porcelain",
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
