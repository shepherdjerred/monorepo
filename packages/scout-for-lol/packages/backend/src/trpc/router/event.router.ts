/**
 * Event Router
 *
 * Handles game events from desktop clients and triggers sound playback.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  desktopClientProcedure,
} from "@scout-for-lol/backend/trpc/trpc.ts";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import {
  selectSoundForEvent,
  type EventContext,
} from "@scout-for-lol/backend/sound-engine/index.ts";
import { voiceManager } from "@scout-for-lol/backend/voice/index.ts";
import {
  SoundPackSettingsSchema,
  DefaultSoundsSchema,
  SoundRuleSchema,
  SoundPackIdSchema,
  type SoundPack,
} from "@scout-for-lol/data";

const logger = createLogger("event-router");

/**
 * Player info in a game
 */
const PlayerSchema = z.object({
  summonerName: z.string(),
  championName: z.string(),
  team: z.string(),
});

/**
 * Schema for game events from Desktop client
 */
const GameEventSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("gameStart"),
    gameMode: z.string(),
    mapName: z.string(),
    localPlayerName: z.string(),
    localPlayerTeam: z.string(),
    players: z.array(PlayerSchema),
  }),
  z.object({
    eventType: z.literal("kill"),
    killerName: z.string(),
    victimName: z.string(),
    killerChampion: z.string().optional(),
    victimChampion: z.string().optional(),
    localPlayerName: z.string(),
    localPlayerTeam: z.string(),
    killerTeam: z.string(),
    gameTime: z.number(),
    isFirstBlood: z.boolean().optional(),
  }),
  z.object({
    eventType: z.literal("multiKill"),
    killerName: z.string(),
    killerChampion: z.string().optional(),
    killCount: z.number().min(2).max(5),
    localPlayerName: z.string(),
    localPlayerTeam: z.string(),
    killerTeam: z.string(),
    gameTime: z.number(),
  }),
  z.object({
    eventType: z.literal("objective"),
    objectiveType: z.enum(["dragon", "baron", "herald", "tower", "inhibitor"]),
    killerName: z.string().optional(),
    dragonType: z
      .enum([
        "infernal",
        "mountain",
        "ocean",
        "cloud",
        "hextech",
        "chemtech",
        "elder",
      ])
      .optional(),
    isStolen: z.boolean().optional(),
    team: z.enum(["ally", "enemy"]),
    localPlayerName: z.string(),
    gameTime: z.number(),
  }),
  z.object({
    eventType: z.literal("ace"),
    acingTeam: z.string(),
    localPlayerTeam: z.string(),
    gameTime: z.number(),
  }),
  z.object({
    eventType: z.literal("gameEnd"),
    result: z.enum(["victory", "defeat"]),
    gameDuration: z.number(),
  }),
  z.object({
    eventType: z.literal("firstBlood"),
    killerName: z.string(),
    victimName: z.string(),
    killerChampion: z.string().optional(),
    victimChampion: z.string().optional(),
    localPlayerName: z.string(),
    localPlayerTeam: z.string(),
    killerTeam: z.string(),
    gameTime: z.number(),
  }),
]);

type GameEvent = z.infer<typeof GameEventSchema>;

/**
 * Convert a game event to an EventContext for rule evaluation
 */
function gameEventToContext(event: GameEvent): EventContext {
  switch (event.eventType) {
    case "gameStart":
      return {
        eventType: "gameStart",
        killerIsLocal: false,
        victimIsLocal: false,
        isStolen: false,
        isAllyTeam: true,
        localPlayerName: event.localPlayerName,
      };

    case "kill":
      return {
        eventType: event.isFirstBlood === true ? "firstBlood" : "kill",
        killerName: event.killerName,
        victimName: event.victimName,
        killerChampion: event.killerChampion,
        victimChampion: event.victimChampion,
        killerIsLocal: event.killerName === event.localPlayerName,
        victimIsLocal: event.victimName === event.localPlayerName,
        isAllyTeam: event.killerTeam === event.localPlayerTeam,
        isStolen: false,
        localPlayerName: event.localPlayerName,
      };

    case "firstBlood":
      return {
        eventType: "firstBlood",
        killerName: event.killerName,
        victimName: event.victimName,
        killerChampion: event.killerChampion,
        victimChampion: event.victimChampion,
        killerIsLocal: event.killerName === event.localPlayerName,
        victimIsLocal: event.victimName === event.localPlayerName,
        isAllyTeam: event.killerTeam === event.localPlayerTeam,
        isStolen: false,
        localPlayerName: event.localPlayerName,
      };

    case "multiKill": {
      const multikillTypes = ["double", "triple", "quadra", "penta"] as const;
      return {
        eventType: "multiKill",
        killerName: event.killerName,
        killerChampion: event.killerChampion,
        killerIsLocal: event.killerName === event.localPlayerName,
        victimIsLocal: false,
        isAllyTeam: event.killerTeam === event.localPlayerTeam,
        multikillType: multikillTypes[event.killCount - 2],
        isStolen: false,
        localPlayerName: event.localPlayerName,
      };
    }

    case "objective":
      return {
        eventType: "objective",
        killerName: event.killerName,
        objectiveType: event.objectiveType,
        dragonType: event.dragonType,
        isStolen: event.isStolen ?? false,
        isAllyTeam: event.team === "ally",
        killerIsLocal: false,
        victimIsLocal: false,
        localPlayerName: event.localPlayerName,
      };

    case "ace":
      return {
        eventType: "ace",
        killerIsLocal: false,
        victimIsLocal: false,
        isStolen: false,
        isAllyTeam: event.acingTeam === event.localPlayerTeam,
      };

    case "gameEnd":
      return {
        eventType: "gameEnd",
        killerIsLocal: false,
        victimIsLocal: false,
        isStolen: false,
        isAllyTeam: true,
        gameResult: event.result,
      };
  }
}

/**
 * Parse sound pack from database
 */
function parseSoundPack(dbPack: {
  id: number;
  name: string;
  settings: string;
  defaults: string;
  rules: string;
}): SoundPack {
  return {
    id: dbPack.id.toString(),
    name: dbPack.name,
    version: "1.0.0",
    settings: SoundPackSettingsSchema.parse(JSON.parse(dbPack.settings)),
    defaults: DefaultSoundsSchema.parse(JSON.parse(dbPack.defaults)),
    rules: z.array(SoundRuleSchema).parse(JSON.parse(dbPack.rules)),
  };
}

export const eventRouter = router({
  /**
   * Submit a game event from desktop client
   * This triggers sound playback in Discord voice channel
   */
  submit: desktopClientProcedure
    .input(GameEventSchema)
    .mutation(async ({ input, ctx }) => {
      logger.debug(`Event received: ${input.eventType}`, {
        userId: ctx.user.discordId,
      });

      // Get the desktop client's configuration
      const client = await prisma.desktopClient.findFirst({
        where: { userId: ctx.user.discordId },
        include: { activeSoundPack: true },
      });

      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Desktop client not configured. Please configure voice channel and sound pack first.",
        });
      }

      if (client.voiceChannelId === null || client.guildId === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Voice channel not configured for desktop client",
        });
      }

      if (!client.activeSoundPack) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Sound pack not configured for desktop client",
        });
      }

      // Convert event to context
      const context = gameEventToContext(input);

      // Parse sound pack and evaluate rules
      const soundPack = parseSoundPack(client.activeSoundPack);
      const selection = selectSoundForEvent(soundPack, context);

      if (!selection) {
        logger.debug(`No sound matched for event ${input.eventType}`);
        return { soundPlayed: null };
      }

      // Play the sound in Discord voice channel
      try {
        await voiceManager.ensureConnected(
          client.guildId,
          client.voiceChannelId,
        );
        await voiceManager.playSound(
          client.guildId,
          selection.sound.source,
          selection.volume,
        );

        logger.info(
          `Played sound '${selection.sound.id}' for event ${input.eventType}`,
          {
            userId: ctx.user.discordId,
            ruleName: selection.ruleName,
          },
        );

        // Log the event
        await prisma.gameEventLog.create({
          data: {
            userId: ctx.user.discordId,
            clientId: client.clientId,
            eventType: input.eventType,
            eventData: JSON.stringify(input),
            soundPlayed: selection.sound.id,
          },
        });

        return {
          soundPlayed: selection.sound.id,
          ruleName: selection.ruleName,
          volume: selection.volume,
        };
      } catch (error) {
        logger.error("Failed to play sound", {
          error,
          userId: ctx.user.discordId,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to play sound in voice channel",
        });
      }
    }),

  /**
   * Heartbeat from desktop client to update connection status
   */
  heartbeat: desktopClientProcedure
    .input(
      z.object({
        clientId: z.uuid(),
        inGame: z.boolean(),
        gameId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await prisma.desktopClient.upsert({
        where: { clientId: input.clientId },
        update: {
          isConnected: true,
          lastHeartbeat: new Date(),
          ...(input.gameId !== undefined && { currentGameId: input.gameId }),
        },
        create: {
          userId: ctx.user.discordId,
          clientId: input.clientId,
          isConnected: true,
          lastHeartbeat: new Date(),
          ...(input.gameId !== undefined && { currentGameId: input.gameId }),
        },
      });

      return { success: true };
    }),

  /**
   * Configure desktop client settings
   */
  configure: desktopClientProcedure
    .input(
      z.object({
        clientId: z.uuid(),
        voiceChannelId: z.string().optional(),
        guildId: z.string().optional(),
        soundPackId: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Verify sound pack access if provided
      if (input.soundPackId !== undefined) {
        const soundPackId = SoundPackIdSchema.parse(input.soundPackId);
        const pack = await prisma.soundPack.findFirst({
          where: {
            id: soundPackId,
            OR: [{ userId: ctx.user.discordId }, { isPublic: true }],
          },
        });

        if (!pack) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sound pack not found or you don't have access to it",
          });
        }
      }

      const client = await prisma.desktopClient.upsert({
        where: { clientId: input.clientId },
        update: {
          ...(input.voiceChannelId !== undefined && {
            voiceChannelId: input.voiceChannelId,
          }),
          ...(input.guildId !== undefined && { guildId: input.guildId }),
          ...(input.soundPackId !== undefined && {
            activeSoundPackId: input.soundPackId,
          }),
        },
        create: {
          userId: ctx.user.discordId,
          clientId: input.clientId,
          ...(input.voiceChannelId !== undefined && {
            voiceChannelId: input.voiceChannelId,
          }),
          ...(input.guildId !== undefined && { guildId: input.guildId }),
          ...(input.soundPackId !== undefined && {
            activeSoundPackId: input.soundPackId,
          }),
        },
      });

      logger.info(
        `Desktop client configured for user ${ctx.user.discordUsername}`,
        {
          voiceChannelId: client.voiceChannelId,
          soundPackId: client.activeSoundPackId,
        },
      );

      return {
        clientId: client.clientId,
        voiceChannelId: client.voiceChannelId,
        guildId: client.guildId,
        soundPackId: client.activeSoundPackId,
      };
    }),

  /**
   * Get desktop client configuration
   */
  getConfig: desktopClientProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      const client = await prisma.desktopClient.findFirst({
        where: {
          clientId: input.clientId,
          userId: ctx.user.discordId,
        },
        include: { activeSoundPack: true },
      });

      if (!client) {
        return null;
      }

      return {
        clientId: client.clientId,
        voiceChannelId: client.voiceChannelId,
        guildId: client.guildId,
        soundPackId: client.activeSoundPackId,
        soundPackName: client.activeSoundPack?.name,
        isConnected: client.isConnected,
        lastHeartbeat: client.lastHeartbeat,
      };
    }),
});
