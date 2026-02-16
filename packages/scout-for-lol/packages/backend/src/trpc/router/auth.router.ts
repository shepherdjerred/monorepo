/**
 * Auth Router
 *
 * Handles Discord OAuth and API token management.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  publicProcedure,
  protectedProcedure,
} from "@scout-for-lol/backend/trpc/trpc.ts";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { generateApiToken } from "@scout-for-lol/backend/trpc/context.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import configuration from "@scout-for-lol/backend/configuration.ts";
import type { DiscordAccountId, ApiTokenId } from "@scout-for-lol/data";

const logger = createLogger("auth-router");

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Discord user response schema
 */
const DiscordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  discriminator: z.string(),
  avatar: z.string().nullable(),
  email: z.string().optional(),
});

/**
 * Discord OAuth token response schema
 */
const DiscordTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
});

export const authRouter = router({
  /**
   * Get Discord OAuth URL for initiating login
   */
  getOAuthUrl: publicProcedure
    .input(
      z.object({
        redirectUri: z.url(),
        state: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const clientId = configuration.applicationId;
      const scopes = ["identify", "email"].join(" ");

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: input.redirectUri,
        response_type: "code",
        scope: scopes,
      });

      if (input.state) {
        params.set("state", input.state);
      }

      const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;

      logger.debug("Generated OAuth URL", { redirectUri: input.redirectUri });

      return { url };
    }),

  /**
   * Exchange OAuth code for session
   */
  exchangeCode: publicProcedure
    .input(
      z.object({
        code: z.string(),
        redirectUri: z.url(),
      }),
    )
    .mutation(async ({ input }) => {
      // Exchange code for tokens
      const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: configuration.applicationId,
          client_secret: configuration.discordClientSecret ?? "",
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        logger.error("Discord token exchange failed", { error });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to exchange OAuth code",
        });
      }

      const tokensJson: unknown = await tokenResponse.json();
      const tokensResult = DiscordTokenResponseSchema.safeParse(tokensJson);
      if (!tokensResult.success) {
        logger.error("Invalid Discord token response", {
          error: tokensResult.error,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid token response from Discord",
        });
      }
      const tokens = tokensResult.data;

      // Get user info from Discord
      const userResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        logger.error("Failed to fetch Discord user info");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user info",
        });
      }

      const userJson: unknown = await userResponse.json();
      const userResult = DiscordUserSchema.safeParse(userJson);
      if (!userResult.success) {
        logger.error("Invalid Discord user response", {
          error: userResult.error,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid user response from Discord",
        });
      }
      const discordUser = userResult.data;

      // Upsert user in database
      // eslint-disable-next-line custom-rules/no-type-assertions -- Branded type requires assertion after Zod validation
      const discordId = discordUser.id as DiscordAccountId;
      const user = await prisma.user.upsert({
        where: { discordId },
        update: {
          discordUsername: discordUser.username,
          discordAvatar: discordUser.avatar,
          discordAccessToken: tokens.access_token,
          discordRefreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        },
        create: {
          discordId,
          discordUsername: discordUser.username,
          discordAvatar: discordUser.avatar,
          discordAccessToken: tokens.access_token,
          discordRefreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        },
      });

      logger.info(
        `User logged in: ${user.discordUsername} (${user.discordId})`,
      );

      // Generate a session token for the user
      const { token, hash } = generateApiToken();
      await prisma.apiToken.create({
        data: {
          userId: user.discordId,
          token: hash,
          name: "Web Session",
          scopes: "session",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      return {
        user: {
          discordId: user.discordId,
          username: user.discordUsername,
          avatar: user.discordAvatar,
        },
        sessionToken: token,
      };
    }),

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

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

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
      // eslint-disable-next-line custom-rules/no-type-assertions -- Branded type requires assertion after Zod validation
      const tokenId = input.tokenId as ApiTokenId;
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
});
