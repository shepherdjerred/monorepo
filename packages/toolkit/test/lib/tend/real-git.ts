import { vi } from "vitest";
import { defaultCommandRunner } from "#lib/tend/process-probe.ts";
import type { CommandRunner } from "#lib/tend/types.ts";

/** Room for tests that create real repositories and worktrees. */
export const REAL_GIT_TIMEOUT_MS = 60_000;

/**
 * Real git, cut off from the developer's own configuration and from any git
 * context this process inherited. Run from a git hook, `GIT_INDEX_FILE`,
 * `GIT_DIR` and `GIT_WORK_TREE` would point the fixture's commands at the
 * caller's repository.
 */
const GIT_ENV: Readonly<Record<string, string | undefined>> = {
  GIT_INDEX_FILE: undefined,
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

/** Commands the fixtures really run; the rest of the host is left out. */
const REAL_COMMANDS = new Set([
  "git",
  "python3",
  "/usr/bin/stat",
  "/usr/bin/xattr",
  "/usr/sbin/lsof",
]);

/**
 * A runner for tests against real repositories. Herdr reports no terminals,
 * and anything else that looks at the host (`ps`, `tailscale`, `gh`) is not
 * installed as far as the code under test can tell.
 *
 * `inherited` stands in for variables the process itself was started with:
 * they sit underneath whatever the code under test passes.
 */
export function realGitRunner(
  inherited: Readonly<Record<string, string>> = {},
): CommandRunner {
  return (argv, options = {}) => {
    const command = argv[0] ?? "";
    if (command === "hc") {
      return Promise.resolve({
        exitCode: 0,
        stdout: '{"terminals":[]}',
        stderr: "",
      });
    }
    return REAL_COMMANDS.has(command)
      ? defaultCommandRunner(argv, {
          ...options,
          env: { ...GIT_ENV, ...inherited, ...options.env },
        })
      : Promise.resolve({ exitCode: 127, stdout: "", stderr: "" });
  };
}

/** `git(cwd, ...args)` through `runner`: trimmed stdout, or a thrown error. */
export function gitThrough(
  runner: CommandRunner,
): (cwd: string, ...args: string[]) => Promise<string> {
  return async (cwd, ...args) => {
    const res = await runner(["git", ...args], { cwd });
    if (res.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
    }
    return res.stdout.trim();
  };
}

/** Capture `console.log` until mocks are restored; call to read it back. */
export function captureLog(): () => string {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return () => lines.join("\n");
}
