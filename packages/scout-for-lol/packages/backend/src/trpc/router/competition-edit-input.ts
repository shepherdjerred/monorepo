import { z } from "zod";
import {
  CompetitionCriteriaSchema,
  CompetitionIdSchema,
  CompetitionVisibilitySchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  SeasonIdSchema,
} from "@scout-for-lol/data";
import { CompetitionDatesSchema } from "#src/database/competition/validation.ts";
import type { UpdateCompetitionInput } from "#src/database/competition/queries.ts";

/**
 * Web date input. The tRPC link carries no superjson transformer, so `Date`s
 * arrive as ISO strings — coerce them, then the existing duration/ordering
 * rules apply via `CompetitionDatesSchema.parse` in the handler.
 */
export const WebCompetitionDatesSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("FIXED_DATES"),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  }),
  z.object({ type: z.literal("SEASON"), seasonId: SeasonIdSchema }),
]);

export const CompetitionEditInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  competitionId: CompetitionIdSchema,
  channelId: DiscordChannelIdSchema.optional(),
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  visibility: CompetitionVisibilitySchema.optional(),
  maxParticipants: z.number().int().min(2).max(100).optional(),
  dates: WebCompetitionDatesSchema.optional(),
  criteria: CompetitionCriteriaSchema.optional(),
});

/**
 * Build the sparse update payload — only the keys the caller actually provided,
 * as required by exactOptionalPropertyTypes.
 */
export function buildCompetitionUpdateInput(
  input: z.infer<typeof CompetitionEditInputSchema>,
): UpdateCompetitionInput {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.maxParticipants === undefined
      ? {}
      : { maxParticipants: input.maxParticipants }),
    ...(input.dates === undefined
      ? {}
      : { dates: CompetitionDatesSchema.parse(input.dates) }),
    ...(input.criteria === undefined ? {} : { criteria: input.criteria }),
  };
}
