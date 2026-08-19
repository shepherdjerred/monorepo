export type MergeCheckResult = {
  readonly hasConflicts: boolean;
  readonly conflictingFiles: readonly string[];
  readonly upToDate: boolean;
  readonly baseBranch: string;
  readonly headSha: string;
};

type GitResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

async function runGit(
  args: readonly string[],
  cwd: string,
): Promise<GitResult> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function assertGitSuccess(result: GitResult, description: string): void {
  if (result.exitCode === 0) {
    return;
  }
  const detail = result.stderr.trim();
  throw new Error(
    detail.length > 0
      ? `${description}: ${detail}`
      : `${description}: git exited ${String(result.exitCode)}`,
  );
}

function conflictingFilesFromMergeTree(output: string): string[] {
  const header = output.split("\n\n", 1)[0];
  if (header === undefined) {
    return [];
  }
  return header
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function checkMergeConflicts(
  prNumber: number,
  baseBranch: string,
  headSha: string,
  cwd = process.cwd(),
): Promise<MergeCheckResult> {
  const baseFetch = await runGit(
    [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`,
    ],
    cwd,
  );
  assertGitSuccess(baseFetch, `Failed to fetch origin/${baseBranch}`);

  const headFetch = await runGit(
    ["fetch", "--no-tags", "origin", `refs/pull/${String(prNumber)}/head`],
    cwd,
  );
  assertGitSuccess(headFetch, `Failed to fetch PR #${String(prNumber)} head`);

  const fetchedHead = await runGit(["rev-parse", "FETCH_HEAD"], cwd);
  assertGitSuccess(
    fetchedHead,
    `Failed to resolve fetched PR #${String(prNumber)} head`,
  );
  const fetchedHeadSha = fetchedHead.stdout.trim();
  if (fetchedHeadSha !== headSha) {
    throw new Error(
      `Fetched PR #${String(prNumber)} head ${fetchedHeadSha} does not match GitHub head ${headSha}`,
    );
  }

  const headObject = await runGit(
    ["cat-file", "-e", `${headSha}^{commit}`],
    cwd,
  );
  assertGitSuccess(headObject, `PR head ${headSha} is unavailable locally`);

  const mergeTree = await runGit(
    [
      "merge-tree",
      "--write-tree",
      "--name-only",
      `origin/${baseBranch}`,
      headSha,
    ],
    cwd,
  );
  if (mergeTree.exitCode !== 0 && mergeTree.exitCode !== 1) {
    assertGitSuccess(mergeTree, "git merge-tree failed");
  }

  const ancestor = await runGit(
    ["merge-base", "--is-ancestor", `origin/${baseBranch}`, headSha],
    cwd,
  );
  if (ancestor.exitCode !== 0 && ancestor.exitCode !== 1) {
    assertGitSuccess(ancestor, "git merge-base failed");
  }

  return {
    hasConflicts: mergeTree.exitCode === 1,
    conflictingFiles:
      mergeTree.exitCode === 1
        ? conflictingFilesFromMergeTree(mergeTree.stdout)
        : [],
    upToDate: ancestor.exitCode === 0,
    baseBranch,
    headSha,
  };
}
