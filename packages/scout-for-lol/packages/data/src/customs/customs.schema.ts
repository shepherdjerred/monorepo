import { z } from "zod";
import { RegionSchema } from "#src/model/league-account.ts";
import { AccountIdSchema } from "#src/model/competition.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "#src/model/discord.ts";

export const CustomNightStateSchema = z.enum([
  "RECRUITING",
  "PREPARING",
  "DRAFTING",
  "LOBBY_READY",
  "PLAYING",
  "INTERMISSION",
  "ENDED",
]);
export type CustomNightState = z.infer<typeof CustomNightStateSchema>;

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
export type CustomGameState = z.infer<typeof CustomGameStateSchema>;

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
export type CustomSide = z.infer<typeof CustomSideSchema>;
export const CustomWinnerSchema = CustomTeamSchema;
export type CustomWinner = z.infer<typeof CustomWinnerSchema>;

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
  "IDLE",
  "PROVISIONING",
  "READY",
  "RETURNING",
  "CLEANING_UP",
  "FAILED",
]);
export type CustomVoiceState = z.infer<typeof CustomVoiceStateSchema>;

export const CustomAccountSchema = z.strictObject({
  accountId: z.number().int().positive(),
  puuid: z.string().min(1),
  region: RegionSchema,
  riotGameName: z.string().min(1).nullable(),
  riotTagLine: z.string().min(1).nullable(),
});
export type CustomAccount = z.infer<typeof CustomAccountSchema>;

export const CustomNightParticipantSchema = z.strictObject({
  discordId: z.string().min(1),
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
  discordId: z.string().min(1),
  displayName: z.string().min(1),
  playerId: z.number().int().positive(),
  playerAlias: z.string().min(1),
  accountId: z.number().int().positive(),
  puuid: z.string().min(1),
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

export const CustomTournamentLobbySnapshotSchema = z.strictObject({
  state: z.enum([
    "created",
    "lobby_open",
    "champ_select",
    "allocating",
    "in_game",
    "resolved",
    "reported",
    "cancelled",
    "abandoned",
    "expired",
  ]),
  code: z.string().min(1).nullable(),
});

export const CustomGameSnapshotSchema = z.strictObject({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  state: CustomGameStateSchema,
  rosterMode: CustomRosterModeSchema,
  map: CustomMapSchema,
  pickMode: CustomPickModeSchema,
  participants: z.array(CustomGameParticipantSchema),
  activeCaptain: CustomTeamSchema.nullable(),
  tournamentLobby: CustomTournamentLobbySnapshotSchema.nullable(),
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
  id: z.uuid(),
  guildId: z.string().min(1),
  guildName: z.string().min(1),
  launchChannelId: z.string().min(1),
  voiceLobbyChannelId: z.string().min(1),
  hostDiscordId: z.string().min(1),
  cohostDiscordIds: z.array(z.string().min(1)),
  state: CustomNightStateSchema,
  revision: z.number().int().nonnegative(),
  viewerRole: CustomRoleSchema,
  participants: z.array(CustomNightParticipantSchema),
  currentGame: CustomGameSnapshotSchema.nullable(),
  recruitmentCounts: CustomRecruitmentCountsSchema,
  recruitmentMessageId: z.string().min(1).nullable(),
  teamAVoiceChannelId: z.string().min(1).nullable(),
  teamBVoiceChannelId: z.string().min(1).nullable(),
  lastActivityAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type CustomNightSnapshot = z.infer<typeof CustomNightSnapshotSchema>;

export const CustomSnapshotEnvelopeSchema = z.strictObject({
  kind: z.literal("snapshot"),
  sequence: z.number().int().nonnegative(),
  snapshot: CustomNightSnapshotSchema.nullable(),
});
export type CustomSnapshotEnvelope = z.infer<
  typeof CustomSnapshotEnvelopeSchema
>;

export const CustomRevisionInputSchema = z.strictObject({
  nightId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
});
export const CUSTOMS_DISCLOSURE_VERSION = "2026-08-29";
export const CustomGuildInputSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
});
export const CustomCreateNightInputSchema = z.strictObject({});
export const CustomJoinNightInputSchema = CustomRevisionInputSchema;
export const CustomSetAvailabilityInputSchema =
  CustomRevisionInputSchema.extend({ availability: CustomAvailabilitySchema });
export const CustomSetAwayInputSchema = CustomRevisionInputSchema.extend({
  awayUntil: z.iso.datetime().nullable(),
});
export const CustomTargetParticipantInputSchema =
  CustomRevisionInputSchema.extend({ discordId: DiscordAccountIdSchema });
export const CustomAddParticipantInputSchema =
  CustomTargetParticipantInputSchema;
export const CustomSetHeldInputSchema =
  CustomTargetParticipantInputSchema.extend({ held: z.boolean() });
export const CustomSelectAccountInputSchema = CustomRevisionInputSchema.extend({
  accountId: AccountIdSchema,
  targetDiscordId: DiscordAccountIdSchema.optional(),
});
export const CustomPrepareGameInputSchema = CustomRevisionInputSchema.extend({
  rosterMode: CustomRosterModeSchema,
  selectedDiscordIds: z.array(DiscordAccountIdSchema).max(10),
  map: CustomMapSchema,
  pickMode: CustomPickModeSchema,
});
export const CustomSelectCaptainsInputSchema = z.union([
  CustomRevisionInputSchema,
  CustomRevisionInputSchema.extend({
    captainADiscordId: DiscordAccountIdSchema,
    captainBDiscordId: DiscordAccountIdSchema,
  }),
]);
export const CustomPickPlayerInputSchema = CustomTargetParticipantInputSchema;
export const CustomSubstituteInputSchema = CustomRevisionInputSchema.extend({
  outgoingDiscordId: DiscordAccountIdSchema,
  incomingDiscordId: DiscordAccountIdSchema,
});
export const CustomAssignTeamInputSchema =
  CustomTargetParticipantInputSchema.extend({ team: CustomTeamSchema });
export const CustomSetCohostInputSchema =
  CustomTargetParticipantInputSchema.extend({ cohost: z.boolean() });
export const CustomVoiceOverrideInputSchema = CustomRevisionInputSchema.extend({
  enabled: z.boolean(),
});
export const CustomIntermissionInputSchema = CustomRevisionInputSchema.extend({
  choice: CustomIntermissionChoiceSchema,
});
export const CustomVoidGameInputSchema = CustomRevisionInputSchema.extend({
  reason: z.string().trim().min(1).max(500),
});

export const CustomAuditEventSchema = z.strictObject({
  id: z.uuid(),
  nightId: z.uuid(),
  gameId: z.uuid().nullable(),
  revision: z.number().int().nonnegative(),
  actorId: z.string().min(1),
  action: z.string().min(1),
  payload: z.unknown(),
  source: z.enum(["ACTIVITY", "DISCORD", "RIOT", "OPERATOR", "TEMPORAL"]),
  createdAt: z.iso.datetime(),
});
export type CustomAuditEvent = z.infer<typeof CustomAuditEventSchema>;
export const CustomHistorySchema = z.strictObject({
  night: CustomNightSnapshotSchema,
  games: z.array(CustomGameSnapshotSchema),
  audit: z.array(CustomAuditEventSchema),
});
export type CustomHistory = z.infer<typeof CustomHistorySchema>;
export const CustomHistoryListSchema = z.array(CustomNightSnapshotSchema);

export const CustomActivityClaimsSchema = z.strictObject({
  sub: z.string().min(1),
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  instanceId: z.string().min(1),
  applicationId: z.string().min(1),
  type: z.literal("customs_activity"),
});
export type CustomActivityClaims = z.infer<typeof CustomActivityClaimsSchema>;
export const CustomAuthExchangeInputSchema = z.strictObject({
  code: z.string().min(1),
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  instanceId: z.string().min(1),
});
export const CustomAuthRefreshInputSchema = z.strictObject({
  activityToken: z.string().min(1),
  discordRefreshToken: z.string().min(1),
});
export const CustomAuthResponseSchema = z.strictObject({
  discordAccessToken: z.string().min(1),
  discordRefreshToken: z.string().min(1),
  activityToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  refreshUntil: z.iso.datetime(),
  contractHash: z.string().min(1),
});
export type CustomAuthResponse = z.infer<typeof CustomAuthResponseSchema>;
