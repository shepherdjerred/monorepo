import { z } from "zod";
import {
  CompetitionDescriptionSchema,
  CompetitionConfigurationSchema,
  CompetitionGameVariantSchema,
  CompetitionMaxParticipantsSchema,
  CompetitionQueueTypeSchema,
  CompetitionTitleSchema,
  CompetitionVisibilitySchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  ExploreConversationTitleSchema,
  ExploreQuestionSchema,
  FeedbackBodySchema,
  PlayerAliasSchema,
  PlayerIdSchema,
  PermissionSchema,
  RegionSchema,
  ReportDescriptionSchema,
  ReportAiEditRequestSchema,
  ReportQueryTextSchema,
  ReportTitleSchema,
  RankAggregationSchema,
  RoleSchema,
  RiotIdSchema,
  SeasonIdSchema,
  SubscriptionFilterSpecSchema,
} from "@scout-for-lol/data";
import {
  CompetitionCronSchema,
  CompetitionScheduledUpdatesSchema,
  ReportScheduleTimezoneSchema,
} from "@scout-for-lol/data/model/competition-cron.ts";

export const RiotIdTextSchema = z.string().superRefine((value, context) => {
  const parsed = RiotIdSchema.safeParse(value);
  if (!parsed.success) {
    context.addIssue({
      code: "custom",
      message: "Enter a Riot ID in the form game_name#TAG.",
    });
  }
});

export const AddAccountFormSchema = z.object({
  riotId: RiotIdTextSchema,
  region: RegionSchema,
});

export const EditAccountFormSchema = z.object({
  alias: PlayerAliasSchema,
  region: RegionSchema,
});

export const PlayerAliasFormSchema = z.object({ alias: PlayerAliasSchema });

export const DiscordUserFormSchema = z.object({
  discordUserId: DiscordAccountIdSchema,
});

export const GuildAccessRoleSchema = z.object({
  role: z.union([RoleSchema, z.literal("custom")]),
});

export const GuildCustomPermissionsSchema = z.object({
  permissions: z
    .array(PermissionSchema)
    .min(1, "Choose at least one permission."),
});

export const GuildAccessFormSchema = z
  .object({
    discordUserId: DiscordAccountIdSchema,
    role: GuildAccessRoleSchema.shape.role,
    permissions: z.array(PermissionSchema),
  })
  .superRefine((value, context) => {
    if (value.role === "custom" && value.permissions.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["permissions"],
        message: "Choose at least one custom permission.",
      });
    }
  });

export type GuildAccessFormValue = z.input<typeof GuildAccessFormSchema>;

export function emptyGuildAccessFormValue(): GuildAccessFormValue {
  return { discordUserId: "", role: "viewer", permissions: [] };
}

export const FeedbackFormSchema = z.object({ body: FeedbackBodySchema });

export const ExploreQuestionFormSchema = z.object({
  question: ExploreQuestionSchema,
});

export const ExploreConversationTitleFormSchema = z.object({
  title: ExploreConversationTitleSchema,
});

export const SubscriptionFormSchema = z.object({
  channelId: DiscordChannelIdSchema,
  region: RegionSchema,
  riotId: RiotIdTextSchema,
  alias: PlayerAliasSchema,
  discordUserId: z.union([z.literal(""), DiscordAccountIdSchema]),
  filters: SubscriptionFilterSpecSchema.nullable(),
});

export const SubscriptionChannelFormSchema = z.object({
  channelId: DiscordChannelIdSchema,
});

export const SubscriptionFiltersFormSchema = z.object({
  channelId: DiscordChannelIdSchema,
  filters: SubscriptionFilterSpecSchema.nullable(),
});

export type SubscriptionFiltersFormValue = z.input<
  typeof SubscriptionFiltersFormSchema
>;

export function emptySubscriptionFiltersFormValue(
  channelId: string,
): SubscriptionFiltersFormValue {
  return { channelId, filters: null };
}

export type SubscriptionFormValue = z.input<typeof SubscriptionFormSchema>;

export function emptySubscriptionFormValue(
  channelId: string,
): SubscriptionFormValue {
  return {
    channelId,
    region: "AMERICA_NORTH",
    riotId: "",
    alias: "",
    discordUserId: "",
    filters: null,
  };
}

export const ReportFormValueSchema = z.object({
  title: ReportTitleSchema,
  description: ReportDescriptionSchema,
  channelId: DiscordChannelIdSchema,
  queryText: ReportQueryTextSchema,
  cronExpression: CompetitionCronSchema,
  scheduleTimezone: ReportScheduleTimezoneSchema,
});

export const ReportAiInstructionsFormSchema = z.object({
  instructions: ReportAiEditRequestSchema.shape.instructions,
});

export type ReportFormValue = z.input<typeof ReportFormValueSchema>;

const IntegerInputSchema = z
  .string()
  .trim()
  .regex(/^\d+$/u, "Enter a whole number.");

export const CompetitionDatesFormSchema = z
  .object({
    mode: z.enum(["FIXED_DATES", "SEASON"]),
    startDate: z.string(),
    endDate: z.string(),
    seasonId: z.string(),
  })
  .superRefine((dates, context) => {
    if (dates.mode === "SEASON") {
      const season = SeasonIdSchema.safeParse(dates.seasonId);
      if (!season.success) {
        context.addIssue({
          code: "custom",
          path: ["seasonId"],
          message: "Pick a season.",
        });
      }
      return;
    }

    const start = z.iso.date().safeParse(dates.startDate);
    const end = z.iso.date().safeParse(dates.endDate);
    if (!start.success) {
      context.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "Pick a start date.",
      });
    }
    if (!end.success) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Pick an end date.",
      });
    }
    if (
      start.success &&
      end.success &&
      new Date(start.data) > new Date(end.data)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be after the start date.",
      });
    }
  });

export const CompetitionCriteriaFormSchema = z.object({
  criteriaType: z.enum([
    "MOST_GAMES_PLAYED",
    "MOST_WINS_PLAYER",
    "MOST_WINS_CHAMPION",
    "HIGHEST_WIN_RATE",
    "HIGHEST_RANK",
    "MOST_RANK_CLIMB",
  ]),
  queues: z
    .array(CompetitionQueueTypeSchema)
    .min(1, "Choose at least one queue."),
  aggregation: RankAggregationSchema,
  championId: z.string(),
  minGames: z.string(),
});

export const CompetitionFormValueSchema = z
  .object({
    title: CompetitionTitleSchema,
    description: CompetitionDescriptionSchema,
    channelId: DiscordChannelIdSchema,
    visibility: CompetitionVisibilitySchema,
    maxParticipants: IntegerInputSchema,
    gameVariant: CompetitionGameVariantSchema,
    analysisTimezone: ReportScheduleTimezoneSchema,
    dates: CompetitionDatesFormSchema,
    criteria: CompetitionCriteriaFormSchema,
  })
  .superRefine((value, context) => {
    const participants = IntegerInputSchema.safeParse(value.maxParticipants);
    if (participants.success) {
      const parsed = CompetitionMaxParticipantsSchema.safeParse(
        Number(participants.data),
      );
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({
            code: "custom",
            path: ["maxParticipants"],
            message: issue.message,
          });
        }
      }
    }

    if (value.criteria.criteriaType === "MOST_WINS_CHAMPION") {
      const championId = IntegerInputSchema.safeParse(
        value.criteria.championId,
      );
      if (!championId.success || Number(value.criteria.championId) < 1) {
        context.addIssue({
          code: "custom",
          path: ["criteria", "championId"],
          message: "Pick a champion.",
        });
      }
    }
    if (value.criteria.criteriaType === "HIGHEST_WIN_RATE") {
      const minGames = IntegerInputSchema.safeParse(value.criteria.minGames);
      if (!minGames.success || Number(value.criteria.minGames) < 1) {
        context.addIssue({
          code: "custom",
          path: ["criteria", "minGames"],
          message: "Minimum games must be a positive whole number.",
        });
      }
    }

    const rawCriteria =
      value.criteria.criteriaType === "MOST_WINS_CHAMPION"
        ? {
            type: value.criteria.criteriaType,
            championId: Number(value.criteria.championId),
            queues: value.criteria.queues,
          }
        : value.criteria.criteriaType === "HIGHEST_WIN_RATE"
          ? {
              type: value.criteria.criteriaType,
              minGames: Number(value.criteria.minGames),
              queues: value.criteria.queues,
            }
          : value.criteria.criteriaType === "HIGHEST_RANK" ||
              value.criteria.criteriaType === "MOST_RANK_CLIMB"
            ? {
                type: value.criteria.criteriaType,
                queues: value.criteria.queues,
                aggregation: value.criteria.aggregation,
              }
            : {
                type: value.criteria.criteriaType,
                queues: value.criteria.queues,
              };
    if (
      !CompetitionConfigurationSchema.safeParse({
        gameVariant: value.gameVariant,
        criteria: rawCriteria,
      }).success
    ) {
      context.addIssue({
        code: "custom",
        path: ["criteria", "queues"],
        message: "Choose queues and scoring compatible with the game version.",
      });
    }
  });

export type CompetitionFormValue = z.input<typeof CompetitionFormValueSchema>;

export const CompetitionBuilderFormValueSchema =
  CompetitionFormValueSchema.safeExtend({
    initialPlayerIds: z.array(PlayerIdSchema).max(100),
    scheduledUpdates: CompetitionScheduledUpdatesSchema,
  });

export type CompetitionBuilderFormValue = z.input<
  typeof CompetitionBuilderFormValueSchema
>;

export const CompetitionAnalysisTimezoneFormSchema = z.object({
  timezone: ReportScheduleTimezoneSchema,
});
