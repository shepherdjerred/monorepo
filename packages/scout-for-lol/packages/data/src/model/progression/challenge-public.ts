import { z } from "zod";
import { QueueTypeSchema } from "#src/model/core/state.ts";
import {
  ChallengeContractV1Schema,
  ChallengeFrozenValueSchema,
  type ChallengeFrozenValue,
} from "#src/model/progression/challenge.ts";

export const ChallengeTemplateVersionSchema = z.strictObject({
  id: z.uuid(),
  templateId: z.uuid(),
  version: z.number().int().positive(),
  authorDiscordId: z.string().min(1),
  contract: ChallengeContractV1Schema,
  publishedAt: z.iso.datetime(),
});
export type ChallengeTemplateVersion = z.infer<
  typeof ChallengeTemplateVersionSchema
>;

export const ChallengeRunStatusSchema = z.enum([
  "active",
  "completed",
  "archived",
  "failed",
]);
export type ChallengeRunStatus = z.infer<typeof ChallengeRunStatusSchema>;

export const ChallengeCoverageSchema = z.strictObject({
  evaluatedMatchCount: z.number().int().nonnegative(),
  selectedPeriod: z.strictObject({
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime().nullable(),
  }),
  missingTimelineEvidence: z.number().int().nonnegative(),
});
export type ChallengeCoverage = z.infer<typeof ChallengeCoverageSchema>;

export type ChallengeProgress =
  | {
      kind: "scalar";
      reducer: "count" | "sum" | "maximum" | "consecutive_streak";
      current: number;
      target: number;
      completed: boolean;
    }
  | {
      kind: "distinct";
      current: number;
      target: number;
      covered: ChallengeFrozenValue[];
      missing: ChallengeFrozenValue[];
      completed: boolean;
    }
  | {
      kind: "boolean";
      operator: "all" | "any";
      children: ChallengeProgress[];
      completed: boolean;
    };

export const ChallengeProgressSchema: z.ZodType<ChallengeProgress> = z.lazy(
  () =>
    z.union([
      z.strictObject({
        kind: z.literal("scalar"),
        reducer: z.enum(["count", "sum", "maximum", "consecutive_streak"]),
        current: z.number(),
        target: z.number(),
        completed: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal("distinct"),
        current: z.number().int().nonnegative(),
        target: z.number().int().positive(),
        covered: z.array(ChallengeFrozenValueSchema),
        missing: z.array(ChallengeFrozenValueSchema),
        completed: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal("boolean"),
        operator: z.enum(["all", "any"]),
        children: z.array(ChallengeProgressSchema).min(1),
        completed: z.boolean(),
      }),
    ]),
);

export const ChallengeEvidenceMatchSchema = z.strictObject({
  matchId: z.string().min(1),
  gameEndAt: z.iso.datetime(),
  queue: QueueTypeSchema,
  championId: z.number().int().positive(),
  championName: z.string().min(1),
  role: z.string().min(1),
  win: z.boolean(),
  kills: z.number().nonnegative(),
  deaths: z.number().nonnegative(),
  assists: z.number().nonnegative(),
  creep_score: z.number().nonnegative(),
  gold_earned: z.number().nonnegative(),
  vision_score: z.number().nonnegative(),
  champion_damage: z.number().nonnegative(),
  damage_taken: z.number().nonnegative(),
  damage_mitigated: z.number().nonnegative(),
  teammate_healing: z.number().nonnegative(),
  wards_cleared: z.number().nonnegative(),
  objective_damage: z.number().nonnegative(),
  turret_damage: z.number().nonnegative(),
  crowd_control_time: z.number().nonnegative(),
  longest_life: z.number().nonnegative(),
  total_time_dead: z.number().nonnegative(),
  timelineEvidenceAvailable: z.boolean(),
  timelineEventCounts: z.record(z.string(), z.number().int().nonnegative()),
});
export type ChallengeEvidenceMatch = z.infer<
  typeof ChallengeEvidenceMatchSchema
>;
