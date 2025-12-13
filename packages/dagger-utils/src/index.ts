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
  type MiseToolVersions,
  type WorkspaceConfig,
  type GitHubContainerOptions,
  type CreatePullRequestOptions,
  type GhcrPublishOptions,
  type GhcrPublishMultipleOptions,
  type CloudflarePagesDeployOptions,
  type CloudflareWorkerDeployOptions,
} from "./containers";

// Utilities
export {
  logWithTimestamp,
  withTiming,
  formatDuration,
  runParallel,
  runNamedParallel,
  collectResults,
  type ParallelResults,
  type NamedOperation,
  type NamedResult,
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
