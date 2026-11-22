import { z } from "zod";
import {
  ActivityGroupSchema,
  CombatFeedRowSchema,
  DayStringSchema,
  GameModeSchema,
  IsoTimestampSchema,
  ModeShareSchema,
  NonNegFloatSchema,
  NonNegIntSchema,
  NullablePingSchema,
  PlatformSchema,
  SessionSummarySchema,
  UuidSchema,
  WeaponStatSchema,
  WorldBucketSchema,
  WorldShareSchema,
} from "./contract.ts";

export const PlayerCombatSummarySchema = z.strictObject({
  pvpKills: NonNegIntSchema,
  pvpDeaths: NonNegIntSchema,
  kdr: NonNegFloatSchema,
  mobKills: NonNegIntSchema,
  mobDeaths: NonNegIntSchema,
  envDeaths: NonNegIntSchema,
  favoriteWeapons: z.array(WeaponStatSchema),
  recentCombat: z.array(CombatFeedRowSchema),
});
export type PlayerCombatSummary = z.infer<typeof PlayerCombatSummarySchema>;

export const PlayerGameplayCardSchema = z.strictObject({
  capturedAt: IsoTimestampSchema,
  coins: NonNegIntSchema,
  townName: z.string().nullable(),
  townRole: z.string().nullable(),
  townClaims: NonNegIntSchema,
  powerLevel: NonNegIntSchema,
  topSkill: z.string().nullable(),
  topSkillLevel: NonNegIntSchema,
  skills: z.record(z.string(), NonNegIntSchema),
  tracks: z.record(z.string(), NonNegIntSchema),
  questsCompleted: NonNegIntSchema,
  arenaBestWaves: z.record(z.string(), NonNegIntSchema),
  rwfMatches: NonNegIntSchema,
  rwfWins: NonNegIntSchema,
  rwfLosses: NonNegIntSchema,
  rwfKills: NonNegIntSchema,
  rwfDeaths: NonNegIntSchema,
});
export type PlayerGameplayCard = z.infer<typeof PlayerGameplayCardSchema>;

export const PlayerCalendarDaySchema = z.strictObject({
  day: DayStringSchema,
  connectedHours: NonNegFloatSchema,
  activeHours: NonNegFloatSchema,
  sessions: NonNegIntSchema,
});
export type PlayerCalendarDay = z.infer<typeof PlayerCalendarDaySchema>;

export const PlayerProfileIdentitySchema = z.strictObject({
  uuid: UuidSchema,
  name: z.string(),
  nickname: z.string().nullable(),
  online: z.boolean(),
  currentWorld: WorldBucketSchema.nullable(),
  currentMode: GameModeSchema.nullable(),
  afk: z.boolean(),
  firstSeenAt: IsoTimestampSchema,
  lastSeenAt: IsoTimestampSchema,
  activityIndex: z.number().min(0).max(5),
  activityGroup: ActivityGroupSchema,
  primaryGroup: z.string(),
  platform: PlatformSchema,
  clientVersion: z.string(),
  connectedMs: NonNegIntSchema,
  activeMs: NonNegIntSchema,
  afkMs: NonNegIntSchema,
  sessionsCount: NonNegIntSchema,
  longestSessionMs: NonNegIntSchema,
  meanSessionMs: NonNegIntSchema,
  pingMinMs: NullablePingSchema,
  pingAvgMs: NullablePingSchema,
  pingMaxMs: NullablePingSchema,
});
export type PlayerProfileIdentity = z.infer<typeof PlayerProfileIdentitySchema>;

export const PlayerProfileResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  player: PlayerProfileIdentitySchema,
  worldBreakdown: z.array(WorldShareSchema),
  modeBreakdown: z.array(ModeShareSchema),
  calendar365d: z.array(PlayerCalendarDaySchema),
  recentSessions: z.array(SessionSummarySchema),
  combat: PlayerCombatSummarySchema,
  gameplay: PlayerGameplayCardSchema.nullable(),
});
export type PlayerProfileResponse = z.infer<typeof PlayerProfileResponseSchema>;
