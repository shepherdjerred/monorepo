/**
 * Auth Router
 *
 * The Discord OAuth web sign-in flow lives in `auth-web.ts` as plain HTTP
 * routes (`/api/auth/discord/start`, `/api/auth/discord/callback`) because
 * setting HttpOnly cookies and 302-redirecting is awkward through tRPC.
 * This router only carries the API-token management surface used by the
 * desktop client and the `me` / `meWeb` profile lookups.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  protectedProcedure,
  publicProcedure,
  webProcedure,
} from "#src/trpc/trpc.ts";
import { prisma } from "#src/database/index.ts";
import { generateApiToken } from "#src/trpc/context.ts";
import { createLogger } from "#src/logger.ts";
import { ApiTokenIdSchema } from "@scout-for-lol/data";

const logger = createLogger("auth-router");

export const authRouter = router({
  /**
   * Create an API token for desktop client
   */
  createApiToken: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { token, hash } = generateApiToken();

      const expiresAt =
        input.expiresInDays === undefined
          ? null
          : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

      const apiToken = await prisma.apiToken.create({
        data: {
          userId: ctx.user.discordId,
          token: hash,
          name: input.name,
          scopes: "events:write",
          expiresAt,
        },
      });

      logger.info(
        `API token created for user ${ctx.user.discordUsername}: ${input.name}`,
      );

      // Return the unhashed token - this is the only time it will be shown!
      return {
        id: apiToken.id,
        name: apiToken.name,
        token, // Unhashed token - show once!
        scopes: apiToken.scopes,
        expiresAt: apiToken.expiresAt,
        createdAt: apiToken.createdAt,
      };
    }),

  /**
   * List user's API tokens (without the actual token values)
   */
  listApiTokens: protectedProcedure.query(async ({ ctx }) => {
    const tokens = await prisma.apiToken.findMany({
      where: {
        userId: ctx.user.discordId,
        revokedAt: null,
        scopes: { not: "session" }, // Don't show session tokens
      },
      select: {
        id: true,
        name: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return tokens;
  }),

  /**
   * Revoke an API token
   */
  revokeApiToken: protectedProcedure
    .input(z.object({ tokenId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const tokenId = ApiTokenIdSchema.parse(input.tokenId);
      const token = await prisma.apiToken.findFirst({
        where: {
          id: tokenId,
          userId: ctx.user.discordId,
        },
      });

      if (!token) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Token not found",
        });
      }

      await prisma.apiToken.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
      });

      logger.info(
        `API token revoked: ${token.name} for user ${ctx.user.discordUsername}`,
      );

      return { success: true };
    }),

  /**
   * Get current user info
   */
  me: protectedProcedure.query(({ ctx }) => {
    return {
      discordId: ctx.user.discordId,
      username: ctx.user.discordUsername,
      avatar: ctx.user.discordAvatar,
      createdAt: ctx.user.createdAt,
    };
  }),

  /**
   * Get the currently signed-in web user (from scout_session cookie).
   * Returns 401 if not signed in.
   */
  meWeb: webProcedure.query(({ ctx }) => {
    return {
      discordId: ctx.user.discordId,
      username: ctx.user.discordUsername,
      avatar: ctx.user.discordAvatar,
      createdAt: ctx.user.createdAt,
    };
  }),

  /**
   * "Am I signed in?" — answers with `{ user: null }` when the caller has no
   * session instead of throwing UNAUTHORIZED.
   *
   * The SPA asks this on every page load (route loaders, the guild picker, the
   * onboarding wizard). Using `meWeb` for it meant each anonymous visit raised
   * a pair of UNAUTHORIZED errors, which drowned the logs — 185 ERROR lines in
   * 30 days against 21 real sign-ins — and made genuine auth faults impossible
   * to spot. Not being signed in is a normal answer, not an error.
   */
  sessionState: publicProcedure.query(({ ctx }) => {
    if (ctx.webSession === null || ctx.user === null) {
      return { user: null };
    }
    return {
      user: {
        discordId: ctx.user.discordId,
        username: ctx.user.discordUsername,
        avatar: ctx.user.discordAvatar,
        createdAt: ctx.user.createdAt,
      },
    };
  }),
});
