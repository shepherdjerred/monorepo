// Types
export * from "./types.ts";

// Config helpers
export {
  isEditorEnabled,
  getAllowedRepos,
  getRepoConfig,
  isRepoAllowed,
  getMaxSessionDuration,
  getMaxSessionsPerUser,
  getGitHubConfig,
  isGitHubConfigured,
} from "./config.ts";

// Session management
export {
  getSession,
  getActiveSessionsForUser,
  getActiveSessionCount,
  canCreateSession,
  getOrCreateSession,
  updateSdkSessionId,
  updateClonedRepoPath,
  storePendingChanges,
  getPendingChanges,
  updateSessionState,
  updateMessageId,
  updateSummary,
  updatePrUrl,
  expireOldSessions,
  deleteSession,
  extendSession,
  cleanupSessionClone,
} from "./session-manager.ts";

// Repo cloning
export { cloneRepo, cleanupClone } from "./repo-clone.ts";

// Claude Code client
export {
  executeEdit,
  isClaudeAvailable,
  checkClaudePrerequisites,
  checkGhPrerequisites,
} from "./claude-client.ts";

// Diff formatting
export {
  formatDiffForDiscord,
  formatChangeSummary,
  formatChangedFilesList,
  willFitInEmbed,
} from "./diff-formatter.ts";

// GitHub OAuth
export {
  getAuthorizationUrl,
  exchangeCodeForToken,
  storeAuth,
  getAuth,
  hasValidAuth,
  deleteAuth,
  isOAuthAvailable,
} from "./github-oauth.ts";

// GitHub PR creation
export {
  createPullRequest,
  generateBranchName,
  generatePRTitle,
  generatePRBody,
} from "./github-pr.ts";

// OAuth server
export { startOAuthServer, stopOAuthServer } from "./oauth-server.ts";

// OAuth routes (for custom integration)
export { createOAuthRoutes } from "./oauth-routes.ts";
