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
import { trpcCallDuration, trpcCallsTotal } from "#src/metrics/web.ts";

/**
 * Find the missing `{ resource, action }` a FORBIDDEN carries. The
 * guild-permission gate throws it as the error `cause`, but tRPC re-wraps
 * middleware errors, so the payload can sit a few links down the cause chain —
 * walk it rather than reading `error.cause` directly.
 */
function findMissingPermission(error: unknown, depth = 0): Permission | null {
  if (error === null || typeof error !== "object" || depth > 6) return null;
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
export const middleware = t.middleware;

/**
 * Records latency and outcome for every procedure call.
 *
 * Deliberately a middleware rather than the adapter's `onError` hook: `onError`
 * only fires on failure, so it can produce an error count but never an error
 * *rate*. `next()` reports `{ ok }` without throwing, so success and failure
 * are both observed here.
 *
 * `path` is the procedure name from the router definition — a bounded set — so
 * it is safe as a label.
 */
const withTrpcMetrics = t.middleware(async ({ path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const procedure = path === "" ? "unknown" : path;
  trpcCallDuration.observe({ procedure }, (performance.now() - start) / 1000);
  trpcCallsTotal.inc({
    procedure,
    type,
    code: result.ok ? "OK" : result.error.code,
  });
  return result;
});

/**
 * Base procedure every exported procedure builds on, so instrumentation is
 * automatic and no router has to opt in (or can forget to).
 */
const instrumentedProcedure = t.procedure.use(withTrpcMetrics);

export const publicProcedure = instrumentedProcedure;

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
export const protectedProcedure = instrumentedProcedure.use(isAuthenticated);

/**
 * Desktop client procedure - requires API token authentication
 */
export const desktopClientProcedure = instrumentedProcedure.use(hasApiToken);

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
    csrfToken !== csrfHeader ||
    csrfToken.length === 0 ||
    csrfHeader.length === 0
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

export const webProcedure = instrumentedProcedure.use(hasWebSession);
export const webMutationProcedure = instrumentedProcedure.use(
  hasWebSessionWithCsrf,
);
