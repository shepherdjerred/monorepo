import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verifyToken, type AuthContext } from "../../auth/index.js";

// Extend Hono's context with our auth context
declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Middleware that requires authentication.
 * Returns 401 if no valid session token is present.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, "session");

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payload = await verifyToken(token);

  if (!payload) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  // Attach auth context to request
  c.set("auth", {
    userId: payload.userId as string,
    githubId: payload.githubId as string,
    username: payload.username as string,
  });

  await next();
}

/**
 * Middleware that optionally adds auth context if a valid token is present.
 * Does not return 401 - continues even without auth.
 */
export async function optionalAuth(c: Context, next: Next) {
  const token = getCookie(c, "session");

  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      c.set("auth", {
        userId: payload.userId,
        githubId: payload.githubId,
        username: payload.username,
      });
    }
  }

  await next();
}
