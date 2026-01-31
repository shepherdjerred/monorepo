import { getPullRequestForBranch } from "../../lib/github/pr.ts";
import { getCurrentBranch } from "../../lib/git/repo.ts";

export type DetectOptions = {
  repo?: string | undefined;
  json?: boolean | undefined;
}

export async function detectCommand(options: DetectOptions): Promise<void> {
  const currentBranch = await getCurrentBranch();

  if (!currentBranch) {
    console.error("Error: Not in a git repository or unable to get current branch");
    process.exit(1);
  }

  const pr = await getPullRequestForBranch(options.repo);

  if (!pr) {
    console.error(`No pull request found for branch: ${currentBranch}`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(pr, null, 2));
  } else {
    console.log(`PR #${String(pr.number)}: ${pr.title}`);
    console.log(`URL: ${pr.url}`);
    console.log(`Branch: ${pr.headRefName} -> ${pr.baseRefName}`);
    console.log(`State: ${pr.state}${pr.isDraft ? " (draft)" : ""}`);
  }
}
