import { randomUUID } from "node:crypto";

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

type MergeCheckContext = {
  readonly prNumber: number;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly cwd: string;
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

async function deleteTemporaryRefs(
  refs: readonly string[],
  cwd: string,
): Promise<void> {
  const deletions = await Promise.all(
    refs.map(async (ref) => ({
      ref,
      result: await runGit(["update-ref", "-d", ref], cwd),
    })),
  );
  for (const deletion of deletions) {
    assertGitSuccess(
      deletion.result,
      `Failed to delete temporary ref ${deletion.ref}`,
    );
  }
}

async function checkMergeConflictsWithRefs(
  context: MergeCheckContext,
): Promise<MergeCheckResult> {
  const { prNumber, baseBranch, headSha, baseRef, headRef, cwd } = context;
  const fetch = await runGit(
    [
      "fetch",
      "--atomic",
      "--no-tags",
      "--no-write-fetch-head",
      "origin",
      `+refs/heads/${baseBranch}:${baseRef}`,
      `+refs/pull/${String(prNumber)}/head:${headRef}`,
    ],
    cwd,
  );
  assertGitSuccess(
    fetch,
    `Failed to fetch origin/${baseBranch} and PR #${String(prNumber)} head`,
  );

  const fetchedHead = await runGit(["rev-parse", `${headRef}^{commit}`], cwd);
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

  const mergeTree = await runGit(
    ["merge-tree", "--write-tree", "--name-only", baseRef, headRef],
    cwd,
  );
  if (mergeTree.exitCode !== 0 && mergeTree.exitCode !== 1) {
    assertGitSuccess(mergeTree, "git merge-tree failed");
  }

  const ancestor = await runGit(
    ["merge-base", "--is-ancestor", baseRef, headRef],
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

export async function checkMergeConflicts(
  prNumber: number,
  baseBranch: string,
  headSha: string,
  cwd = process.cwd(),
): Promise<MergeCheckResult> {
  const refNamespace = `refs/toolkit/pr-health/${randomUUID()}`;
  const baseRef = `${refNamespace}/base`;
  const headRef = `${refNamespace}/head`;
  const temporaryRefs = [baseRef, headRef];

  let result: MergeCheckResult;
  try {
    result = await checkMergeConflictsWithRefs({
      prNumber,
      baseBranch,
      headSha,
      baseRef,
      headRef,
      cwd,
    });
  } catch (error) {
    try {
      await deleteTemporaryRefs(temporaryRefs, cwd);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Merge check and temporary ref cleanup both failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }

  await deleteTemporaryRefs(temporaryRefs, cwd);
  return result;
}
