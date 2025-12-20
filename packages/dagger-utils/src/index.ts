/**
 * @shepherdjerred/dagger-utils
 *
 * Reusable Dagger container builders and CI/CD utilities.
 * Provides optimized container factories with caching and parallel execution helpers.
 */

// Container builders
export {
  getSystemContainer,
  getMiseRuntimeContainer,
  withMiseTools,
  getWorkspaceContainer,
  getKubectlContainer,
  getCurlContainer,
  getBunContainer,
  getBunNodeContainer,
  getNodeContainer,
  getNodeSlimContainer,
  getNodeContainerWithCache,
  getBunContainerWithCache,
  withBunInstall,
  publishToNpm,
  runBunWorkspaceCI,
  getGitHubContainer,
  createPullRequest,
  publishToGhcr,
  publishToGhcrMultiple,
  withGhcrAuth,
  getCloudflareContainer,
  getCloudflarePagesDeployContainer,
  getCloudflareWorkerDeployContainer,
  deployToCloudflarePages,
  deployToCloudflareWorker,
  getReleasePleaseContainer,
  releasePr,
  githubRelease,
  manifestPr,
  manifestRelease,
  type MiseToolVersions,
  type WorkspaceConfig,
  type NpmPublishOptions,
  type BunWorkspaceCIOptions,
  type BunWorkspaceCIResult,
  type GitHubContainerOptions,
  type CreatePullRequestOptions,
  type GhcrPublishOptions,
  type GhcrPublishMultipleOptions,
  type CloudflarePagesDeployOptions,
  type CloudflareWorkerDeployOptions,
  type ReleasePleaseContainerOptions,
  type ReleasePrOptions,
  type GitHubReleaseOptions,
  type ManifestPrOptions,
  type ManifestReleaseOptions,
} from "./containers";

// Utilities
export {
  logWithTimestamp,
  withTiming,
  formatDuration,
  runParallel,
  runNamedParallel,
  collectResults,
  execWithOutput,
  execOrThrow,
  formatDaggerError,
  type ParallelResults,
  type NamedOperation,
  type NamedResult,
  type ExecResult,
} from "./utils";

// Types
export {
  Stage,
  type StepStatus,
  type StepResult,
  passedResult,
  failedResult,
  skippedResult,
} from "./types";

// Version management
export { versions, type Versions } from "./versions";
