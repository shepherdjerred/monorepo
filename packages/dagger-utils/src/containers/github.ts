import { dag, type Container, type Secret } from "@dagger.io/dagger";
import versions from "../versions";

export type GitHubContainerOptions = {
  /** Git user name for commits */
  userName?: string;
  /** Git user email for commits */
  userEmail?: string;
  /** GitHub CLI version (default: latest from versions) */
  ghVersion?: string;
};

/**
 * Returns a container with GitHub CLI (gh) and git installed.
 * Useful for creating PRs, managing releases, and other GitHub operations.
 *
 * @param options - Configuration options for the container
 * @returns A configured container with gh CLI
 *
 * @example
 * ```ts
 * const container = getGitHubContainer({
 *   userName: "my-bot",
 *   userEmail: "bot@example.com",
 * })
 *   .withSecretVariable("GH_TOKEN", ghToken)
 *   .withExec(["gh", "pr", "create", "--title", "My PR"]);
 * ```
 */
export function getGitHubContainer(options: GitHubContainerOptions = {}): Container {
  const { userName = "dagger-bot", userEmail = "dagger@localhost", ghVersion = "2.63.2" } = options;

  return dag
    .container()
    .from(`ubuntu:${versions.ubuntu}`)
    .withExec(["apt", "update"])
    .withExec(["apt", "install", "-y", "git", "curl"])
    .withExec([
      "sh",
      "-c",
      `curl -L -o ghcli.deb https://github.com/cli/cli/releases/download/v${ghVersion}/gh_${ghVersion}_linux_amd64.deb`,
    ])
    .withExec(["dpkg", "-i", "ghcli.deb"])
    .withExec(["rm", "ghcli.deb"])
    .withExec(["git", "config", "--global", "user.name", userName])
    .withExec(["git", "config", "--global", "user.email", userEmail])
    .withWorkdir("/workspace");
}

export type CreatePullRequestOptions = {
  /** GitHub token for authentication */
  ghToken: Secret;
  /** Repository to clone (e.g., "owner/repo") */
  repository: string;
  /** Base branch to merge into */
  baseBranch?: string;
  /** New branch name for the PR */
  newBranch: string;
  /** PR title */
  title: string;
  /** PR body/description */
  body: string;
  /** Files to modify: path -> content mapping */
  fileChanges: Record<string, string>;
  /** Commit message */
  commitMessage: string;
  /** Auto-merge the PR after creation */
  autoMerge?: boolean;
  /** Git user configuration */
  git?: GitHubContainerOptions;
};

/**
 * Creates a GitHub PR with the specified file changes.
 * Useful for automated version bumps, config updates, etc.
 *
 * @param options - PR creation options
 * @returns The PR URL or output from gh CLI
 *
 * @example
 * ```ts
 * const prUrl = await createPullRequest({
 *   ghToken: dag.setSecret("gh-token", process.env.GH_TOKEN),
 *   repository: "owner/repo",
 *   newBranch: "update-version",
 *   title: "chore: update version to 1.2.3",
 *   body: "Automated version update",
 *   fileChanges: { "version.txt": "1.2.3" },
 *   commitMessage: "chore: update version to 1.2.3",
 *   autoMerge: true,
 * });
 * ```
 */
export async function createPullRequest(options: CreatePullRequestOptions): Promise<string> {
  const { baseBranch = "main", autoMerge = false } = options;

  let container = getGitHubContainer(options.git)
    .withSecretVariable("GH_TOKEN", options.ghToken)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec(["gh", "auth", "setup-git"])
    .withExec(["git", "clone", `--branch=${baseBranch}`, `https://github.com/${options.repository}`, "."])
    .withExec(["git", "checkout", "-b", options.newBranch]);

  // Apply file changes
  for (const [path, content] of Object.entries(options.fileChanges)) {
    container = container.withExec(["sh", "-c", `echo '${content}' > ${path}`]);
  }

  container = container
    .withExec(["git", "add", "."])
    .withExec(["git", "commit", "-m", options.commitMessage])
    .withExec(["git", "push", "--set-upstream", "origin", options.newBranch])
    .withExec([
      "gh",
      "pr",
      "create",
      "--title",
      options.title,
      "--body",
      options.body,
      "--base",
      baseBranch,
      "--head",
      options.newBranch,
    ]);

  if (autoMerge) {
    container = container.withExec(["gh", "pr", "merge", "--auto", "--rebase"]);
  }

  return await container.stdout();
}
