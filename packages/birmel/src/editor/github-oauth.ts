import { z } from "zod";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getGitHubConfig, isGitHubConfigured } from "./config.ts";
import type { GitHubAuth } from "@prisma/client";

const TokenResponseSchema = z
  .object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_in: z.number().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .loose();

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

  const rawData: unknown = await response.json();
  const parsed = TokenResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new Error("Invalid token response from GitHub");
  }

  const data = parsed.data;

  if (data.error != null && data.error.length > 0) {
    throw new Error(data.error_description ?? data.error);
  }

  return buildTokenResult(
    data.access_token ?? "",
    data.refresh_token,
    data.expires_in,
  );
}

function buildTokenResult(
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number | undefined,
): { accessToken: string; refreshToken?: string; expiresAt?: Date } {
  const result: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  } = { accessToken };
  if (refreshToken != null && refreshToken.length > 0) {
    result.refreshToken = refreshToken;
  }
  if (expiresIn != null) {
    result.expiresAt = new Date(Date.now() + expiresIn * 1000);
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
