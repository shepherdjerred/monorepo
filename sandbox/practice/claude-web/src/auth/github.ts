import { getConfig } from "../config/index.js";
import type { GitHubUser, GitHubTokenResponse } from "./types.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";

// OAuth scopes needed for Claude Web
const SCOPES = ["repo", "user:email", "read:user"].join(" ");

/**
 * Generate the GitHub OAuth authorization URL
 */
export function getAuthorizationUrl(state: string): string {
  const config = getConfig();

  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID,
    redirect_uri: "http://localhost:8000/auth/github/callback",
    scope: SCOPES,
    state,
  });

  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token
 */
export async function exchangeCodeForToken(
  code: string,
): Promise<GitHubTokenResponse> {
  const config = getConfig();

  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as GitHubTokenResponse & {
    error?: string;
  };

  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error}`);
  }

  return data;
}

/**
 * Fetch the authenticated user's profile from GitHub
 */
export async function fetchGitHubUser(
  accessToken: string,
): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed: ${response.status}`);
  }

  return response.json() as Promise<GitHubUser>;
}

/**
 * Fetch the user's primary email if not included in profile
 */
export async function fetchGitHubEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await fetch(`${GITHUB_API_URL}/user/emails`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const emails = (await response.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;

  const primary = emails.find((e) => e.primary && e.verified);
  return primary?.email ?? emails[0]?.email ?? null;
}
