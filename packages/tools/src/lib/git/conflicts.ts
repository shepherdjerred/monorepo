import { $ } from "bun";
import { getDefaultBranch } from "./repo.ts";

export type ConflictCheckResult = {
  hasConflicts: boolean;
  conflictingFiles: string[];
  baseBranch: string;
};

export async function checkMergeConflicts(
  baseBranch?: string,
): Promise<ConflictCheckResult> {
  const targetBranch = baseBranch ?? (await getDefaultBranch());

  try {
    // Fetch the latest from origin
    await $`git fetch origin ${targetBranch}`.quiet();

    // Try a merge --no-commit --no-ff to check for conflicts
    // This won't actually merge, just check
    try {
      await $`git merge-tree $(git merge-base HEAD origin/${targetBranch}) HEAD origin/${targetBranch}`.quiet();

      // If merge-tree succeeds without conflicts, check for actual conflict markers
      const result =
        await $`git merge-tree $(git merge-base HEAD origin/${targetBranch}) HEAD origin/${targetBranch}`.quiet();
      const output = result.stdout.toString();

      // Look for conflict markers in the output
      const conflictMatches = output.match(/^<<<<<<< /gm);
      if (conflictMatches != null && conflictMatches.length > 0) {
        // Extract conflicting file names
        const fileMatches = output.match(/^(?:\+\+\+|---) [ab]\/.+$/gm);
        const files = new Set<string>();
        if (fileMatches != null) {
          for (const match of fileMatches) {
            const fileMatch = /^(?:\+\+\+|---) [ab]\/(.+)$/.exec(match);
            if (fileMatch?.[1] != null && fileMatch[1].length > 0) {
              files.add(fileMatch[1]);
            }
          }
        }

        return {
          hasConflicts: true,
          conflictingFiles: [...files],
          baseBranch: targetBranch,
        };
      }

      return {
        hasConflicts: false,
        conflictingFiles: [],
        baseBranch: targetBranch,
      };
    } catch {
      // merge-tree might fail or show conflicts
      return {
        hasConflicts: true,
        conflictingFiles: [],
        baseBranch: targetBranch,
      };
    }
  } catch (error) {
    // If fetch fails, we can't check
    console.error("Failed to check merge conflicts:", error);
    return {
      hasConflicts: false,
      conflictingFiles: [],
      baseBranch: targetBranch,
    };
  }
}

export async function getMergeBase(
  baseBranch?: string,
): Promise<string | null> {
  const targetBranch = baseBranch ?? (await getDefaultBranch());

  try {
    const result = await $`git merge-base HEAD origin/${targetBranch}`.quiet();
    return result.stdout.toString().trim();
  } catch {
    return null;
  }
}

export async function isBranchUpToDate(baseBranch?: string): Promise<boolean> {
  const targetBranch = baseBranch ?? (await getDefaultBranch());

  try {
    // Check if the base branch is an ancestor of our current HEAD
    await $`git merge-base --is-ancestor origin/${targetBranch} HEAD`.quiet();
    return true;
  } catch {
    return false;
  }
}
