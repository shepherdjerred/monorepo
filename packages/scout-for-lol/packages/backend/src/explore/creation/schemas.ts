/**
 * The creation tools' validated input and output shapes.
 *
 * Inputs reuse the same schemas the web forms post (`ReportCreateInputSchema`,
 * `CompetitionWriteSchema`) so a prepared entity and a hand-filled form cannot
 * describe different things. Two fields are deliberately re-declared rather
 * than reused:
 *
 *  - competition `dates` arrive as ISO strings. The web schema coerces a
 *    `Date`, which has no honest JSON Schema rendering for a tool call, so the
 *    tool takes strings and the executor runs them through the web schema.
 *  - subscription `puuid` and `riotId` are NOT tool inputs at all. They are
 *    resolved from Riot at prepare time and frozen into the payload, so the
 *    model cannot author the identity a confirmation will act on.
 *
 * Outputs are bounded on purpose: every one of them is persisted into the
 * conversation trace.
 */

import { z } from "zod";
import {
  CompetitionWriteSchema,
  CreationIntentKindSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerAliasSchema,
  RegionSchema,
  ReportCreateInputSchema,
  RiotIdPartsSchema,
  SeasonIdSchema,
} from "@scout-for-lol/data";

/** A guild picker never needs more rows than a person will read. */
export const CREATION_MAX_TARGETS = 25;
/** Matches the dashboard channel picker's practical ceiling. */
export const CREATION_MAX_CHANNELS = 100;
/** The confirmation card's one-line recap, persisted into the trace. */
export const CREATION_MAX_SUMMARY_LENGTH = 400;

const MessageSchema = z.string().min(1).max(1000);

const CreationChannelSchema = z.strictObject({
  id: DiscordChannelIdSchema,
  name: z.string(),
});

/** What one entity kind looks like in one guild: may they, and is there room. */
const CreationTargetEntitySchema = z.strictObject({
  /** RBAC now: they hold the `<entity>:create` permission in this guild. */
  permitted: z.boolean(),
  /**
   * A limit preview. Advisory only — the authoritative check runs again inside
   * the confirm transaction, where it sees the same snapshot as the insert.
   */
  atLimit: z.boolean(),
  limitMessage: z.string().max(500).nullable(),
});

const CreationTargetSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
  name: z.string(),
  report: CreationTargetEntitySchema,
  subscription: CreationTargetEntitySchema,
  competition: CreationTargetEntitySchema,
  /**
   * Inlined only when exactly one guild is eligible. The binding budget is
   * `EXPLORE_MAX_STEPS` (12), not the tool-call ceiling, so saving the
   * `list_guild_channels` round trip in the common case is worth the bytes.
   */
  channels: z
    .array(CreationChannelSchema)
    .max(CREATION_MAX_CHANNELS)
    .nullable(),
});

export const CreationTargetsResultSchema = z.strictObject({
  kind: z.enum(["targets", "verification_unavailable"]),
  message: MessageSchema,
  targets: z.array(CreationTargetSchema).max(CREATION_MAX_TARGETS),
});
export type CreationTargetsResult = z.infer<typeof CreationTargetsResultSchema>;

export const CreationChannelsResultSchema = z.strictObject({
  kind: z.enum(["channels", "forbidden_target", "verification_unavailable"]),
  message: MessageSchema,
  channels: z.array(CreationChannelSchema).max(CREATION_MAX_CHANNELS),
});
export type CreationChannelsResult = z.infer<
  typeof CreationChannelsResultSchema
>;

/**
 * The three prepare tools share one result shape.
 *
 * `creation_confirmation_required` is the only kind that carries an intent, and
 * no kind means anything was created — a tool here can mint a proposal and
 * nothing else.
 */
export const CreationPrepareResultSchema = z.strictObject({
  kind: z.enum([
    "creation_confirmation_required",
    "invalid",
    "limit_reached",
    "forbidden_target",
    "verification_unavailable",
  ]),
  message: MessageSchema,
  intent: z
    .strictObject({
      intentId: z.uuid(),
      kind: CreationIntentKindSchema,
      guildId: DiscordGuildIdSchema,
      expiresAt: z.iso.datetime(),
      summary: z.string().min(1).max(CREATION_MAX_SUMMARY_LENGTH),
    })
    .nullable(),
});
export type CreationPrepareResult = z.infer<typeof CreationPrepareResultSchema>;

/**
 * Every creation tool result carries a `kind`. The trace reads only that, so
 * one loose shape covers all three result schemas without restating their
 * enums.
 */
export const CreationToolKindSchema = z.looseObject({ kind: z.string() });

export const ListCreationTargetsToolInputSchema = z.strictObject({});

export const ListGuildChannelsToolInputSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
});

export const PrepareReportToolInputSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
  ...ReportCreateInputSchema.shape,
});

/**
 * Subscription filters are omitted deliberately: the filter spec is a
 * dashboard concern with its own editor, and a model-authored queue allow-list
 * would silently narrow which matches a server hears about. A prepared
 * subscription notifies on everything, exactly as the add form's default does,
 * and filters are set afterwards in the dashboard.
 */
export const PrepareSubscriptionToolInputSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
  channelId: DiscordChannelIdSchema,
  region: RegionSchema,
  riotId: RiotIdPartsSchema,
  alias: PlayerAliasSchema,
  discordUserId: DiscordAccountIdSchema.optional(),
});

const CompetitionDatesToolInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("FIXED_DATES"),
    startDate: z.iso.datetime(),
    endDate: z.iso.datetime(),
  }),
  z.strictObject({ type: z.literal("SEASON"), seasonId: SeasonIdSchema }),
]);

export const PrepareCompetitionToolInputSchema = z.strictObject({
  ...CompetitionWriteSchema.shape,
  guildId: DiscordGuildIdSchema,
  dates: CompetitionDatesToolInputSchema,
});
