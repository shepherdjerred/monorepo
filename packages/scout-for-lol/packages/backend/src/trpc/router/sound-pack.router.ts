/**
 * Sound Pack Router
 *
 * CRUD operations for sound packs.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  protectedProcedure,
} from "@scout-for-lol/backend/trpc/trpc.ts";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import {
  SoundPackSchema,
  SoundPackSettingsSchema,
  DefaultSoundsSchema,
  SoundRuleSchema,
  type SoundPack,
  type SoundPackSettings,
  type DefaultSounds,
  type SoundRule,
  type SoundPackId,
} from "@scout-for-lol/data";
import {
  selectSoundForEvent,
  type EventContext,
} from "@scout-for-lol/backend/sound-engine/index.ts";

const logger = createLogger("soundpack-router");

/**
 * Schema for creating/updating a sound pack (without id)
 */
const SoundPackInputSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().default("1.0.0"),
  description: z.string().max(500).nullish(),
  isPublic: z.boolean().default(false),
  settings: SoundPackSettingsSchema,
  defaults: DefaultSoundsSchema,
  rules: z.array(SoundRuleSchema),
});

/**
 * Parse JSON fields from database into typed SoundPack
 */
function parseSoundPackFromDb(dbPack: {
  id: number;
  userId: string;
  name: string;
  version: string;
  description: string | null;
  isPublic: boolean;
  settings: string;
  defaults: string;
  rules: string;
  createdAt: Date;
  updatedAt: Date;
}): SoundPack & { dbId: number } {
  return {
    dbId: dbPack.id,
    id: dbPack.id.toString(),
    name: dbPack.name,
    version: dbPack.version,
    description: dbPack.description,
    // eslint-disable-next-line custom-rules/no-type-assertions -- JSON.parse returns unknown, type assertion needed for parsed database JSON
    settings: JSON.parse(dbPack.settings) as SoundPackSettings,
    // eslint-disable-next-line custom-rules/no-type-assertions -- JSON.parse returns unknown, type assertion needed for parsed database JSON
    defaults: JSON.parse(dbPack.defaults) as DefaultSounds,
    // eslint-disable-next-line custom-rules/no-type-assertions -- JSON.parse returns unknown, type assertion needed for parsed database JSON
    rules: JSON.parse(dbPack.rules) as SoundRule[],
  };
}

export const soundPackRouter = router({
  /**
   * List user's sound packs
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const packs = await prisma.soundPack.findMany({
      where: {
        OR: [{ userId: ctx.user.discordId }, { isPublic: true }],
      },
      orderBy: { updatedAt: "desc" },
    });

    return packs.map((pack) => ({
      id: pack.id,
      name: pack.name,
      version: pack.version,
      description: pack.description,
      isPublic: pack.isPublic,
      isOwner: pack.userId === ctx.user.discordId,
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
    }));
  }),

  /**
   * Get a single sound pack by ID
   */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      // eslint-disable-next-line custom-rules/no-type-assertions -- Branded type requires assertion after validation
      const soundPackId = input.id as SoundPackId;
      const pack = await prisma.soundPack.findFirst({
        where: {
          id: soundPackId,
          OR: [{ userId: ctx.user.discordId }, { isPublic: true }],
        },
      });

      if (!pack) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sound pack not found",
        });
      }

      return parseSoundPackFromDb(pack);
    }),

  /**
   * Create a new sound pack
   */
  create: protectedProcedure
    .input(SoundPackInputSchema)
    .mutation(async ({ input, ctx }) => {
      // Check for duplicate name
      const existing = await prisma.soundPack.findFirst({
        where: {
          userId: ctx.user.discordId,
          name: input.name,
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A sound pack with this name already exists",
        });
      }

      const pack = await prisma.soundPack.create({
        data: {
          userId: ctx.user.discordId,
          name: input.name,
          version: input.version,
          description: input.description ?? null,
          isPublic: input.isPublic,
          settings: JSON.stringify(input.settings),
          defaults: JSON.stringify(input.defaults),
          rules: JSON.stringify(input.rules),
        },
      });

      logger.info(
        `Sound pack created: ${pack.name} by user ${ctx.user.discordUsername}`,
      );

      return parseSoundPackFromDb(pack);
    }),

  /**
   * Update a sound pack
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        data: SoundPackInputSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // eslint-disable-next-line custom-rules/no-type-assertions -- Branded type requires assertion after validation
      const soundPackId = input.id as SoundPackId;
      const existing = await prisma.soundPack.findFirst({
        where: {
          id: soundPackId,
          userId: ctx.user.discordId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Sound pack not found or you don't have permission to edit it",
        });
      }

      const {
        name,
        version,
        description,
        isPublic,
        settings,
        defaults,
        rules,
      } = input.data;
      const updateData: Record<string, unknown> = {};
      if (name !== undefined) {
        updateData["name"] = name;
      }
      if (version !== undefined) {
        updateData["version"] = version;
      }
      if (description !== undefined) {
        updateData["description"] = description;
      }
      if (isPublic !== undefined) {
        updateData["isPublic"] = isPublic;
      }
      if (settings !== undefined) {
        updateData["settings"] = JSON.stringify(settings);
      }
      if (defaults !== undefined) {
        updateData["defaults"] = JSON.stringify(defaults);
      }
      if (rules !== undefined) {
        updateData["rules"] = JSON.stringify(rules);
      }

      const pack = await prisma.soundPack.update({
        where: { id: soundPackId },
        data: updateData,
      });

      logger.info(`Sound pack updated: ${pack.name}`);

      return parseSoundPackFromDb(pack);
    }),

  /**
   * Delete a sound pack
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // eslint-disable-next-line custom-rules/no-type-assertions -- Branded type requires assertion after validation
      const soundPackId = input.id as SoundPackId;
      const existing = await prisma.soundPack.findFirst({
        where: {
          id: soundPackId,
          userId: ctx.user.discordId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Sound pack not found or you don't have permission to delete it",
        });
      }

      await prisma.soundPack.delete({
        where: { id: soundPackId },
      });

      logger.info(`Sound pack deleted: ${existing.name}`);

      return { success: true };
    }),

  /**
   * Test rule evaluation for an event context
   */
  evaluateRules: protectedProcedure
    .input(
      z.object({
        soundPackId: z.number(),
        context: z.object({
          eventType: z.enum([
            "gameStart",
            "gameEnd",
            "firstBlood",
            "kill",
            "multiKill",
            "objective",
            "ace",
          ]),
          killerName: z.string().optional(),
          victimName: z.string().optional(),
          killerChampion: z.string().optional(),
          victimChampion: z.string().optional(),
          killerIsLocal: z.boolean().default(false),
          victimIsLocal: z.boolean().default(false),
          multikillType: z
            .enum(["double", "triple", "quadra", "penta"])
            .optional(),
          objectiveType: z
            .enum(["tower", "inhibitor", "dragon", "baron", "herald"])
            .optional(),
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
          isStolen: z.boolean().default(false),
          isAllyTeam: z.boolean().default(true),
          gameResult: z.enum(["victory", "defeat"]).optional(),
          localPlayerName: z.string().optional(),
        }),
      }),
    )
    .query(async ({ input, ctx }) => {
      // eslint-disable-next-line custom-rules/no-type-assertions -- Branded type requires assertion after validation
      const soundPackId = input.soundPackId as SoundPackId;
      const pack = await prisma.soundPack.findFirst({
        where: {
          id: soundPackId,
          OR: [{ userId: ctx.user.discordId }, { isPublic: true }],
        },
      });

      if (!pack) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sound pack not found",
        });
      }

      const soundPack = parseSoundPackFromDb(pack);
      const context: EventContext = input.context;
      const result = selectSoundForEvent(soundPack, context);

      if (!result) {
        return { sound: null, ruleName: null };
      }

      return {
        sound: result.sound,
        volume: result.volume,
        ruleName: result.ruleName,
      };
    }),

  /**
   * Import a sound pack from JSON
   */
  import: protectedProcedure
    .input(SoundPackSchema)
    .mutation(async ({ input, ctx }) => {
      // Generate a unique name if needed
      let name = input.name;
      let suffix = 1;

      while (
        await prisma.soundPack.findFirst({
          where: { userId: ctx.user.discordId, name },
        })
      ) {
        name = `${input.name} (${String(suffix++)})`;
      }

      const pack = await prisma.soundPack.create({
        data: {
          userId: ctx.user.discordId,
          name,
          version: input.version,
          description: input.description ?? null,
          isPublic: false,
          settings: JSON.stringify(input.settings),
          defaults: JSON.stringify(input.defaults),
          rules: JSON.stringify(input.rules),
        },
      });

      logger.info(
        `Sound pack imported: ${pack.name} by user ${ctx.user.discordUsername}`,
      );

      return parseSoundPackFromDb(pack);
    }),

  /**
   * Export a sound pack as JSON
   */
  export: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      // eslint-disable-next-line custom-rules/no-type-assertions -- Branded type requires assertion after validation
      const soundPackId = input.id as SoundPackId;
      const pack = await prisma.soundPack.findFirst({
        where: {
          id: soundPackId,
          OR: [{ userId: ctx.user.discordId }, { isPublic: true }],
        },
      });

      if (!pack) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sound pack not found",
        });
      }

      return parseSoundPackFromDb(pack);
    }),
});
