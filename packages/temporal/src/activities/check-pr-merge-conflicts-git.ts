import { runCommand } from "./data-dragon-shell.ts";

/**
 * Parse the stdout of `git merge-tree --write-tree --merge-base=... main pr`
 * into the unique set of conflicted paths. Conflict stage lines have the
 * shape `<mode> <oid> [123]\t<path>` (stages 1/2/3 = base/ours/theirs); the
 * leading tree OID and trailing `Auto-merging` / `CONFLICT (content):` lines
 * are ignored.
 */
export function parseConflictPaths(stdout: string): string[] {
  const set = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = /^[0-7]+ [0-9a-f]+ [123]\t(.+)$/.exec(line);
    if (match?.[1] !== undefined) {
      set.add(match[1]);
    }
  }
  return [...set].toSorted();
}

/**
 * Same GIT_ASKPASS pattern as `data-dragon.ts`: writes a tiny shell script
 * that emits the literal `x-access-token` as the git Username and `$GH_TOKEN`
 * as the password. The AGENTS.md rule bans putting `x-access-token` in URLs;
 * the askpass form is what that rule actually points toward.
 */
async function writeGitAskpass(tempDir: string): Promise<string> {
  const path = `${tempDir}/git-askpass.sh`;
  await Bun.write(
    path,
    [
      "#!/bin/sh",
      'case "$1" in',
      '  *Username*) echo "x-access-token" ;;',
      '  *) echo "$GH_TOKEN" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  await runCommand(["chmod", "+x", path], { cwd: tempDir });
  return path;
}

export async function defaultPrepareWorkDir(input: {
  token: string;
  owner: string;
  repo: string;
  prNumbers: number[];
}): Promise<{ workDir: string; cleanup: () => Promise<void> }> {
  const id = crypto.randomUUID();
  const workDir = `/tmp/pr-merge-conflict-${id}`;
  const askpassDir = `${workDir}-askpass`;
  await runCommand(["mkdir", "-p", askpassDir], { cwd: "/tmp" });
  const askpass = await writeGitAskpass(askpassDir);
  const gitEnv = {
    GH_TOKEN: input.token,
    GIT_ASKPASS: askpass,
    GIT_TERMINAL_PROMPT: "0",
  };
  const cloneUrl = `https://github.com/${input.owner}/${input.repo}.git`;
  // Wrap the clone + fetch in try/catch so a failure cleans up `askpassDir`
  // (and any partially-cloned `workDir`) instead of leaking them into /tmp
  // for the lifetime of the pod. On success the returned `cleanup` closure
  // covers both dirs; on failure the caller never sees a closure, so we have
  // to do the cleanup here before re-throwing.
  try {
    await runCommand(
      [
        "git",
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        "--bare",
        cloneUrl,
        workDir,
      ],
      { cwd: "/tmp", env: gitEnv, redactOutput: true },
    );
    if (input.prNumbers.length > 0) {
      const refspecs = input.prNumbers.map(
        (n) => `refs/pull/${String(n)}/head:refs/pull/${String(n)}/head`,
      );
      // Refresh main alongside the PR heads — between the clone and the per-PR
      // merge-base/merge-tree calls a few seconds can pass, and we want to
      // compare against the freshest main this activity invocation saw.
      await runCommand(
        [
          "git",
          "fetch",
          "--filter=blob:none",
          "--no-tags",
          "origin",
          "refs/heads/main:refs/heads/main",
          ...refspecs,
        ],
        { cwd: workDir, env: gitEnv, redactOutput: true },
      );
    }
  } catch (error) {
    await Bun.$`rm -rf ${workDir} ${askpassDir}`.quiet();
    throw error;
  }
  return {
    workDir,
    cleanup: async () => {
      await Bun.$`rm -rf ${workDir} ${askpassDir}`.quiet();
    },
  };
}

export async function defaultRunMergeBase(
  workDir: string,
  prNumber: number,
): Promise<string> {
  return runCommand(
    [
      "git",
      "merge-base",
      "refs/heads/main",
      `refs/pull/${String(prNumber)}/head`,
    ],
    { cwd: workDir },
  );
}

export async function defaultRunMergeTree(
  workDir: string,
  mergeBase: string,
  prNumber: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // Cannot use runCommand here — git merge-tree exits 1 on conflict, which is
  // a legitimate answer rather than an error condition.
  const proc = Bun.spawn(
    [
      "git",
      "merge-tree",
      "--write-tree",
      `--merge-base=${mergeBase}`,
      "refs/heads/main",
      `refs/pull/${String(prNumber)}/head`,
    ],
    { cwd: workDir, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}
