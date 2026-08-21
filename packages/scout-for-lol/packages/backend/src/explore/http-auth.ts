import * as Sentry from "@sentry/bun";
import { TRPCError } from "@trpc/server";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { assertExploreAccess } from "#src/explore/access.ts";
import type { ExploreRateLimitIdentity } from "#src/explore/rate-limit.ts";
import { createLogger } from "#src/logger.ts";
import { createContext, type Context } from "#src/trpc/context.ts";

/**
 * Who is allowed to run an explore turn over HTTP.
 *
 * The SSE endpoint sits outside tRPC but has to enforce the same three things
 * its procedures do — a signed session, a matching CSRF token from the
 * expected origin, and the explore allowlist — so this reuses the tRPC context
 * rather than reimplementing any of them.
 */

const logger = createLogger("explore-http-auth");

export type ExploreAuthResult =
  | { ok: true; identity: ExploreRateLimitIdentity; guildIds: string[] }
  | { ok: false; status: number; message: string };

export async function authenticateExploreRequest(
  request: Request,
): Promise<ExploreAuthResult> {
  try {
    const ctx = await createContext(request);
    const web = readWebCsrfContext(ctx);
    assertWebCsrf(web.webSession);
    const guildIds = await assertExploreAccess(web.user);
    return {
      ok: true,
      identity: {
        userId: DiscordAccountIdSchema.parse(web.user.discordId),
      },
      guildIds,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      return {
        ok: false,
        status: statusForTrpcError(error),
        message: error.message,
      };
    }
    // A TRPCError describes what the caller got wrong and is safe to repeat.
    // Anything else is a fault on our side, so it is logged and reported
    // rather than written into the response body.
    logger.error("Explore authentication failed", errorMessage(error));
    Sentry.captureException(error, { tags: { source: "explore-auth" } });
    return {
      ok: false,
      status: 500,
      message: "Could not verify this request.",
    };
  }
}

function readWebCsrfContext(ctx: Context): {
  user: NonNullable<Context["user"]>;
  webSession: NonNullable<Context["webSession"]>;
} {
  if (ctx.webSession === null || ctx.user === null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to use explore.",
    });
  }
  return { user: ctx.user, webSession: ctx.webSession };
}

function assertWebCsrf(webSession: NonNullable<Context["webSession"]>): void {
  const { csrfToken, csrfHeader, origin } = webSession;
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
}

function statusForTrpcError(error: TRPCError): number {
  if (error.code === "UNAUTHORIZED") {
    return 401;
  }
  if (error.code === "FORBIDDEN") {
    return 403;
  }
  if (error.code === "NOT_FOUND") {
    return 404;
  }
  if (error.code === "BAD_REQUEST") {
    return 400;
  }
  if (error.code === "TOO_MANY_REQUESTS") {
    return 429;
  }
  return 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
