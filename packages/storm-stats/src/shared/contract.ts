import { z } from "zod";
import ingestContractJson from "#contracts/ingest-v1.json" with { type: "json" };

export const INGEST_CONTRACT = { ...ingestContractJson } as const;

export const PLATFORMS = ["java", "bedrock"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PlatformSchema = z.enum(PLATFORMS);

export const GAME_MODES = ["survival", "creative", "arena", "rwf"] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const GameModeSchema = z.enum(GAME_MODES);

export const WORLD_BUCKETS = [
  "world",
  "world_nether",
  "world_the_end",
  "skylands",
  "creative",
  "arena",
  "rwf",
  "other",
] as const;
export type WorldBucket = (typeof WORLD_BUCKETS)[number];
export const WorldBucketSchema = z.enum(WORLD_BUCKETS);

export const COMBAT_KINDS = [
  "pvp",
  "pve_kill",
  "pve_death",
  "env_death",
] as const;
export type CombatKind = (typeof COMBAT_KINDS)[number];
export const CombatKindSchema = z.enum(COMBAT_KINDS);

export const END_REASONS = [
  "disconnect",
  "kick",
  "shutdown",
  "interrupted",
] as const;
export type EndReason = (typeof END_REASONS)[number];
export const EndReasonSchema = z.enum(END_REASONS);

export const BOUNCE_CATEGORIES = [
  "banned",
  "allowlist",
  "maintenance",
  "full",
  "kicked",
  "other",
] as const;
export type BounceCategory = (typeof BOUNCE_CATEGORIES)[number];
export const BounceCategorySchema = z.enum(BOUNCE_CATEGORIES);

export const ACTIVITY_GROUPS = [
  "regular",
  "active",
  "irregular",
  "inactive",
] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];
export const ActivityGroupSchema = z.enum(ACTIVITY_GROUPS);

export const VIEWER_ROLES = ["public", "staff"] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];
export const ViewerRoleSchema = z.enum(VIEWER_ROLES);

export function normalizeIsoTimestamp(value: string): string {
  const parsedMs = Date.parse(value);
  if (Number.isNaN(parsedMs)) {
    throw new RangeError(`Invalid ISO timestamp: ${value}`);
  }
  return new Date(parsedMs).toISOString();
}

export const IsoTimestampSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => normalizeIsoTimestamp(value));
export const DayStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const UuidSchema = z.uuid();
export const BoundedNameSchema = z.string().min(1).max(64);
export const NonNegIntSchema = z.number().int().min(0);
export const NonNegFloatSchema = z.number().min(0);
export const PercentSchema = z.number().min(0).max(100);
export const NonNegativeMsSchema = z.number().int().min(0).max(31_536_000_000);
export const NullablePingSchema = z
  .number()
  .int()
  .min(0)
  .max(60_000)
  .nullable();

export const SessionStartedEventSchema = z.strictObject({
  type: z.literal("session_started"),
  eventId: UuidSchema,
  occurredAt: IsoTimestampSchema,
  sessionId: UuidSchema,
  playerUuid: UuidSchema,
  playerName: BoundedNameSchema,
  firstSeenAt: IsoTimestampSchema,
  platform: PlatformSchema,
  clientVersion: z.string().min(1).max(64),
  clientBrand: z.string().min(1).max(64).nullable(),
  joinAddress: z.string().min(1).max(255).nullable(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .nullable(),
  countryName: z.string().min(1).max(80).nullable(),
});

export const SessionIntervalEventSchema = z.strictObject({
  type: z.literal("session_interval"),
  eventId: UuidSchema,
  occurredAt: IsoTimestampSchema,
  intervalEnd: IsoTimestampSchema,
  sessionId: UuidSchema,
  playerUuid: UuidSchema,
  playerName: BoundedNameSchema,
  world: WorldBucketSchema,
  mode: GameModeSchema,
  connectedMs: NonNegativeMsSchema,
  activeMs: NonNegativeMsSchema,
  pingMs: NullablePingSchema,
});

export const SessionEndedEventSchema = z.strictObject({
  type: z.literal("session_ended"),
  eventId: UuidSchema,
  occurredAt: IsoTimestampSchema,
  sessionId: UuidSchema,
  playerUuid: UuidSchema,
  playerName: BoundedNameSchema,
  startedAt: IsoTimestampSchema,
  connectedMs: NonNegativeMsSchema,
  activeMs: NonNegativeMsSchema,
  endReason: EndReasonSchema,
  pingMinMs: NullablePingSchema,
  pingAvgMs: NullablePingSchema,
  pingMaxMs: NullablePingSchema,
});

export const CombatEventSchema = z.strictObject({
  type: z.literal("combat_event"),
  eventId: UuidSchema,
  occurredAt: IsoTimestampSchema,
  sessionId: UuidSchema.nullable(),
  combatKind: CombatKindSchema,
  killerUuid: UuidSchema.nullable(),
  killerName: BoundedNameSchema.nullable(),
  victimUuid: UuidSchema.nullable(),
  victimName: BoundedNameSchema.nullable(),
  mobType: z.string().min(1).max(64).nullable(),
  weapon: z.string().min(1).max(80),
  world: WorldBucketSchema,
});

export const ConnectionBounceEventSchema = z.strictObject({
  type: z.literal("connection_bounce"),
  eventId: UuidSchema,
  occurredAt: IsoTimestampSchema,
  playerUuid: UuidSchema.nullable(),
  playerName: BoundedNameSchema,
  category: BounceCategorySchema,
  reason: z.string().max(240),
  joinAddress: z.string().min(1).max(255).nullable(),
});

export const IngestEventSchema = z.discriminatedUnion("type", [
  SessionStartedEventSchema,
  SessionIntervalEventSchema,
  SessionEndedEventSchema,
  CombatEventSchema,
  ConnectionBounceEventSchema,
]);
export type IngestEvent = z.infer<typeof IngestEventSchema>;

export const PlayerGameplaySnapshotSchema = z.strictObject({
  playerUuid: UuidSchema,
  playerName: BoundedNameSchema,
  capturedAt: IsoTimestampSchema,
  nickname: z.string().min(1).max(64).nullable(),
  primaryGroup: z.string().min(1).max(64),
  coins: NonNegIntSchema,
  townName: z.string().min(1).max(80).nullable(),
  townRole: z.string().min(1).max(40).nullable(),
  townClaims: NonNegIntSchema,
  powerLevel: NonNegIntSchema,
  topSkill: z.string().min(1).max(40).nullable(),
  topSkillLevel: NonNegIntSchema,
  skills: z.record(z.string().min(1).max(40), NonNegIntSchema),
  tracks: z.record(z.string().min(1).max(40), NonNegIntSchema),
  questsCompleted: NonNegIntSchema,
  arenaBestWaves: z.record(z.string().min(1).max(64), NonNegIntSchema),
  rwfMatches: NonNegIntSchema,
  rwfWins: NonNegIntSchema,
  rwfLosses: NonNegIntSchema,
  rwfKills: NonNegIntSchema,
  rwfDeaths: NonNegIntSchema,
});
export type PlayerGameplaySnapshot = z.infer<
  typeof PlayerGameplaySnapshotSchema
>;

export const OnlinePlayerSummarySchema = z.strictObject({
  uuid: UuidSchema,
  name: BoundedNameSchema,
  mode: GameModeSchema,
  world: WorldBucketSchema,
  afk: z.boolean(),
  pingMs: NullablePingSchema,
  sessionStartedAt: IsoTimestampSchema,
});
export type OnlinePlayerSummary = z.infer<typeof OnlinePlayerSummarySchema>;

export const TownSummarySnapshotSchema = z.strictObject({
  name: z.string().min(1).max(80),
  members: NonNegIntSchema,
  claims: NonNegIntSchema,
  kind: z.string().min(1).max(40),
});
export type TownSummarySnapshot = z.infer<typeof TownSummarySnapshotSchema>;

export const ServerSnapshotSchema = z.strictObject({
  capturedAt: IsoTimestampSchema,
  onlinePlayers: z.array(OnlinePlayerSummarySchema).max(256),
  maxPlayers: z.number().int().min(1).max(1000),
  townsCount: NonNegIntSchema,
  towns: z.array(TownSummarySnapshotSchema).max(200),
});
export type ServerSnapshot = z.infer<typeof ServerSnapshotSchema>;

export const IngestBatchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batchId: UuidSchema,
  serverName: z.string().min(1).max(80),
  sentAt: IsoTimestampSchema,
  events: z.array(IngestEventSchema).max(INGEST_CONTRACT.maxEventsPerBatch),
  playerSnapshots: z
    .array(PlayerGameplaySnapshotSchema)
    .max(INGEST_CONTRACT.maxPlayerSnapshotsPerBatch),
  serverSnapshot: ServerSnapshotSchema.nullable(),
});
export type IngestBatch = z.infer<typeof IngestBatchSchema>;

export const IngestBatchAckSchema = z.strictObject({
  acceptedEvents: NonNegIntSchema,
  duplicateEvents: NonNegIntSchema,
  updatedPlayers: NonNegIntSchema,
});
export type IngestBatchAck = z.infer<typeof IngestBatchAckSchema>;

export const ViewerInfoSchema = z.strictObject({
  role: ViewerRoleSchema,
  serverName: z.string(),
  publicEnabled: z.boolean(),
  generatedAt: IsoTimestampSchema,
});
export type ViewerInfo = z.infer<typeof ViewerInfoSchema>;

export const DailyActivityPointSchema = z.strictObject({
  day: DayStringSchema,
  uniquePlayers: NonNegIntSchema,
  newPlayers: NonNegIntSchema,
  returningPlayers: NonNegIntSchema,
  connectedHours: NonNegFloatSchema,
  activeHours: NonNegFloatSchema,
  sessions: NonNegIntSchema,
});
export type DailyActivityPoint = z.infer<typeof DailyActivityPointSchema>;

export const PlayerbaseBreakdownSchema = z.strictObject({
  regular: NonNegIntSchema,
  active: NonNegIntSchema,
  irregular: NonNegIntSchema,
  inactive: NonNegIntSchema,
  total: NonNegIntSchema,
});
export type PlayerbaseBreakdown = z.infer<typeof PlayerbaseBreakdownSchema>;

export const WorldShareSchema = z.strictObject({
  world: WorldBucketSchema,
  label: z.string(),
  connectedHours: NonNegFloatSchema,
  activeHours: NonNegFloatSchema,
  sharePercent: PercentSchema,
});
export type WorldShare = z.infer<typeof WorldShareSchema>;

export const ModeShareSchema = z.strictObject({
  mode: GameModeSchema,
  label: z.string(),
  connectedHours: NonNegFloatSchema,
  activeHours: NonNegFloatSchema,
  uniquePlayers: NonNegIntSchema,
  sharePercent: PercentSchema,
});
export type ModeShare = z.infer<typeof ModeShareSchema>;

export const SessionSummarySchema = z.strictObject({
  sessionId: UuidSchema,
  playerUuid: UuidSchema,
  playerName: z.string(),
  startedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema.nullable(),
  ongoing: z.boolean(),
  connectedMs: NonNegIntSchema,
  activeMs: NonNegIntSchema,
  primaryWorld: WorldBucketSchema,
  primaryMode: GameModeSchema,
  platform: PlatformSchema,
  pvpKills: NonNegIntSchema,
  mobKills: NonNegIntSchema,
  deaths: NonNegIntSchema,
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const ServerOverviewKpisSchema = z.strictObject({
  uniquePlayers24h: NonNegIntSchema,
  uniquePlayers7d: NonNegIntSchema,
  uniquePlayers30d: NonNegIntSchema,
  totalPlayers: NonNegIntSchema,
  newPlayers24h: NonNegIntSchema,
  newPlayers7d: NonNegIntSchema,
  newPlayers30d: NonNegIntSchema,
  connectedHours24h: NonNegFloatSchema,
  activeHours24h: NonNegFloatSchema,
  connectedHours7d: NonNegFloatSchema,
  activeHours7d: NonNegFloatSchema,
  connectedHours30d: NonNegFloatSchema,
  activeHours30d: NonNegFloatSchema,
  totalConnectedHours: NonNegFloatSchema,
  totalActiveHours: NonNegFloatSchema,
  completedSessions30d: NonNegIntSchema,
  meanSessionMinutes30d: NonNegFloatSchema,
  meanActiveMinutes30d: NonNegFloatSchema,
  peakOnline30d: NonNegIntSchema,
  peakOnlineAllTime: NonNegIntSchema,
  peakOnlineAt: IsoTimestampSchema.nullable(),
});
export type ServerOverviewKpis = z.infer<typeof ServerOverviewKpisSchema>;

export const ServerOverviewResponseSchema = z.strictObject({
  serverName: z.string(),
  generatedAt: IsoTimestampSchema,
  lastIngestAt: IsoTimestampSchema.nullable(),
  onlineNow: NonNegIntSchema,
  maxPlayers: z.number().int().min(1),
  onlinePlayers: z.array(OnlinePlayerSummarySchema),
  kpis: ServerOverviewKpisSchema,
  dailyActivity30d: z.array(DailyActivityPointSchema),
  playerbaseGroups: PlayerbaseBreakdownSchema,
  worldBreakdown: z.array(WorldShareSchema),
  modeBreakdown: z.array(ModeShareSchema),
  recentSessions: z.array(SessionSummarySchema),
});
export type ServerOverviewResponse = z.infer<
  typeof ServerOverviewResponseSchema
>;

export const PunchcardCellSchema = z.strictObject({
  dayOfWeek: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  activeHours: NonNegFloatSchema,
  uniquePlayers: NonNegIntSchema,
  sessions: NonNegIntSchema,
});
export type PunchcardCell = z.infer<typeof PunchcardCellSchema>;

export const RetentionCohortRowSchema = z.strictObject({
  cohortWeek: DayStringSchema,
  newPlayers: NonNegIntSchema,
  week1Retained: NonNegIntSchema,
  week2Retained: NonNegIntSchema,
  week4Retained: NonNegIntSchema,
  week1Percent: PercentSchema,
  week2Percent: PercentSchema,
  week4Percent: PercentSchema,
});
export type RetentionCohortRow = z.infer<typeof RetentionCohortRowSchema>;

export const FirstSessionEngagementSchema = z.strictObject({
  completedFirstSessions: NonNegIntSchema,
  meanActiveMinutes: NonNegFloatSchema,
  reachedTenActiveMinutes: NonNegIntSchema,
  tenMinutePercent: PercentSchema,
});
export type FirstSessionEngagement = z.infer<
  typeof FirstSessionEngagementSchema
>;

export const OnlineActivityResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  timeZone: z.literal("America/Los_Angeles"),
  dailySeries180d: z.array(DailyActivityPointSchema),
  punchcard: z.array(PunchcardCellSchema),
  calendar730d: z.array(DailyActivityPointSchema),
  playerbaseGroups: PlayerbaseBreakdownSchema,
  retentionCohorts: z.array(RetentionCohortRowSchema),
  firstSessionEngagement: FirstSessionEngagementSchema,
});
export type OnlineActivityResponse = z.infer<
  typeof OnlineActivityResponseSchema
>;

export const PLAYER_SORT_FIELDS = [
  "activePlaytime",
  "connectedPlaytime",
  "sessions",
  "lastSeen",
  "firstSeen",
  "activityIndex",
  "coins",
  "powerLevel",
  "pvpKills",
  "name",
] as const;
export type PlayerSortField = (typeof PLAYER_SORT_FIELDS)[number];
export const PlayerSortFieldSchema = z.enum(PLAYER_SORT_FIELDS);

export const StaffPlayerRowSummarySchema = z.strictObject({
  countryCode: z.string().nullable(),
  countryName: z.string().nullable(),
  lastJoinAddress: z.string().nullable(),
  bouncesCount: NonNegIntSchema,
});
export type StaffPlayerRowSummary = z.infer<typeof StaffPlayerRowSummarySchema>;

export const PlayerDirectoryRowSchema = z.strictObject({
  uuid: UuidSchema,
  name: z.string(),
  nickname: z.string().nullable(),
  online: z.boolean(),
  activityIndex: z.number().min(0).max(5),
  activityGroup: ActivityGroupSchema,
  primaryGroup: z.string(),
  platform: PlatformSchema,
  clientVersion: z.string(),
  connectedMs: NonNegIntSchema,
  activeMs: NonNegIntSchema,
  sessionsCount: NonNegIntSchema,
  firstSeenAt: IsoTimestampSchema,
  lastSeenAt: IsoTimestampSchema,
  primaryWorld: WorldBucketSchema,
  primaryMode: GameModeSchema,
  coins: NonNegIntSchema,
  townName: z.string().nullable(),
  powerLevel: NonNegIntSchema,
  pvpKills: NonNegIntSchema,
  pvpDeaths: NonNegIntSchema,
  pingAvgMs: NullablePingSchema,
  staff: StaffPlayerRowSummarySchema.optional(),
});
export type PlayerDirectoryRow = z.infer<typeof PlayerDirectoryRowSchema>;

export const PlayersDirectoryResponseSchema = z.strictObject({
  items: z.array(PlayerDirectoryRowSchema),
  total: NonNegIntSchema,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type PlayersDirectoryResponse = z.infer<
  typeof PlayersDirectoryResponseSchema
>;

export const WeaponStatSchema = z.strictObject({
  weapon: z.string(),
  kills: NonNegIntSchema,
  sharePercent: PercentSchema,
});
export type WeaponStat = z.infer<typeof WeaponStatSchema>;

export const CombatFeedRowSchema = z.strictObject({
  eventId: UuidSchema,
  occurredAt: IsoTimestampSchema,
  combatKind: CombatKindSchema,
  killerUuid: UuidSchema.nullable(),
  killerName: z.string().nullable(),
  victimUuid: UuidSchema.nullable(),
  victimName: z.string().nullable(),
  mobType: z.string().nullable(),
  weapon: z.string(),
  world: WorldBucketSchema,
});
export type CombatFeedRow = z.infer<typeof CombatFeedRowSchema>;
