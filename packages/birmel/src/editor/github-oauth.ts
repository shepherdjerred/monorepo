import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/index.ts";
import { getGitHubConfig, isGitHubConfigured } from "./config.ts";
import type { GitHubAuth } from "./types.ts";

const logger = loggers.editor.child("github-oauth");

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Generate OAuth authorization URL for a user
 */
export function getAuthorizationUrl(userId: string, state?: string): string {
  const config = getGitHubConfig();
  if (config == null) {
    throw new Error("GitHub OAuth not configured");
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    scope: "repo",
    state: state ?? userId,
  });

  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  code: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
  const config = getGitHubConfig();
  if (config == null) {
    throw new Error("GitHub OAuth not configured");
  }

  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("Failed to exchange code for token", undefined, {
      status: response.status,
      body: text,
    });
    throw new Error(
      `Failed to exchange code for token: ${String(response.status)}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
    scope: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (data.error != null && data.error.length > 0) {
    throw new Error(data.error_description ?? data.error);
  }

  const result: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  } = {
    accessToken: data.access_token,
  };

  if (data.refresh_token != null && data.refresh_token.length > 0) {
    result.refreshToken = data.refresh_token;
  }

  if (data.expires_in != null) {
    result.expiresAt = new Date(Date.now() + data.expires_in * 1000);
  }

  return result;
}

/**
 * Store GitHub auth for a user
 */
export async function storeAuth(
  userId: string,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: Date,
): Promise<GitHubAuth> {
  return prisma.gitHubAuth.upsert({
    where: { userId },
    update: {
      accessToken,
      refreshToken: refreshToken ?? null,
      expiresAt: expiresAt ?? null,
    },
    create: {
      userId,
      accessToken,
      refreshToken: refreshToken ?? null,
      expiresAt: expiresAt ?? null,
    },
  });
}

/**
 * Get stored GitHub auth for a user
 */
export async function getAuth(userId: string): Promise<GitHubAuth | null> {
  return prisma.gitHubAuth.findUnique({
    where: { userId },
  });
}

/**
 * Check if user has valid GitHub auth
 */
export async function hasValidAuth(userId: string): Promise<boolean> {
  const auth = await getAuth(userId);
  if (auth == null) {
    return false;
  }

  // Check if token is expired
  if (auth.expiresAt != null && auth.expiresAt < new Date()) {
    return false;
  }

  return true;
}

/**
 * Delete GitHub auth for a user
 */
export async function deleteAuth(userId: string): Promise<void> {
  await prisma.gitHubAuth
    .delete({
      where: { userId },
    })
    .catch(() => {
      // Ignore if not found
    });
}

/**
 * Check if GitHub OAuth is available
 */
export function isOAuthAvailable(): boolean {
  return isGitHubConfigured();
}
