import { z } from "zod";
import { ProgressionAccountSchema } from "#src/model/progression/account.ts";

export const DUEL_RULESET_VERSION = 1;
export const DUEL_DISCLOSURE_VERSION = 1;

export const DuelRulesetV1Schema = z
  .strictObject({
    version: z.literal(DUEL_RULESET_VERSION),
    killTarget: z.number().int().min(1).max(10).nullable(),
    laneCsTarget: z.number().int().min(10).max(500).nullable(),
    firstTurret: z.boolean(),
  })
  .superRefine((ruleset, context) => {
    if (
      ruleset.killTarget === null &&
      ruleset.laneCsTarget === null &&
      !ruleset.firstTurret
    ) {
      context.addIssue({
        code: "custom",
        message: "A duel ruleset requires at least one win condition",
      });
    }
  });
export type DuelRulesetV1 = z.infer<typeof DuelRulesetV1Schema>;

export const DuelCompetitorAccountSchema = ProgressionAccountSchema.extend({});

export const DuelCompetitorSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["player", "pair"]),
    accounts: z.array(DuelCompetitorAccountSchema).min(1).max(2),
    teamName: z.string().min(1).max(80).nullable(),
  })
  .superRefine((competitor, context) => {
    const expected = competitor.kind === "player" ? 1 : 2;
    if (competitor.accounts.length !== expected) {
      context.addIssue({
        code: "custom",
        message: `${competitor.kind} competitors require exactly ${expected.toString()} account${expected === 1 ? "" : "s"}`,
        path: ["accounts"],
      });
    }
    if (
      new Set(competitor.accounts.map((account) => account.playerId)).size !==
      competitor.accounts.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A competitor cannot contain the same player twice",
        path: ["accounts"],
      });
    }
  });
export type DuelCompetitor = z.infer<typeof DuelCompetitorSchema>;

export const DuelEventFormatSchema = z.enum([
  "direct",
  "single_elimination",
  "double_elimination",
  "round_robin",
]);
export type DuelEventFormat = z.infer<typeof DuelEventFormatSchema>;

export const DuelBestOfSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(5),
]);
export type DuelBestOf = z.infer<typeof DuelBestOfSchema>;

export const DuelSeriesStatusSchema = z.enum([
  "awaiting_acceptance",
  "scheduled",
  "awaiting_readiness",
  "provisioning_code",
  "code_ready",
  "in_progress",
  "overdue",
  "needs_review",
  "completed",
  "no_contest",
  "cancelled",
]);
export type DuelSeriesStatus = z.infer<typeof DuelSeriesStatusSchema>;

export const DuelObjectiveSchema = z.enum(["kills", "lane_cs", "first_turret"]);
export type DuelObjective = z.infer<typeof DuelObjectiveSchema>;

export const DuelResultEvidenceSchema = z.strictObject({
  matchId: z.string().min(1),
  state: z.enum(["verified", "needs_review"]),
  winnerCompetitorId: z.uuid().nullable(),
  objective: DuelObjectiveSchema.nullable(),
  objectiveTimestampMs: z.number().int().nonnegative().nullable(),
  reason: z.string().min(1).nullable(),
  participantPuuids: z.array(z.string().min(1)),
  timelineComplete: z.boolean(),
});
export type DuelResultEvidence = z.infer<typeof DuelResultEvidenceSchema>;

export const DuelStandingSchema = z.strictObject({
  competitorId: z.uuid(),
  games: z.number().int().nonnegative(),
  series: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  seriesWins: z.number().int().nonnegative(),
  seriesLosses: z.number().int().nonnegative(),
  gameDifferential: z.number().int(),
  winRate: z.number().min(0).max(1).nullable(),
  placed: z.boolean(),
  streak: z.number().int(),
});
export type DuelStanding = z.infer<typeof DuelStandingSchema>;

export const DuelTimelineInputSchema = z.strictObject({
  matchId: z.string().min(1),
  completed: z.boolean(),
  timelineComplete: z.boolean(),
  participants: z.array(
    z.strictObject({ puuid: z.string().min(1), teamId: z.number().int() }),
  ),
  kills: z.array(
    z.strictObject({
      timestampMs: z.number().int().nonnegative(),
      killerPuuid: z.string().min(1),
    }),
  ),
  turretKills: z.array(
    z.strictObject({
      timestampMs: z.number().int().nonnegative(),
      destroyedTeamId: z.number().int(),
    }),
  ),
  frames: z.array(
    z.strictObject({
      timestampMs: z.number().int().nonnegative(),
      participants: z.array(
        z.strictObject({
          puuid: z.string().min(1),
          minionsKilled: z.number().int().nonnegative(),
          jungleMinionsKilled: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
});
export type DuelTimelineInput = z.infer<typeof DuelTimelineInputSchema>;
