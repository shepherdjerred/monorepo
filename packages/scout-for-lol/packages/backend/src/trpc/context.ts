/**
 * tRPC Context
 *
 * Creates the context for each tRPC request, including authentication state.
 */

import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import type { ApiToken, User } from "#generated/prisma/client/index.js";
import { verifySession } from "#src/trpc/jwt.ts";

const logger = createLogger("trpc-context");

export const SESSION_COOKIE = "scout_session";
export const CSRF_COOKIE = "scout_csrf";
export const CSRF_HEADER = "x-csrf-token";

export type WebSession = {
  /** Discord snowflake ID from the verified JWT `sub` */
  discordId: string;
  /** Raw CSRF token value as carried by the scout_csrf cookie (used to validate header on mutations) */
  csrfToken: string | null;
  /** The Origin header from the request, if any */
  origin: string | null;
  /** The X-CSRF-Token header from the request, if any */
  csrfHeader: string | null;
  /** Client IP, best-effort */
  ipAddress: string | null;
  /** User-Agent, best-effort */
  userAgent: string | null;
};

export type Context = {
  /** The authenticated user (from session, API token, or web cookie) */
  user: User | null;
  /** The API token used for authentication (if using token auth) */
  apiToken: ApiToken | null;
  /** The web session, if the request carried a valid scout_session cookie */
  webSession: WebSession | null;
  /** Request ID for tracing */
  requestId: string;
};

function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (header === null) return map;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    map.set(name, decodeURIComponent(value));
  }
  return map;
}

/**
 * Hash a token for comparison with stored hash
 */
function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  return hasher.digest("hex");
}

/**
 * Extract and validate bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | null): string | null {
  if (authHeader?.startsWith("Bearer ") !== true) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Create context from request
 */
export async function createContext(request: Request): Promise<Context> {
  const requestId = globalThis.crypto.randomUUID();

  const authHeader = request.headers.get("Authorization");
  const bearerToken = extractBearerToken(authHeader);

  let user: User | null = null;
  let apiToken: ApiToken | null = null;
  let webSession: WebSession | null = null;

  if (bearerToken !== null && bearerToken.length > 0) {
    const hashedToken = hashToken(bearerToken);
    const tokenRecord = await prisma.apiToken.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    });

    if (tokenRecord && !tokenRecord.revokedAt) {
      if (!tokenRecord.expiresAt || tokenRecord.expiresAt > new Date()) {
        apiToken = tokenRecord;
        user = tokenRecord.user;

        await prisma.apiToken.update({
          where: { id: tokenRecord.id },
          data: { lastUsedAt: new Date() },
        });

        logger.debug(
          `API token auth successful for user ${user.discordUsername}`,
          { requestId },
        );
      } else {
        logger.debug("API token expired", { requestId });
      }
    }
  }

  // Web session via signed cookie
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionJwt = cookies.get(SESSION_COOKIE);
  if (sessionJwt !== undefined && sessionJwt.length > 0) {
    const claims = await verifySession(sessionJwt);
    if (claims !== null) {
      const dbUser = await prisma.user.findUnique({
        where: { discordId: claims.sub },
      });
      if (dbUser !== null) {
        webSession = {
          discordId: claims.sub,
          csrfToken: cookies.get(CSRF_COOKIE) ?? null,
          origin: request.headers.get("Origin"),
          csrfHeader: request.headers.get(CSRF_HEADER),
          ipAddress:
            request.headers.get("CF-Connecting-IP") ??
            request.headers.get("X-Forwarded-For"),
          userAgent: request.headers.get("User-Agent"),
        };
        user ??= dbUser;
        logger.debug(
          `Web session auth successful for ${dbUser.discordUsername}`,
          {
            requestId,
          },
        );
      }
    }
  }

  return {
    user,
    apiToken,
    webSession,
    requestId,
  };
}

/**
 * Generate a new API token (returns unhashed token - show only once!)
 */
export function generateApiToken(): { token: string; hash: string } {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hash = hashToken(token);
  return { token, hash };
}
