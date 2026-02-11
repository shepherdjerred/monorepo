/**
 * tRPC initialization
 *
 * Sets up the core tRPC instance with context and middleware.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "@shepherdjerred/scout-backend/trpc/context.ts";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Include Zod validation errors in response
        zodError: error.cause instanceof Error ? error.cause.message : null,
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
