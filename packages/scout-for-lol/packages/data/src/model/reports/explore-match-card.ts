import { z } from "zod";
import { MatchIdSchema } from "#src/model/matches/match.ts";

export const ExploreMatchCardSizeSchema = z.enum(["S", "M", "L"]);
export type ExploreMatchCardSize = z.infer<typeof ExploreMatchCardSizeSchema>;

export const ExploreMatchCardRequestSchema = z
  .object({
    matchId: MatchIdSchema,
    size: ExploreMatchCardSizeSchema,
  })
  .strict();
export type ExploreMatchCardRequest = z.infer<
  typeof ExploreMatchCardRequestSchema
>;

export const ExploreMatchCardRequestsSchema = z
  .array(ExploreMatchCardRequestSchema)
  .max(5)
  .superRefine((cards, context) => {
    const matchIds = new Set(cards.map((card) => card.matchId));
    if (matchIds.size !== cards.length) {
      context.addIssue({
        code: "custom",
        message: "A match can appear in an answer only once.",
      });
    }
    if (cards.filter((card) => card.size === "L").length > 1) {
      context.addIssue({
        code: "custom",
        message: "An answer can contain at most one large match card.",
      });
    }
  });

const RiotIdSchema = z
  .object({
    gameName: z.string().min(1).max(100).nullable(),
    tagLine: z.string().min(1).max(100).nullable(),
  })
  .strict();

const ObjectivesSchema = z
  .object({
    turrets: z.number().int().nonnegative(),
    inhibitors: z.number().int().nonnegative(),
    barons: z.number().int().nonnegative(),
    dragons: z.number().int().nonnegative(),
  })
  .strict();

const ExploreMatchCardParticipantSchema = z
  .object({
    participantId: z.number().int().positive(),
    riotId: RiotIdSchema,
    championId: z.number().int().positive(),
    championName: z.string().min(1).max(100),
    position: z.string().max(100),
    kills: z.number().int().nonnegative(),
    deaths: z.number().int().nonnegative(),
    assists: z.number().int().nonnegative(),
    creepScore: z.number().int().nonnegative(),
    goldEarned: z.number().int().nonnegative(),
    visionScore: z.number().int().nonnegative(),
    damageToChampions: z.number().int().nonnegative(),
    killParticipation: z.number().min(0).nullable(),
    damageShare: z.number().min(0).nullable(),
    objectives: ObjectivesSchema,
  })
  .strict();

const ExploreMatchCardTeamSchema = z
  .object({
    teamId: z.number().int().positive(),
    win: z.boolean(),
    kills: z.number().int().nonnegative(),
    objectives: ObjectivesSchema,
    participants: z.array(ExploreMatchCardParticipantSchema).min(1).max(18),
  })
  .strict();

export const ExploreMatchSnapshotSchema = z
  .object({
    matchId: MatchIdSchema,
    gameCreationMs: z.number().int().nonnegative(),
    gameDurationSeconds: z.number().int().nonnegative(),
    queue: z.string().min(1).max(200).nullable(),
    queueId: z.number().int().nonnegative(),
    gameMode: z.string().min(1).max(100),
    gameType: z.string().min(1).max(100),
    gameVersion: z.string().min(1).max(100),
    mapId: z.number().int().nonnegative(),
    teams: z.array(ExploreMatchCardTeamSchema).min(2).max(18),
  })
  .strict();
export type ExploreMatchSnapshot = z.infer<typeof ExploreMatchSnapshotSchema>;

/** A frozen, source-backed match artifact rendered inside an Explore turn. */
export const ExploreMatchCardSchema = z
  .object({
    size: ExploreMatchCardSizeSchema,
    match: ExploreMatchSnapshotSchema,
  })
  .strict();
export type ExploreMatchCard = z.infer<typeof ExploreMatchCardSchema>;
