import { z } from "zod";
import { MatchIdSchema } from "#src/model/matches/match.ts";
import { LeaguePuuidSchema } from "#src/model/riot/league-account.ts";

export const ExploreLoadoutCardSizeSchema = z.enum(["S", "L"]);
export type ExploreLoadoutCardSize = z.infer<
  typeof ExploreLoadoutCardSizeSchema
>;

export const ExploreLoadoutCardRequestSchema = z
  .object({
    matchId: MatchIdSchema,
    puuid: LeaguePuuidSchema,
    size: ExploreLoadoutCardSizeSchema,
  })
  .strict();
export type ExploreLoadoutCardRequest = z.infer<
  typeof ExploreLoadoutCardRequestSchema
>;

export const ExploreLoadoutCardRequestsSchema = z
  .array(ExploreLoadoutCardRequestSchema)
  .max(3)
  .superRefine((cards, context) => {
    const pairs = new Set(
      cards.map((card) => JSON.stringify([card.matchId, card.puuid])),
    );
    if (pairs.size !== cards.length) {
      context.addIssue({
        code: "custom",
        message: "A participant can appear in an answer only once.",
      });
    }
  });

const NamedRuneSchema = z
  .object({
    id: z.number().int().positive(),
    assetKey: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
  })
  .strict();

const NamedTreeSchema = NamedRuneSchema;

const ExploreLoadoutItemSchema = z
  .object({
    slot: z.number().int().min(0).max(6),
    itemId: z.number().int().positive().nullable(),
    name: z.string().min(1).max(120).nullable(),
  })
  .strict();

const ExploreLoadoutSpellSchema = z
  .object({
    slot: z.number().int().min(1).max(2),
    spellId: z.string().min(1).max(120).nullable(),
    name: z.string().min(1).max(120).nullable(),
  })
  .strict();

const ExploreLoadoutRunePageSchema = z
  .object({
    primaryTree: NamedTreeSchema.nullable(),
    keystone: NamedRuneSchema.nullable(),
    primaryRunes: z.array(NamedRuneSchema).max(3),
    secondaryTree: NamedTreeSchema.nullable(),
    secondaryRunes: z.array(NamedRuneSchema).max(2),
    shards: z
      .array(
        z
          .object({
            slot: z.enum(["offense", "flex", "defense"]),
            id: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .length(3),
  })
  .strict();

const ExploreBuildPathEventSchema = z
  .object({
    minute: z.number().int().nonnegative(),
    itemId: z.number().int().positive(),
    name: z.string().min(1).max(120).nullable(),
    kind: z.enum(["purchase", "sold"]),
  })
  .strict();

const ExploreSkillOrderEntrySchema = z
  .object({
    level: z.number().int().min(1).max(18),
    skill: z.enum(["Q", "W", "E", "R"]),
  })
  .strict();

export const ExploreLoadoutCardSchema = z
  .object({
    size: ExploreLoadoutCardSizeSchema,
    matchId: MatchIdSchema,
    participantId: z.number().int().positive(),
    championId: z.number().int().positive(),
    championName: z.string().min(1).max(100),
    gameDurationSeconds: z.number().int().nonnegative(),
    finalItems: z.array(ExploreLoadoutItemSchema).length(7),
    spells: z.array(ExploreLoadoutSpellSchema).length(2),
    runePage: ExploreLoadoutRunePageSchema,
    buildPathRecorded: z.boolean(),
    buildPath: z.array(ExploreBuildPathEventSchema).max(100),
    skillOrder: z.array(ExploreSkillOrderEntrySchema).max(18),
  })
  .strict();
export type ExploreLoadoutCard = z.infer<typeof ExploreLoadoutCardSchema>;
