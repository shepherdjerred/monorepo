/**
 * tRPC Client for Frontend
 *
 * Creates a tRPC client for communicating with the backend API.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@scout-for-lol/backend/trpc/router/index.ts";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Astro's import.meta.env returns any for custom env vars
const envBackendUrl: string | undefined = import.meta.env["PUBLIC_BACKEND_URL"];
const BACKEND_URL: string = envBackendUrl ?? "http://localhost:3000";

/**
 * Create a tRPC client with optional auth token
 */
export function createApiClient(sessionToken?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${BACKEND_URL}/trpc`,
        headers() {
          if (sessionToken) {
            return {
              Authorization: `Bearer ${sessionToken}`,
            };
          }
          return {};
        },
      }),
    ],
  });
}

/**
 * Get a tRPC client using the stored session token
 */
export function getApiClient() {
  const sessionToken = getSessionToken();
  return createApiClient(sessionToken ?? undefined);
}

/**
 * Get the stored session token
 */
export function getSessionToken(): string | null {
  if (globalThis.window === undefined) {
    return null;
  }
  return localStorage.getItem("scout_session_token");
}

/**
 * Store a session token
 */
export function setSessionToken(token: string): void {
  if (globalThis.window === undefined) {
    return;
  }
  localStorage.setItem("scout_session_token", token);
}

/**
 * Clear the stored session token
 */
export function clearSessionToken(): void {
  if (globalThis.window === undefined) {
    return;
  }
  localStorage.removeItem("scout_session_token");
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return getSessionToken() !== null;
}

/**
 * Get the redirect URI for OAuth callbacks
 */
export function getRedirectUri(): string {
  if (globalThis.window === undefined) {
    return `${BACKEND_URL}/app/callback`;
  }
  return `${globalThis.location.origin}/app/callback`;
}
