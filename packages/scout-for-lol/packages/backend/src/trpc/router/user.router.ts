/**
 * User Router
 *
 * User settings and desktop client management.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  protectedProcedure,
} from "@scout-for-lol/backend/trpc/trpc.ts";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("user-router");

export const userRouter = router({
  /**
   * Get user profile and settings
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { discordId: ctx.user.discordId },
      include: {
        _count: {
          select: {
            soundPacks: true,
            desktopClients: true,
            apiTokens: {
              where: {
                revokedAt: null,
                scopes: { not: "session" },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    return {
      discordId: user.discordId,
      username: user.discordUsername,
      avatar: user.discordAvatar,
      createdAt: user.createdAt,
      stats: {
        soundPacks: user._count.soundPacks,
        desktopClients: user._count.desktopClients,
        apiTokens: user._count.apiTokens,
      },
    };
  }),

  /**
   * List connected desktop clients
   */
  listClients: protectedProcedure.query(async ({ ctx }) => {
    const clients = await prisma.desktopClient.findMany({
      where: { userId: ctx.user.discordId },
      include: { activeSoundPack: true },
      orderBy: { lastHeartbeat: "desc" },
    });

    return clients.map((client) => ({
      id: client.id,
      clientId: client.clientId,
      hostname: client.hostname,
      isConnected: client.isConnected,
      lastHeartbeat: client.lastHeartbeat,
      voiceChannelId: client.voiceChannelId,
      guildId: client.guildId,
      soundPackId: client.activeSoundPackId,
      soundPackName: client.activeSoundPack?.name,
      createdAt: client.createdAt,
    }));
  }),

  /**
   * Disconnect/remove a desktop client
   */
  disconnectClient: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const client = await prisma.desktopClient.findFirst({
        where: {
          clientId: input.clientId,
          userId: ctx.user.discordId,
        },
      });

      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Desktop client not found",
        });
      }

      await prisma.desktopClient.delete({
        where: { id: client.id },
      });

      logger.info(
        `Desktop client disconnected: ${input.clientId} for user ${ctx.user.discordUsername}`,
      );

      return { success: true };
    }),

  /**
   * Get event history for a client
   */
  getEventHistory: protectedProcedure
    .input(
      z.object({
        clientId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const events = await prisma.gameEventLog.findMany({
        where: {
          userId: ctx.user.discordId,
          ...(input.clientId !== undefined && input.clientId.length > 0 ? { clientId: input.clientId } : {}),
        },
        orderBy: { timestamp: "desc" },
        take: input.limit,
      });

      return events.map((event) => ({
        id: event.id,
        clientId: event.clientId,
        eventType: event.eventType,
        eventData: JSON.parse(event.eventData),
        soundPlayed: event.soundPlayed,
        timestamp: event.timestamp,
      }));
    }),

  /**
   * Get available Discord voice channels for configuration
   * This requires the bot to be in the guild
   */
  getVoiceChannels: protectedProcedure
    .input(z.object({ guildId: z.string() }))
    .query(({ input }) => {
      // This would query Discord API for voice channels
      // For now, return empty - will be implemented with Discord client
      // The desktop app will need to provide guild ID from Discord OAuth
      const channels: { id: string; name: string }[] = [];
      return {
        guildId: input.guildId,
        channels,
      };
    }),
});
