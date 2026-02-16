/**
 * tRPC Context
 *
 * Creates the context for each tRPC request, including authentication state.
 */

import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import type {
  ApiToken,
  User,
} from "@scout-for-lol/backend/generated/prisma/client/index.js";

const logger = createLogger("trpc-context");

export type Context = {
  /** The authenticated user (from session or API token) */
  user: User | null;
  /** The API token used for authentication (if using token auth) */
  apiToken: ApiToken | null;
  /** Request ID for tracing */
  requestId: string;
};

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
  if (!authHeader?.startsWith("Bearer ")) {
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

  if (bearerToken) {
    // Try API token authentication first
    const hashedToken = hashToken(bearerToken);
    const tokenRecord = await prisma.apiToken.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    });

    if (tokenRecord && !tokenRecord.revokedAt) {
      // Check expiration
      if (!tokenRecord.expiresAt || tokenRecord.expiresAt > new Date()) {
        apiToken = tokenRecord;
        user = tokenRecord.user;

        // Update last used timestamp
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

    // TODO: Add session-based authentication for web frontend
    // This would check for a session cookie or JWT
  }

  return {
    user,
    apiToken,
    requestId,
  };
}

/**
 * Generate a new API token (returns unhashed token - show only once!)
 */
export function generateApiToken(): { token: string; hash: string } {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hash = hashToken(token);
  return { token, hash };
}
