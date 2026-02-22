import type { Secret } from "@dagger.io/dagger";
import { getGitHubContainer } from "./lib-github.ts";

export type CommitVersionsBackOptions = {
  /** GitHub token for authentication */
  token: Secret;
  /** Map of version keys to version values (e.g. "shepherdjerred/birmel" -> "1.0.123") */
  versions: Record<string, string>;
};

/**
 * Updates versions.ts via a PR with auto-merge instead of pushing directly to main.
 *
 * Uses sed to update each version key in packages/homelab/src/cdk8s/src/versions.ts,
 * then creates a PR and enables auto-merge. This works with branch protection
 * rules that prevent direct pushes to main.
 *
 * @returns stdout from the git/gh operations (either "NO_CHANGES" or PR info)
 */
export async function commitVersionsBack(
  options: CommitVersionsBackOptions,
): Promise<string> {
  const branchName = `chore/update-versions-${String(Date.now())}`;

  let container = getGitHubContainer()
    .withSecretVariable("GH_TOKEN", options.token)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec(["gh", "auth", "setup-git"])
    .withExec([
      "git",
      "clone",
      "--branch=main",
      "--depth=1",
      "https://github.com/shepherdjerred/monorepo",
      ".",
    ]);

  for (const [key, ver] of Object.entries(options.versions)) {
    const escaped = key.replaceAll("/", String.raw`\/`);
    container = container.withExec([
      "sh",
      "-c",
      `sed -i 's/"${escaped}": "[^"]*"/"${escaped}": "${ver}"/g' packages/homelab/src/cdk8s/src/versions.ts`,
    ]);
  }

  return container
    .withExec([
      "sh",
      "-c",
      `git diff --quiet && echo "NO_CHANGES" || (` +
        `git checkout -b ${branchName} && ` +
        `git add packages/homelab/src/cdk8s/src/versions.ts && ` +
        `git commit -m "chore: update deployed image versions [skip ci]" && ` +
        `git push --set-upstream origin ${branchName} && ` +
        `gh pr create --title "chore: update deployed image versions" ` +
        `--body "Automated version update from CI pipeline. Updates image digests in versions.ts to match the latest published images." ` +
        `--label "automerge" && ` +
        `gh pr merge --auto --squash` +
        `)`,
    ])
    .stdout();
}
