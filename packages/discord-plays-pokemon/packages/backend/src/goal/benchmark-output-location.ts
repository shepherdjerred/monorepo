import path from "node:path";
import { realpath } from "node:fs/promises";

function pathIsInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function resolveProspectivePath(filePath: string): Promise<string> {
  let existingAncestor = path.resolve(filePath);
  const missingSegments: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(existingAncestor), ...missingSegments);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new Error(
        `benchmark output has no resolvable ancestor: ${filePath}`,
      );
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
}

export type BenchmarkGitWorktree = {
  root: string;
  label: string;
};

export function benchmarkGitWorktrees(
  targetGitRoot: string,
  runnerGitRoot: string,
): readonly BenchmarkGitWorktree[] {
  return [
    { root: targetGitRoot, label: "target implementation" },
    { root: runnerGitRoot, label: "benchmark runner" },
  ];
}

export async function requireBenchmarkPathOutsideGitWorktrees(
  worktrees: readonly BenchmarkGitWorktree[],
  candidatePath: string,
  candidateLabel: string,
): Promise<void> {
  const resolvedCandidate = await resolveProspectivePath(candidatePath);
  for (const worktree of worktrees) {
    const resolvedWorktree = await realpath(worktree.root);
    if (pathIsInside(resolvedWorktree, resolvedCandidate)) {
      throw new Error(
        `${candidateLabel} must be outside the ${worktree.label} Git worktree: ${candidatePath}`,
      );
    }
  }
}
