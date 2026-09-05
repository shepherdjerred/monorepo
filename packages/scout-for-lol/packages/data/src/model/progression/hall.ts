import { z } from "zod";
import { ProgressionAccountSchema } from "#src/model/progression/account.ts";
import {
  COMPETITIVE_PROGRESSION_CATALOG,
  COMPETITIVE_PROGRESSION_CATALOG_VERSION,
  HallQueueFamilyIdSchema,
  HallRecordIdSchema,
  hallRecordDefinition,
  type HallQueueFamilyId,
  type HallRecordId,
} from "#src/model/progression/catalog.ts";
import { type MatchLakeRow } from "#src/model/reports/lake-columns.ts";
import { type QueueType } from "#src/model/core/state.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "#src/model/core/discord.ts";

export const HallBaselineStatusSchema = z.enum(["building", "ready", "failed"]);
export type HallBaselineStatus = z.infer<typeof HallBaselineStatusSchema>;

export const HallRecordHolderSchema = ProgressionAccountSchema.extend({});
export type HallRecordHolder = z.infer<typeof HallRecordHolderSchema>;

export const HallRecordEvidenceSchema = z.strictObject({
  matchId: z.string().min(1),
  gameEndAt: z.iso.datetime(),
  value: z.number(),
  holder: HallRecordHolderSchema,
});
export type HallRecordEvidence = z.infer<typeof HallRecordEvidenceSchema>;

export const HallRecordEntrySchema = z.strictObject({
  queueFamilyId: HallQueueFamilyIdSchema,
  recordId: HallRecordIdSchema,
  baselineStatus: HallBaselineStatusSchema,
  baselineValue: z.number().nullable(),
  currentValue: z.number().nullable(),
  holders: z.array(HallRecordHolderSchema),
  evidence: z.array(HallRecordEvidenceSchema),
  updatedAt: z.iso.datetime(),
  errorMessage: z.string().nullable(),
});
export type HallRecordEntry = z.infer<typeof HallRecordEntrySchema>;

export const HallSettingsSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
  catalogVersion: z.literal(COMPETITIVE_PROGRESSION_CATALOG_VERSION),
  channelId: DiscordChannelIdSchema.nullable(),
  enabledQueueFamilies: z.array(HallQueueFamilyIdSchema),
  enabledRecords: z.array(HallRecordIdSchema),
});
export type HallSettings = z.infer<typeof HallSettingsSchema>;

export const HallCandidateSchema = z.strictObject({
  queueFamilyId: HallQueueFamilyIdSchema,
  recordId: HallRecordIdSchema,
  value: z.number(),
  holder: HallRecordHolderSchema,
  evidence: HallRecordEvidenceSchema,
});
export type HallCandidate = z.infer<typeof HallCandidateSchema>;

export type HallComparison =
  | { kind: "below" }
  | { kind: "tie"; holders: HallRecordHolder[]; evidence: HallRecordEvidence[] }
  | {
      kind: "break";
      value: number;
      holders: HallRecordHolder[];
      evidence: HallRecordEvidence[];
    };

export type HallEligibleMatch = Pick<
  MatchLakeRow,
  | "early_surrendered"
  | "end_of_game_result"
  | "game_duration_seconds"
  | "game_end_at"
  | "queue"
>;

export type HallRecordMatch = Pick<
  MatchLakeRow,
  | "assists"
  | "creep_score"
  | "damage_dealt_to_objectives"
  | "damage_dealt_to_turrets"
  | "damage_self_mitigated"
  | "game_duration_seconds"
  | "gold_earned"
  | "kills"
  | "largest_multi_kill"
  | "longest_time_spent_living"
  | "time_ccing_others"
  | "total_damage_dealt_to_champions"
  | "total_damage_taken"
  | "total_heals_on_teammates"
  | "total_time_spent_dead"
  | "vision_score"
  | "wards_killed"
>;

export function classifyHallQueueFamily(
  queue: QueueType,
): HallQueueFamilyId | null {
  const family = COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies.find(
    (candidate) => candidate.queues.includes(queue),
  );
  return family?.id ?? null;
}

export function isHallEligibleMatch(
  match: HallEligibleMatch,
  trackingStartedAt: Date,
): boolean {
  const normalizedGameEndAt = match.game_end_at.replace(" ", "T");
  const gameEndAt = Date.parse(
    /(?:Z|[+-]\d{2}:\d{2})$/u.test(normalizedGameEndAt)
      ? normalizedGameEndAt
      : `${normalizedGameEndAt}Z`,
  );
  return (
    match.end_of_game_result === "GameComplete" &&
    !match.early_surrendered &&
    match.game_duration_seconds >= 300 &&
    Number.isFinite(gameEndAt) &&
    gameEndAt >= trackingStartedAt.getTime() &&
    match.queue !== "custom"
  );
}

function perMinute(value: number, durationSeconds: number): number {
  return value / (durationSeconds / 60);
}

function rawHallRecordValue(
  match: HallRecordMatch,
  recordId: HallRecordId,
): number {
  switch (recordId) {
    case "kills":
      return match.kills;
    case "assists":
      return match.assists;
    case "largest_multikill":
      return match.largest_multi_kill;
    case "champion_damage":
      return match.total_damage_dealt_to_champions;
    case "champion_damage_per_minute":
      return perMinute(
        match.total_damage_dealt_to_champions,
        match.game_duration_seconds,
      );
    case "damage_taken":
      return match.total_damage_taken;
    case "damage_mitigated":
      return match.damage_self_mitigated;
    case "cs":
      return match.creep_score;
    case "cs_per_minute":
      return perMinute(match.creep_score, match.game_duration_seconds);
    case "gold_earned":
      return match.gold_earned;
    case "teammate_healing":
      return match.total_heals_on_teammates;
    case "vision_score":
      return match.vision_score;
    case "wards_cleared":
      return match.wards_killed;
    case "objective_damage":
      return match.damage_dealt_to_objectives;
    case "turret_damage":
      return match.damage_dealt_to_turrets;
    case "crowd_control_time":
      return match.time_ccing_others;
    case "longest_life":
      return match.longest_time_spent_living;
    case "total_time_dead":
      return match.total_time_spent_dead;
  }
}

export function hallRecordValue(
  match: HallRecordMatch,
  recordId: HallRecordId,
): number {
  const precision = hallRecordDefinition(recordId).precision;
  return Number(rawHallRecordValue(match, recordId).toFixed(precision));
}

function holderKey(holder: HallRecordHolder): string {
  return `${holder.playerId.toString()}:${holder.accountId.toString()}`;
}

export function compareHallCandidate(
  currentValue: number | null,
  currentHolders: HallRecordHolder[],
  currentEvidence: HallRecordEvidence[],
  candidate: HallCandidate,
): HallComparison {
  if (currentValue !== null && candidate.value < currentValue) {
    return { kind: "below" };
  }
  if (currentValue !== null && candidate.value === currentValue) {
    const existingKeys = new Set(
      currentHolders.map((holder) => holderKey(holder)),
    );
    if (existingKeys.has(holderKey(candidate.holder))) {
      return { kind: "below" };
    }
    return {
      kind: "tie",
      holders: [...currentHolders, candidate.holder],
      evidence: [...currentEvidence, candidate.evidence],
    };
  }
  return {
    kind: "break",
    value: candidate.value,
    holders: [candidate.holder],
    evidence: [candidate.evidence],
  };
}
