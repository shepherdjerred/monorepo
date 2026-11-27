import { z } from "zod";
import {
  CombatFeedRowSchema,
  IsoTimestampSchema,
  NonNegFloatSchema,
  NonNegIntSchema,
  PlayerHomeKindSchema,
  PlayerUuidSchema,
  TownSummarySnapshotSchema,
  WeaponStatSchema,
} from "./contract.ts";

export const PvpLeaderRowSchema = z.strictObject({
  uuid: PlayerUuidSchema,
  name: z.string(),
  kills: NonNegIntSchema,
  deaths: NonNegIntSchema,
  kdr: NonNegFloatSchema,
  topWeapon: z.string().nullable(),
  mobKills: NonNegIntSchema,
});
export type PvpLeaderRow = z.infer<typeof PvpLeaderRowSchema>;

export const MobCombatRowSchema = z.strictObject({
  mobType: z.string(),
  killedByPlayers: NonNegIntSchema,
  killedPlayers: NonNegIntSchema,
});
export type MobCombatRow = z.infer<typeof MobCombatRowSchema>;

export const PvpOverviewResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  kpis: z.strictObject({
    totalPvpKills: NonNegIntSchema,
    totalMobKills: NonNegIntSchema,
    totalPlayerDeaths: NonNegIntSchema,
    uniqueCombatants: NonNegIntSchema,
    deadliestWeapon: z.string().nullable(),
    deadliestMob: z.string().nullable(),
  }),
  topWarriors: z.array(PvpLeaderRowSchema),
  topWeapons: z.array(WeaponStatSchema),
  mobBreakdown: z.array(MobCombatRowSchema),
  recentKills: z.array(CombatFeedRowSchema),
});
export type PvpOverviewResponse = z.infer<typeof PvpOverviewResponseSchema>;

export const GameplayOverviewResponseSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  economyTop: z.array(
    z.strictObject({
      uuid: PlayerUuidSchema,
      name: z.string(),
      crystals: NonNegIntSchema,
      townName: z.string().nullable(),
      townKind: PlayerHomeKindSchema.nullable(),
    }),
  ),
  towns: z.array(TownSummarySnapshotSchema),
  skillsTop: z.array(
    z.strictObject({
      uuid: PlayerUuidSchema,
      name: z.string(),
      powerLevel: NonNegIntSchema,
      topSkill: z.string().nullable(),
      topSkillLevel: NonNegIntSchema,
    }),
  ),
  rwfTop: z.array(
    z.strictObject({
      uuid: PlayerUuidSchema,
      name: z.string(),
      matches: NonNegIntSchema,
      wins: NonNegIntSchema,
      losses: NonNegIntSchema,
      kills: NonNegIntSchema,
      deaths: NonNegIntSchema,
    }),
  ),
  arenaTop: z.array(
    z.strictObject({
      arena: z.string(),
      uuid: PlayerUuidSchema,
      name: z.string(),
      bestWave: NonNegIntSchema,
    }),
  ),
  questsTop: z.array(
    z.strictObject({
      uuid: PlayerUuidSchema,
      name: z.string(),
      questsCompleted: NonNegIntSchema,
      powerLevel: NonNegIntSchema,
    }),
  ),
});
export type GameplayOverviewResponse = z.infer<
  typeof GameplayOverviewResponseSchema
>;
