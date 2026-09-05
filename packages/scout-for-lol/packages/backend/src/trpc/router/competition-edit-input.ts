import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  CompetitionDescriptionSchema,
  CompetitionMaxParticipantsSchema,
  CompetitionTitleSchema,
  CompetitionCriteriaSchema,
  CompetitionIdSchema,
  CompetitionGameVariantSchema,
  CompetitionVisibilitySchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  WebCompetitionDatesSchema,
  getCompetitionStatus,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import { CompetitionDatesSchema } from "#src/database/competition/competition-dates.ts";
import type { UpdateCompetitionInput } from "#src/database/competition/queries.ts";
import { ReportScheduleTimezoneSchema } from "@scout-for-lol/data/model/competition-cron.ts";

export const CompetitionEditInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  competitionId: CompetitionIdSchema,
  channelId: DiscordChannelIdSchema.optional(),
  title: CompetitionTitleSchema.optional(),
  description: CompetitionDescriptionSchema.optional(),
  gameVariant: CompetitionGameVariantSchema.optional(),
  visibility: CompetitionVisibilitySchema.optional(),
  maxParticipants: CompetitionMaxParticipantsSchema.optional(),
  dates: WebCompetitionDatesSchema.optional(),
  criteria: CompetitionCriteriaSchema.optional(),
  analysisTimezone: ReportScheduleTimezoneSchema.optional(),
});

export type CompetitionEditInput = z.infer<typeof CompetitionEditInputSchema>;

export function assertCompetitionEditable(
  competition: CompetitionWithCriteria,
  input: CompetitionEditInput,
): void {
  const status = getCompetitionStatus(competition);
  if (status === "CANCELLED" || status === "ENDED") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `A ${status} competition cannot be edited.`,
    });
  }

  const changesCriteriaOrDates =
    input.criteria !== undefined ||
    input.dates !== undefined ||
    input.gameVariant !== undefined;
  if (status === "ACTIVE" && changesCriteriaOrDates) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Criteria and dates are locked once a competition is active — they would invalidate snapshots and the lifecycle schedule.",
    });
  }
  if (
    status === "ACTIVE" &&
    input.maxParticipants !== undefined &&
    input.maxParticipants < competition.maxParticipants
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Participant cap can only be increased while a competition is active.",
    });
  }
}

/**
 * Build the sparse update payload — only the keys the caller actually provided,
 * as required by exactOptionalPropertyTypes.
 */
export function buildCompetitionUpdateInput(
  input: CompetitionEditInput,
): UpdateCompetitionInput {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    ...(input.gameVariant === undefined
      ? {}
      : { gameVariant: input.gameVariant }),
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.maxParticipants === undefined
      ? {}
      : { maxParticipants: input.maxParticipants }),
    ...(input.dates === undefined
      ? {}
      : { dates: CompetitionDatesSchema.parse(input.dates) }),
    ...(input.criteria === undefined ? {} : { criteria: input.criteria }),
    ...(input.analysisTimezone === undefined
      ? {}
      : { analysisTimezone: input.analysisTimezone }),
  };
}
