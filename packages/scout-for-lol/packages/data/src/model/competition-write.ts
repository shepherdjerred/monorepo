import { z } from "zod";
import {
  CompetitionCriteriaSchema,
  CompetitionGameVariantSchema,
  CompetitionVisibilitySchema,
  PlayerIdSchema,
} from "#src/model/competition.ts";
import {
  CompetitionScheduledUpdatesSchema,
  DEFAULT_COMPETITION_CRON,
  DEFAULT_SCHEDULE_TIMEZONE,
  ReportScheduleTimezoneSchema,
} from "#src/model/competition-cron.ts";
import { DiscordChannelIdSchema } from "#src/model/discord.ts";
import {
  CompetitionDescriptionSchema,
  CompetitionMaxParticipantsSchema,
  CompetitionTitleSchema,
} from "#src/model/form-inputs.ts";
import { SeasonIdSchema } from "#src/seasons.ts";

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

export type WebCompetitionDates = z.infer<typeof WebCompetitionDatesSchema>;

/**
 * Everything a caller supplies to create a competition, minus the guild it
 * belongs to and the acting owner (both come from the authenticated caller).
 *
 * Shared rather than router-local because the competition create pipeline has
 * more than one entry point: the dashboard form posts it directly, and a
 * prepared confirmation intent carries the same payload for a human to
 * approve. Both must describe the same competition, so the shape lives here
 * next to the other competition models.
 */
export const CompetitionWriteSchema = z.object({
  channelId: DiscordChannelIdSchema,
  title: CompetitionTitleSchema,
  description: CompetitionDescriptionSchema,
  visibility: CompetitionVisibilitySchema,
  maxParticipants: CompetitionMaxParticipantsSchema.default(100),
  gameVariant: CompetitionGameVariantSchema.default("MODERN"),
  dates: WebCompetitionDatesSchema,
  criteria: CompetitionCriteriaSchema,
  initialPlayerIds: z.array(PlayerIdSchema).max(100).default([]),
  analysisTimezone: ReportScheduleTimezoneSchema.default(
    DEFAULT_SCHEDULE_TIMEZONE,
  ),
  scheduledUpdates: CompetitionScheduledUpdatesSchema.default({
    enabled: false,
    cronExpression: DEFAULT_COMPETITION_CRON,
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
  }),
});

export type CompetitionWrite = z.infer<typeof CompetitionWriteSchema>;
