/**
 * tRPC Context
 *
 * Creates the context for each tRPC request, including authentication state.
 */

import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { webSessionRejectedTotal } from "#src/metrics/platform/web.ts";
import type { User } from "#generated/prisma/client/index.js";
import { verifySession } from "#src/trpc/jwt.ts";
import {
  isCustomActivityTokenCandidate,
  verifyCustomActivityToken,
} from "#src/customs/activity/activity-auth.ts";
import type { CustomActivityClaims } from "@scout-for-lol/data";

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
  /** The authenticated user (from a Customs activity or web cookie) */
  user: User | null;
  /** The web session, if the request carried a valid scout_session cookie */
  webSession: WebSession | null;
  /** Dedicated, short-lived Discord Activity bearer session. */
  activitySession: CustomActivityClaims | null;
  /**
   * Forwarded client IP, when the edge supplied one. Present for anonymous
   * callers too, so public endpoints can rate-limit per caller. NEVER used for
   * authorization — a client-supplied header is not an identity.
   */
  clientIp: string | null;
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
 * Extract and validate bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | null): string | null {
  return authHeader?.startsWith("Bearer ") === true
    ? authHeader.slice(7)
    : null;
}

/**
 * `User.lastSeenAt` is a DB-side activity marker (MAU/WAU without PostHog).
 * One write per user per hour bounds the write amplification of running on
 * every authenticated request. The update repeats the hour predicate in the
 * database so concurrent requests cannot all pass a stale in-memory check.
 */
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export async function recordUserSeen(
  user: Pick<User, "discordId" | "lastSeenAt">,
  db = prisma,
  now = new Date(),
): Promise<void> {
  if (
    user.lastSeenAt !== null &&
    now.getTime() - user.lastSeenAt.getTime() < LAST_SEEN_WRITE_INTERVAL_MS
  ) {
    return;
  }
  try {
    await db.user.updateMany({
      where: {
        discordId: user.discordId,
        OR: [
          { lastSeenAt: null },
          {
            lastSeenAt: {
              lte: new Date(now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS),
            },
          },
        ],
      },
      data: { lastSeenAt: now },
    });
  } catch (error) {
    // Best-effort: an activity marker must never fail the request context.
    logger.warn("Failed to record user lastSeenAt", { error });
  }
}

/**
 * Create context from request
 */
export async function createContext(request: Request): Promise<Context> {
  const requestId = globalThis.crypto.randomUUID();

  const authHeader = request.headers.get("Authorization");
  const bearerToken = extractBearerToken(authHeader);

  let user: User | null = null;
  let webSession: WebSession | null = null;
  let activitySession: CustomActivityClaims | null = null;

  if (bearerToken !== null && bearerToken.length > 0) {
    activitySession = isCustomActivityTokenCandidate(bearerToken)
      ? await verifyCustomActivityToken(bearerToken)
      : null;
  }

  // Web session via signed cookie.
  //
  // The rejection reasons are separated because they mean very different
  // things: `absent` is ordinary anonymous traffic and dominates by design,
  // while a rise in `invalid` (bad signature) or `unknown_user` (a session for
  // a user we no longer have) points at a real problem.
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionJwt = cookies.get(SESSION_COOKIE);
  if (sessionJwt === undefined || sessionJwt.length === 0) {
    webSessionRejectedTotal.inc({ reason: "absent" });
  } else {
    const claims = await verifySession(sessionJwt);
    if (claims === null) {
      // verifySession covers both a bad signature and an expired token.
      webSessionRejectedTotal.inc({ reason: "invalid" });
    } else {
      const dbUser = await prisma.user.findUnique({
        where: { discordId: claims.sub },
      });
      if (dbUser === null) {
        webSessionRejectedTotal.inc({ reason: "unknown_user" });
      } else {
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

  if (user !== null) {
    await recordUserSeen(user);
  }

  return {
    user,
    webSession,
    activitySession,
    clientIp:
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For"),
    requestId,
  };
}
