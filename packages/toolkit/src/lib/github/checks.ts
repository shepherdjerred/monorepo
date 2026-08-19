import { z } from "zod";
import { runGhCommand } from "./client.ts";
import { GitHubCheckSchema } from "./schemas.ts";
import type { GitHubCheck } from "./types.ts";

export async function getGitHubChecks(
  prNumber: number | string,
  repo?: string,
): Promise<GitHubCheck[]> {
  const result = await runGhCommand(
    ["pr", "checks", String(prNumber), "--json", "name,state,bucket,link"],
    z.array(GitHubCheckSchema),
    repo,
    [0, 8],
  );

  if (!result.success) {
    if (
      result.exitCode === 1 &&
      result.error?.toLowerCase().includes("no checks reported") === true
    ) {
      return [];
    }
    throw new Error(result.error ?? "gh pr checks failed");
  }
  return result.data ?? [];
}
