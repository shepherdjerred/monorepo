import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { z } from "zod";
import { RegionSchema } from "#src/model/riot/league-account.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "#src/model/core/discord.ts";

export const CustomNightStateSchema = z.enum([
  "RECRUITING",
  "PREPARING",
  "DRAFTING",
  "LOBBY_READY",
  "PLAYING",
  "INTERMISSION",
  "ENDED",
]);
export const CustomGameStateSchema = z.enum([
  "ROSTER_OPEN",
  "CAPTAINS_SET",
  "DRAFTING",
  "CODE_PENDING",
  "LOBBY_READY",
  "PLAYING",
  "RESULT_PENDING",
  "VERIFIED",
  "VOID",
]);
export const CustomAvailabilitySchema = z.enum([
  "READY",
  "MAYBE",
  "SITTING_OUT",
  "DONE",
]);
export type CustomAvailability = z.infer<typeof CustomAvailabilitySchema>;

export const CustomRosterModeSchema = z.enum([
  "FIRST_TEN",
  "HOST_SELECTED",
  "RANDOM_TEN",
]);
export type CustomRosterMode = z.infer<typeof CustomRosterModeSchema>;

export const CustomTeamSchema = z.enum(["A", "B"]);
export type CustomTeam = z.infer<typeof CustomTeamSchema>;
export const CustomSideSchema = z.enum(["BLUE", "RED"]);
export const CustomWinnerSchema = CustomTeamSchema;
export const CustomMapSchema = z.enum(["SUMMONERS_RIFT", "HOWLING_ABYSS"]);
export type CustomMap = z.infer<typeof CustomMapSchema>;
export const CustomPickModeSchema = z.enum([
  "TOURNAMENT_DRAFT",
  "BLIND_PICK",
  "DRAFT_MODE",
  "ALL_RANDOM",
]);
export type CustomPickMode = z.infer<typeof CustomPickModeSchema>;

export const CustomIntermissionChoiceSchema = z.enum([
  "KEEP_TEAMS_AND_CAPTAINS",
  "KEEP_TEAMS_REROLL_CAPTAINS",
  "REDRAFT_SAME_CAPTAINS",
  "REDRAFT_NEW_CAPTAINS",
]);
export type CustomIntermissionChoice = z.infer<
  typeof CustomIntermissionChoiceSchema
>;

export const CustomRoleSchema = z.enum([
  "MEMBER",
  "CAPTAIN",
  "COHOST",
  "HOST",
  "ADMIN",
]);
export type CustomRole = z.infer<typeof CustomRoleSchema>;

export const CustomVoiceStateSchema = z.enum([
  "CLEANED_UP",
  "IDLE",
  "PROVISIONING",
  "READY",
  "RETURNING",
  "CLEANING_UP",
  "FAILED",
]);
export const CustomAccountSchema = z.strictObject({
  accountId: z.number().int().positive(),
  puuid: LeaguePuuidSchema,
  region: RegionSchema,
  riotGameName: z.string().min(1).nullable(),
  riotTagLine: z.string().min(1).nullable(),
});
export type CustomAccount = z.infer<typeof CustomAccountSchema>;

export const CustomNightParticipantSchema = z.strictObject({
  discordId: DiscordAccountIdSchema,
  displayName: z.string().min(1),
  avatarUrl: z.url().nullable(),
  role: CustomRoleSchema,
  availability: CustomAvailabilitySchema,
  readyAt: z.iso.datetime().nullable(),
  awayUntil: z.iso.datetime().nullable(),
  awayOverdue: z.boolean(),
  held: z.boolean(),
  consentedAt: z.iso.datetime(),
  playerId: z.number().int().positive().nullable(),
  playerAlias: z.string().min(1).nullable(),
  accounts: z.array(CustomAccountSchema),
  selectedAccountId: z.number().int().positive().nullable(),
});
export type CustomNightParticipant = z.infer<
  typeof CustomNightParticipantSchema
>;

export const CustomGameParticipantSchema = z.strictObject({
  discordId: DiscordAccountIdSchema,
  displayName: z.string().min(1),
  playerId: z.number().int().positive(),
  playerAlias: z.string().min(1),
  accountId: z.number().int().positive(),
  puuid: LeaguePuuidSchema,
  riotGameName: z.string().min(1).nullable(),
  riotTagLine: z.string().min(1).nullable(),
  rosterOrder: z.number().int().nonnegative(),
  benchOrder: z.number().int().nonnegative().nullable(),
  team: CustomTeamSchema.nullable(),
  side: CustomSideSchema.nullable(),
  captain: z.boolean(),
  pickOrder: z.number().int().min(1).max(8).nullable(),
  championId: z.number().int().positive().nullable(),
  won: z.boolean().nullable(),
});
export type CustomGameParticipant = z.infer<typeof CustomGameParticipantSchema>;

/**
 * Not strict on purpose: during a rollout an older backend can still send the
 * retired `tournamentLobby` key, and a plain object strips it instead of
 * rejecting the whole real-time snapshot.
 */
export const CustomGameSnapshotSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  state: CustomGameStateSchema,
  rosterMode: CustomRosterModeSchema,
  map: CustomMapSchema,
  pickMode: CustomPickModeSchema,
  participants: z.array(CustomGameParticipantSchema),
  activeCaptain: CustomTeamSchema.nullable(),
  winner: CustomWinnerSchema.nullable(),
  voiceState: CustomVoiceStateSchema,
  voiceReady: z.boolean(),
  voiceOverride: z.boolean(),
  voiceError: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type CustomGameSnapshot = z.infer<typeof CustomGameSnapshotSchema>;

export const CustomRecruitmentCountsSchema = z.strictObject({
  ready: z.number().int().nonnegative(),
  maybe: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  remaining: z.number().int().min(0).max(10),
});

export const CustomNightSnapshotSchema = z.strictObject({
  pendingOperation: z
    .strictObject({
      id: z.string().min(1),
      action: z.enum([
        "arrange",
        "return",
        "continue",
        "void",
        "end",
        "expire",
      ]),
      state: z.enum(["queued", "running", "held"]),
      step: z.string().min(1),
    })
    .nullable()
    .optional(),
  id: z.uuid(),
  guildId: DiscordGuildIdSchema,
  guildName: z.string().min(1),
  launchChannelId: DiscordChannelIdSchema,
  voiceLobbyChannelId: DiscordChannelIdSchema,
  hostDiscordId: z.string().min(1),
  cohostDiscordIds: z.array(z.string().min(1)),
  state: CustomNightStateSchema,
  revision: z.number().int().nonnegative(),
  viewerRole: CustomRoleSchema,
  participants: z.array(CustomNightParticipantSchema),
  currentGame: CustomGameSnapshotSchema.nullable(),
  recruitmentCounts: CustomRecruitmentCountsSchema,
  recruitmentMessageId: z.string().min(1).nullable(),
  teamAVoiceChannelId: DiscordChannelIdSchema.nullable(),
  teamBVoiceChannelId: DiscordChannelIdSchema.nullable(),
  lastActivityAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type CustomNightSnapshot = z.infer<typeof CustomNightSnapshotSchema>;

export const CustomAuditEventSchema = z.strictObject({
  id: z.uuid(),
  nightId: z.uuid(),
  gameId: z.uuid().nullable(),
  revision: z.number().int().nonnegative(),
  actorId: z.string().min(1),
  action: z.string().min(1),
  payload: z.unknown(),
  source: z.enum([
    "ACTIVITY",
    "DISCORD",
    "RIOT",
    "SCOUT_CLIENT",
    "OPERATOR",
    "TEMPORAL",
  ]),
  createdAt: z.iso.datetime(),
});
export const CustomHistorySchema = z.strictObject({
  night: CustomNightSnapshotSchema,
  games: z.array(CustomGameSnapshotSchema),
  audit: z.array(CustomAuditEventSchema),
});
export type CustomHistory = z.infer<typeof CustomHistorySchema>;
export const CustomHistoryListSchema = z.array(CustomNightSnapshotSchema);
