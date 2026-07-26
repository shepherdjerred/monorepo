/**
 * tRPC initialization
 *
 * Sets up the core tRPC instance with context and middleware.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import {
  type Permission,
  PermissionDeniedCauseSchema,
} from "@scout-for-lol/data";
import type { Context } from "#src/trpc/context.ts";
import configuration from "#src/configuration.ts";

/**
 * Find the missing `{ resource, action }` a FORBIDDEN carries. The
 * guild-permission gate throws it as the error `cause`, but tRPC re-wraps
 * middleware errors, so the payload can sit a few links down the cause chain —
 * walk it rather than reading `error.cause` directly.
 */
function findMissingPermission(error: unknown, depth = 0): Permission | null {
  if (depth > 6 || error === null || typeof error !== "object") return null;
  const parsed = PermissionDeniedCauseSchema.safeParse(error);
  if (parsed.success) return parsed.data.missingPermission;
  if ("cause" in error) return findMissingPermission(error.cause, depth + 1);
  return null;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Include Zod validation errors in response
        zodError: error.cause instanceof Error ? error.cause.message : null,
        // A FORBIDDEN from the guild-permission gate carries the missing
        // `{ resource, action }` so the SPA can name the exact scope.
        missingPermission: findMissingPermission(error),
      },
    };
  },
});

/**
 * Export reusable router and procedure helpers
 */
export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/**
 * Middleware that enforces user authentication via session
 */
const isAuthenticated = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource",
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/**
 * Middleware that enforces API token authentication (for desktop clients)
 */
const hasApiToken = middleware(async ({ ctx, next }) => {
  if (!ctx.apiToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Valid API token required",
    });
  }
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "User not found",
    });
  }
  return next({
    ctx: {
      ...ctx,
      apiToken: ctx.apiToken,
      user: ctx.user,
    },
  });
});

/**
 * Protected procedure - requires session-based authentication
 */
export const protectedProcedure = t.procedure.use(isAuthenticated);

/**
 * Desktop client procedure - requires API token authentication
 */
export const desktopClientProcedure = t.procedure.use(hasApiToken);

/**
 * Web read middleware - requires a valid scout_session cookie.
 * Use webProcedure for queries that only read state.
 */
const hasWebSession = middleware(async ({ ctx, next }) => {
  if (ctx.webSession === null || ctx.user === null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Web session required — sign in at /app/login",
    });
  }
  return next({
    ctx: {
      ...ctx,
      webSession: ctx.webSession,
      user: ctx.user,
    },
  });
});

/**
 * Web mutation middleware - requires a valid scout_session cookie AND
 * a matching CSRF token in both the cookie and X-CSRF-Token header,
 * AND a same-origin Origin header. Use webMutationProcedure for any
 * state-changing endpoint.
 */
const hasWebSessionWithCsrf = middleware(async ({ ctx, next }) => {
  if (ctx.webSession === null || ctx.user === null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Web session required — sign in at /app/login",
    });
  }

  const { csrfToken, csrfHeader, origin } = ctx.webSession;

  if (
    csrfToken === null ||
    csrfHeader === null ||
    csrfToken.length === 0 ||
    csrfHeader.length === 0 ||
    csrfToken !== csrfHeader
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "CSRF token missing or mismatched",
    });
  }

  const expectedOrigin = configuration.webAppOrigin;
  if (expectedOrigin !== undefined && origin !== expectedOrigin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cross-origin request rejected",
    });
  }

  return next({
    ctx: {
      ...ctx,
      webSession: ctx.webSession,
      user: ctx.user,
    },
  });
});

export const webProcedure = t.procedure.use(hasWebSession);
export const webMutationProcedure = t.procedure.use(hasWebSessionWithCsrf);
