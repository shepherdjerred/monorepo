// Types
export * from "./types.js";

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
} from "./config.js";

// Session management
export {
  getSession,
  getActiveSessionsForUser,
  getActiveSessionCount,
  canCreateSession,
  getOrCreateSession,
  updateSdkSessionId,
  storePendingChanges,
  getPendingChanges,
  updateSessionState,
  updateMessageId,
  updateSummary,
  updatePrUrl,
  expireOldSessions,
  deleteSession,
  extendSession,
} from "./session-manager.js";

// Claude Code client
export {
  executeEdit,
  isClaudeAvailable,
  checkClaudePrerequisites,
  checkGhPrerequisites,
} from "./claude-client.js";

// Diff formatting
export {
  formatDiffForDiscord,
  formatChangeSummary,
  formatChangedFilesList,
  willFitInEmbed,
} from "./diff-formatter.js";

// GitHub OAuth
export {
  getAuthorizationUrl,
  exchangeCodeForToken,
  storeAuth,
  getAuth,
  hasValidAuth,
  deleteAuth,
  isOAuthAvailable,
} from "./github-oauth.js";

// GitHub PR creation
export {
  createPullRequest,
  generateBranchName,
  generatePRTitle,
  generatePRBody,
} from "./github-pr.js";

// OAuth server
export { startOAuthServer, stopOAuthServer } from "./oauth-server.js";

// OAuth routes (for custom integration)
export { createOAuthRoutes } from "./oauth-routes.js";
