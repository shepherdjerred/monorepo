import { z } from "zod";

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
  "MANUAL",
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

export const CustomWinnerSchema = z.enum(["A", "B"]);
export type CustomWinner = z.infer<typeof CustomWinnerSchema>;

export const CustomRoleSchema = z.enum([
  "MEMBER",
  "CAPTAIN",
  "COHOST",
  "HOST",
  "ADMIN",
]);
export type CustomRole = z.infer<typeof CustomRoleSchema>;

export const CustomAccountSchema = z.object({
  accountId: z.number().int().positive(),
  puuid: z.string().min(1),
  region: z.literal("AMERICA_NORTH"),
  riotGameName: z.string().min(1).nullable(),
  riotTagLine: z.string().min(1).nullable(),
});
export type CustomAccount = z.infer<typeof CustomAccountSchema>;

export const CustomNightParticipantSchema = z.object({
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

export const CustomGameParticipantSchema = z.object({
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

export const CustomGameSnapshotSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  state: CustomGameStateSchema,
  rosterMode: CustomRosterModeSchema,
  map: CustomMapSchema,
  pickMode: CustomPickModeSchema,
  participants: z.array(CustomGameParticipantSchema),
  activeCaptain: CustomTeamSchema.nullable(),
  tournamentCode: z.string().min(1).nullable(),
  tournamentCodeProvisioning: z
    .object({
      id: z.uuid(),
      startedAt: z.iso.datetime(),
      ambiguous: z.boolean().default(false),
    })
    .nullable()
    .default(null),
  voiceArrangementProvisioning: z
    .object({
      id: z.uuid(),
      startedAt: z.iso.datetime(),
    })
    .nullable()
    .default(null),
  riotMatchId: z.string().min(1).nullable(),
  winner: CustomWinnerSchema.nullable(),
  resultSource: z.enum(["RIOT", "MANUAL"]).nullable(),
  resultDisagreement: z.boolean(),
  repeatChampionWarnings: z.array(z.string().min(1)),
  voiceReady: z.boolean(),
  voiceOverride: z.boolean(),
  voiceError: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type CustomGameSnapshot = z.infer<typeof CustomGameSnapshotSchema>;

export const CustomRecruitmentCountsSchema = z.object({
  ready: z.number().int().nonnegative(),
  maybe: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  remaining: z.number().int().min(0).max(10),
});
export type CustomRecruitmentCounts = z.infer<
  typeof CustomRecruitmentCountsSchema
>;

export const CustomNightSnapshotSchema = z.object({
  id: z.uuid(),
  guildId: z.string().min(1),
  guildName: z.string().min(1),
  launchChannelId: z.string().min(1),
  voiceLobbyChannelId: z.string().min(1),
  hostDiscordId: z.string().min(1),
  cohostDiscordIds: z.array(z.string().min(1)),
  state: CustomNightStateSchema,
  revision: z.number().int().nonnegative(),
  participants: z.array(CustomNightParticipantSchema),
  currentGame: CustomGameSnapshotSchema.nullable(),
  recruitmentCounts: CustomRecruitmentCountsSchema,
  recruitmentMessageId: z.string().min(1).nullable(),
  riotTournamentId: z.string().min(1).nullable(),
  teamAVoiceChannelId: z.string().min(1).nullable(),
  teamBVoiceChannelId: z.string().min(1).nullable(),
  lastActivityAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type CustomNightSnapshot = z.infer<typeof CustomNightSnapshotSchema>;

export const CustomSnapshotEnvelopeSchema = z.object({
  kind: z.literal("snapshot"),
  snapshot: CustomNightSnapshotSchema.nullable(),
});
export type CustomSnapshotEnvelope = z.infer<
  typeof CustomSnapshotEnvelopeSchema
>;

export const CustomRevisionInputSchema = z.object({
  nightId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

export const CustomCreateNightInputSchema = z.object({
  guildId: z.string().min(1),
  guildName: z.string().min(1),
  launchChannelId: z.string().min(1),
  voiceLobbyChannelId: z.string().min(1),
});

export const CustomJoinNightInputSchema = CustomRevisionInputSchema.extend({
  displayName: z.string().trim().min(1).max(80),
  avatarUrl: z.url().nullable(),
});

export const CustomSetAvailabilityInputSchema =
  CustomRevisionInputSchema.extend({
    availability: CustomAvailabilitySchema,
  });

export const CustomSetAwayInputSchema = CustomRevisionInputSchema.extend({
  awayUntil: z.iso.datetime().nullable(),
});

export const CustomSetHeldInputSchema = CustomRevisionInputSchema.extend({
  discordId: z.string().min(1),
  held: z.boolean(),
});

export const CustomSelectAccountInputSchema = CustomRevisionInputSchema.extend({
  accountId: z.number().int().positive(),
  targetDiscordId: z.string().min(1).optional(),
});

export const CustomPrepareGameInputSchema = CustomRevisionInputSchema.extend({
  rosterMode: CustomRosterModeSchema,
  selectedDiscordIds: z.array(z.string().min(1)).max(10),
  map: CustomMapSchema,
  pickMode: CustomPickModeSchema,
});

export const CustomPickPlayerInputSchema = CustomRevisionInputSchema.extend({
  discordId: z.string().min(1),
});

export const CustomSubstituteInputSchema = CustomRevisionInputSchema.extend({
  outgoingDiscordId: z.string().min(1),
  incomingDiscordId: z.string().min(1),
});

export const CustomManualResultInputSchema = CustomRevisionInputSchema.extend({
  winner: CustomWinnerSchema,
});

export const CustomIntermissionInputSchema = CustomRevisionInputSchema.extend({
  choice: CustomIntermissionChoiceSchema,
});

export const CustomSetCohostInputSchema = CustomRevisionInputSchema.extend({
  discordId: z.string().min(1),
  cohost: z.boolean(),
});

export const CustomAuditEventSchema = z.object({
  id: z.uuid(),
  nightId: z.uuid(),
  gameId: z.uuid().nullable(),
  revision: z.number().int().nonnegative(),
  actorDiscordId: z.string().min(1),
  action: z.string().min(1),
  payload: z.unknown(),
  createdAt: z.iso.datetime(),
});
export type CustomAuditEvent = z.infer<typeof CustomAuditEventSchema>;

export const CustomHistorySchema = z.object({
  night: CustomNightSnapshotSchema,
  games: z.array(CustomGameSnapshotSchema),
  audit: z.array(CustomAuditEventSchema),
});
export type CustomHistory = z.infer<typeof CustomHistorySchema>;

export const CustomActivityClaimsSchema = z.object({
  sub: z.string().min(1),
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  instanceId: z.string().min(1),
  applicationId: z.string().min(1),
  type: z.literal("customs_activity"),
});
export type CustomActivityClaims = z.infer<typeof CustomActivityClaimsSchema>;

export const CustomAuthExchangeInputSchema = z.object({
  code: z.string().min(1),
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  instanceId: z.string().min(1),
});

export const CustomAuthRefreshInputSchema = z.object({
  activityToken: z.string().min(1),
  discordRefreshToken: z.string().min(1),
});

export const CustomAuthResponseSchema = z.object({
  discordAccessToken: z.string().min(1),
  discordRefreshToken: z.string().min(1),
  activityToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  contractHash: z.string().min(1),
});
export type CustomAuthResponse = z.infer<typeof CustomAuthResponseSchema>;
