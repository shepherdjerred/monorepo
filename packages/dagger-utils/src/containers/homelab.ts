import type { Secret } from "@dagger.io/dagger";
import { getGitHubContainer } from "./github";

export type UpdateHomelabVersionOptions = {
  /** GitHub token for authentication */
  ghToken: Secret;
  /** App name as it appears in versions.ts (e.g., "birmel", "scout-for-lol/beta") */
  appName: string;
  /** New version string */
  version: string;
  /** Optional: custom branch prefix (default: app name without slashes) */
  branchPrefix?: string;
};

/**
 * Updates an app version in homelab's versions.ts and creates an auto-merging PR.
 *
 * This handles the common pattern for scout, starlight, and birmel where:
 * 1. Clone homelab repo
 * 2. Update version in src/cdk8s/src/versions.ts using sed
 * 3. Create branch, commit, push
 * 4. Create PR and enable auto-merge
 *
 * @example
 * ```ts
 * await updateHomelabVersion({
 *   ghToken: dag.setSecret("gh-token", process.env.GH_TOKEN),
 *   appName: "birmel",
 *   version: "1.0.123",
 * });
 *
 * // For stage-based apps:
 * await updateHomelabVersion({
 *   ghToken,
 *   appName: "scout-for-lol/beta",
 *   version: "1.0.456",
 * });
 * ```
 */
export async function updateHomelabVersion(options: UpdateHomelabVersionOptions): Promise<string> {
  const { ghToken, appName, version } = options;
  const branchPrefix = options.branchPrefix ?? appName.replace(/\//g, "-");
  const branchName = `${branchPrefix}/${version}`;

  // Escape slashes in appName for sed
  const escapedAppName = appName.replace(/\//g, "\\/");

  const updateScript = `
set -e

# Update version using sed
sed -i 's/"shepherdjerred\\/${escapedAppName}": "[^"]*"/"shepherdjerred\\/${escapedAppName}": "${version}"/g' src/cdk8s/src/versions.ts

# Check if there are any changes
if git diff --quiet; then
  echo "✓ Version ${version} for ${appName} is already up to date in homelab"
  exit 0
fi

# Changes detected - proceed with commit and PR
git add .
git checkout -b "${branchName}"
git commit -m "chore: update ${appName} version to ${version}"
git push --set-upstream origin "${branchName}"

# Create PR with auto-merge
gh pr create \\
  --title "chore: update ${appName} version to ${version}" \\
  --body "This PR updates the ${appName} version to ${version}" \\
  --base main \\
  --head "${branchName}"

gh pr merge --auto --rebase

echo "✓ Created and auto-merged PR for ${appName} version ${version}"
`;

  const result = await getGitHubContainer()
    .withSecretVariable("GH_TOKEN", ghToken)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec(["gh", "auth", "setup-git"])
    .withExec(["git", "clone", "--branch=main", "https://github.com/shepherdjerred/homelab", "."])
    .withExec(["git", "fetch", "--depth=2"])
    .withExec(["git", "checkout", "main"])
    .withExec(["git", "pull", "origin", "main"])
    .withExec(["sh", "-c", updateScript])
    .stdout();

  return result;
}
