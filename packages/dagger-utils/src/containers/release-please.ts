import { dag, type Container, type Secret } from "@dagger.io/dagger";
import versions from "../versions";

export type ReleasePleaseContainerOptions = {
  /** Custom Node.js version (defaults to versions.node) */
  nodeVersion?: string;
  /** release-please version to install (defaults to latest) */
  releasePleaseVersion?: string;
};

/**
 * Returns a container with release-please CLI and git installed.
 * Useful for creating release PRs and GitHub releases based on conventional commits.
 *
 * @param options - Configuration options for the container
 * @returns A configured container with release-please CLI
 *
 * @example
 * ```ts
 * const container = getReleasePleaseContainer()
 *   .withSecretVariable("GITHUB_TOKEN", ghToken)
 *   .withExec(["release-please", "release-pr", "--repo-url=owner/repo"]);
 * ```
 */
export function getReleasePleaseContainer(options: ReleasePleaseContainerOptions = {}): Container {
  const nodeVersion = options.nodeVersion ?? versions.node;
  const rpVersion = options.releasePleaseVersion ?? "latest";

  return dag
    .container()
    .from(`node:${nodeVersion}-bookworm`)
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "git"])
    .withExec(["npm", "install", "-g", `release-please@${rpVersion}`])
    .withWorkdir("/workspace");
}

export type ReleasePrOptions = {
  /** GitHub token for authentication */
  ghToken: Secret;
  /** Repository URL (e.g., "owner/repo") */
  repoUrl: string;
  /** Release type (e.g., "node", "python", "java") */
  releaseType?: string;
  /** Target branch (defaults to "main") */
  targetBranch?: string;
  /** Container options */
  container?: ReleasePleaseContainerOptions;
};

/**
 * Creates or updates a release PR based on conventional commits.
 * Uses release-please to analyze commits and determine version bumps.
 *
 * @param options - Release PR creation options
 * @returns The release-please CLI output
 *
 * @example
 * ```ts
 * const output = await releasePr({
 *   ghToken: dag.setSecret("gh-token", process.env.GITHUB_TOKEN),
 *   repoUrl: "owner/repo",
 *   releaseType: "node",
 * });
 * ```
 */
export async function releasePr(options: ReleasePrOptions): Promise<string> {
  const { releaseType = "node", targetBranch = "main" } = options;

  const container = getReleasePleaseContainer(options.container)
    .withSecretVariable("GITHUB_TOKEN", options.ghToken)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec([
      "sh",
      "-c",
      `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${options.repoUrl}.git . && release-please release-pr --token=$GITHUB_TOKEN --repo-url=${options.repoUrl} --target-branch=${targetBranch} --release-type=${releaseType}`,
    ]);

  return await container.stdout();
}

export type GitHubReleaseOptions = {
  /** GitHub token for authentication */
  ghToken: Secret;
  /** Repository URL (e.g., "owner/repo") */
  repoUrl: string;
  /** Release type (e.g., "node", "python", "java") */
  releaseType?: string;
  /** Container options */
  container?: ReleasePleaseContainerOptions;
};

/**
 * Creates a GitHub release when a release PR has been merged.
 * Uses release-please to detect merged release PRs and create corresponding releases.
 *
 * @param options - GitHub release creation options
 * @returns The release-please CLI output (includes release URL if created)
 *
 * @example
 * ```ts
 * const output = await githubRelease({
 *   ghToken: dag.setSecret("gh-token", process.env.GITHUB_TOKEN),
 *   repoUrl: "owner/repo",
 * });
 * // Check if release was created
 * if (output.includes("github.com") && output.includes("releases")) {
 *   console.log("Release created!");
 * }
 * ```
 */
export async function githubRelease(options: GitHubReleaseOptions): Promise<string> {
  const { releaseType = "node" } = options;

  const container = getReleasePleaseContainer(options.container)
    .withSecretVariable("GITHUB_TOKEN", options.ghToken)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec([
      "sh",
      "-c",
      `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${options.repoUrl}.git . && release-please github-release --token=$GITHUB_TOKEN --repo-url=${options.repoUrl} --release-type=${releaseType}`,
    ]);

  return await container.stdout();
}

export type ManifestPrOptions = {
  /** GitHub token for authentication */
  ghToken: Secret;
  /** Repository URL (e.g., "owner/repo") */
  repoUrl: string;
  /** Target branch (defaults to "main") */
  targetBranch?: string;
  /** Container options */
  container?: ReleasePleaseContainerOptions;
};

/**
 * Creates or updates release PRs for a monorepo using manifest mode.
 * Uses release-please-config.json and .release-please-manifest.json for configuration.
 *
 * @param options - Manifest PR creation options
 * @returns The release-please CLI output
 *
 * @example
 * ```ts
 * const output = await manifestPr({
 *   ghToken: dag.setSecret("gh-token", process.env.GITHUB_TOKEN),
 *   repoUrl: "owner/repo",
 * });
 * ```
 */
export async function manifestPr(options: ManifestPrOptions): Promise<string> {
  const { targetBranch = "main" } = options;

  const container = getReleasePleaseContainer(options.container)
    .withSecretVariable("GITHUB_TOKEN", options.ghToken)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec([
      "sh",
      "-c",
      `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${options.repoUrl}.git . && release-please manifest-pr --token=$GITHUB_TOKEN --repo-url=${options.repoUrl} --target-branch=${targetBranch}`,
    ]);

  return await container.stdout();
}

export type ManifestReleaseOptions = {
  /** GitHub token for authentication */
  ghToken: Secret;
  /** Repository URL (e.g., "owner/repo") */
  repoUrl: string;
  /** Container options */
  container?: ReleasePleaseContainerOptions;
};

/**
 * Creates GitHub releases for a monorepo using manifest mode.
 * Uses release-please-config.json and .release-please-manifest.json for configuration.
 *
 * @param options - Manifest release creation options
 * @returns The release-please CLI output (includes release URLs if created)
 *
 * @example
 * ```ts
 * const output = await manifestRelease({
 *   ghToken: dag.setSecret("gh-token", process.env.GITHUB_TOKEN),
 *   repoUrl: "owner/repo",
 * });
 * ```
 */
export async function manifestRelease(options: ManifestReleaseOptions): Promise<string> {
  const container = getReleasePleaseContainer(options.container)
    .withSecretVariable("GITHUB_TOKEN", options.ghToken)
    .withEnvVariable("CACHE_BUST", Date.now().toString())
    .withExec([
      "sh",
      "-c",
      `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${options.repoUrl}.git . && release-please manifest-release --token=$GITHUB_TOKEN --repo-url=${options.repoUrl}`,
    ]);

  return await container.stdout();
}
