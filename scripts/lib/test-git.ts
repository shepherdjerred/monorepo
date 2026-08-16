import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Environment that isolates a `git` subprocess from the machine running it.
 *
 * Tests that shell out to git otherwise inherit the developer's `~/.gitconfig`
 * and `/etc/gitconfig`, which makes them pass or fail based on personal
 * settings rather than the code under test. Real failures this prevents:
 * `commit.gpgsign=true` makes a seed commit prompt or fail, `core.hooksPath`
 * runs the operator's hooks inside a throwaway repo, and an `~/.gitignore`
 * that git cannot expand aborts `git status` outright — which is exactly how
 * a scout-season-refresh test failed only under turbo's stripped environment
 * on one machine while passing everywhere else.
 *
 * `HOME` is redirected as well as the config paths: git is not the only thing
 * that reads it, and pointing it at the sandbox keeps anything else a
 * subprocess consults out of the operator's real home.
 */
export function hermeticGitEnv(
  home: string,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    // Per-invocation config injected by a caller would survive into the child
    // and silently re-introduce host settings, so it is dropped rather than
    // copied over.
    if (
      key === "GIT_CONFIG_COUNT" ||
      key.startsWith("GIT_CONFIG_KEY_") ||
      key.startsWith("GIT_CONFIG_VALUE_")
    ) {
      continue;
    }
    env[key] = value;
  }
  env["HOME"] = home;
  env["GIT_CONFIG_GLOBAL"] = "/dev/null";
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  // Never let a test block waiting for credentials on a terminal CI has not got.
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_AUTHOR_NAME"] = "Test";
  env["GIT_AUTHOR_EMAIL"] = "test@example.com";
  env["GIT_COMMITTER_NAME"] = "Test";
  env["GIT_COMMITTER_EMAIL"] = "test@example.com";
  return env;
}

/**
 * Apply the hermetic git environment to THIS process, returning a restore
 * function for `afterAll`.
 *
 * Needed when the code under test spawns git itself: those children inherit
 * the test process's environment, so handing a clean env to the setup commands
 * alone still leaves the assertions running against the host's config. That is
 * precisely how `revertGeneratedAtOnlyChanges` failed — its own `runCommand`
 * inherited an `~/.gitignore` git could not expand, and `git status` aborted.
 */
export function applyHermeticGitEnv(home: string): () => void {
  const managed = [
    "HOME",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_TERMINAL_PROMPT",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ];
  const previous = new Map(managed.map((key) => [key, Bun.env[key]]));
  const hermetic = hermeticGitEnv(home);
  for (const key of managed) {
    const value = hermetic[key];
    if (value !== undefined) Bun.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      // Assigning `undefined` would set the literal string "undefined"; the
      // variable has to be removed to restore "was never set".
      if (value === undefined) Reflect.deleteProperty(Bun.env, key);
      else Bun.env[key] = value;
    }
  };
}

export type TempGitRepo = {
  /** Absolute path to the repository working tree. */
  directory: string;
  /** Environment to pass to every git subprocess for this repo. */
  env: Record<string, string | undefined>;
  /** Run one git command in the repo, returning stdout. Throws on failure. */
  git: (args: readonly string[]) => Promise<string>;
  /** Remove the repository. Safe to call twice. */
  cleanup: () => Promise<void>;
};

/**
 * An initialized git repository in a fresh temp directory, isolated from the
 * host's git configuration.
 *
 * Call `cleanup()` from `afterEach` rather than at the end of a test body: a
 * failing assertion aborts the body, and an in-body cleanup then leaks the
 * directory on exactly the runs you are most likely to repeat.
 */
export async function createTempGitRepo(
  prefix = "test-repo-",
): Promise<TempGitRepo> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const env = hermeticGitEnv(directory);
  const git = async (args: readonly string[]): Promise<string> => {
    const child = Bun.spawn(["git", ...args], {
      cwd: directory,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed (${String(exitCode)}): ${stderr.trim()}`,
      );
    }
    return stdout;
  };
  await git(["init", "--quiet", "--initial-branch", "main"]);
  return {
    directory,
    env,
    git,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
