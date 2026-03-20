import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import type { EditorRepoConfig } from "@shepherdjerred/birmel/config/schema.ts";

/**
 * Check if the editor feature is enabled
 */
export function isEditorEnabled(): boolean {
  return getConfig().editor.enabled;
}

/**
 * Get all allowed repositories
 */
export function getAllowedRepos(): EditorRepoConfig[] {
  return getConfig().editor.allowedRepos;
}

/**
 * Get a repository config by name
 */
export function getRepoConfig(repoName: string): EditorRepoConfig | undefined {
  return getConfig().editor.allowedRepos.find(
    (repo) => repo.name.toLowerCase() === repoName.toLowerCase(),
  );
}

/**
 * Check if a repository is in the allowlist
 */
export function isRepoAllowed(repoName: string): boolean {
  return getRepoConfig(repoName) !== undefined;
}

/**
 * Get the maximum session duration in milliseconds
 */
export function getMaxSessionDuration(): number {
  return getConfig().editor.maxSessionDurationMs;
}

/**
 * Get the maximum sessions per user
 */
export function getMaxSessionsPerUser(): number {
  return getConfig().editor.maxSessionsPerUser;
}

/**
 * Get GitHub OAuth configuration if configured
 */
export function getGitHubConfig():
  | { clientId: string; clientSecret: string; callbackUrl: string }
  | undefined {
  return getConfig().editor.github;
}

/**
 * Check if GitHub OAuth is configured
 */
export function isGitHubConfigured(): boolean {
  return getGitHubConfig() !== undefined;
}
