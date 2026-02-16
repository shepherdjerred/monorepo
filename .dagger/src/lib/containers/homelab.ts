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
  const branchPrefix = options.branchPrefix ?? appName.replaceAll('/', "-");
  const branchName = `${branchPrefix}/${version}`;

  // Escape slashes in appName for sed
  const escapedAppName = appName.replaceAll('/', "\\/");

  const result = await getGitHubContainer()
    .withSecretVariable("GH_TOKEN", ghToken)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec(["gh", "auth", "setup-git"])
    .withExec(["git", "clone", "--branch=main", "https://github.com/shepherdjerred/homelab", "."])
    .withExec(["git", "fetch", "--depth=2"])
    .withExec(["git", "checkout", "main"])
    .withExec(["git", "pull", "origin", "main"])
    // Update version using sed
    .withExec([
      "sh",
      "-c",
      `sed -i 's/"shepherdjerred\\/${escapedAppName}": "[^"]*"/"shepherdjerred\\/${escapedAppName}": "${version}"/g' src/cdk8s/src/versions.ts`,
    ])
    .withExec(["git", "add", "."])
    .withExec(["git", "checkout", "-b", branchName])
    .withExec(["git", "commit", "-m", `chore: update ${appName} version to ${version}`])
    .withExec(["git", "push", "--set-upstream", "origin", branchName])
    .withExec([
      "gh",
      "pr",
      "create",
      "--title",
      `chore: update ${appName} version to ${version}`,
      "--body",
      `This PR updates the ${appName} version to ${version}`,
      "--base",
      "main",
      "--head",
      branchName,
    ])
    .withExec(["gh", "pr", "merge", "--auto", "--rebase"])
    .stdout();

  return `Updated ${appName} to ${version}: ${result}`;
}
