import { z } from "zod";

/**
 * The Dare v2 expression vocabulary: which participant and game fields a
 * contract may read, and the recursive value/predicate shapes built from them.
 *
 * Split out from `dare-contract-v2.ts` so `dare-domains.ts` can validate the
 * values these fields carry without importing the contract schema back — the
 * schema needs the domain walk in its `superRefine`, so the dependency has to
 * run one way only.
 */
export const DareParticipantValueFieldV2Schema = z.enum([
  "champion_name",
  "team_position",
  "team_id",
  "win",
  "kills",
  "deaths",
  "assists",
  "creep_score",
  "gold_earned",
  "vision_score",
  "time_played",
  "total_damage_dealt_to_champions",
  "wards_placed",
  "wards_killed",
  "double_kills",
  "triple_kills",
  "quadra_kills",
  "penta_kills",
]);

export const DareParticipantRateFieldV2Schema = z.enum([
  "cs_per_minute",
  "damage_per_minute",
  "kda",
]);

export type DareValueV2 =
  | {
      kind: "participant";
      target: string;
      field: z.infer<typeof DareParticipantValueFieldV2Schema>;
    }
  | {
      kind: "participant_rate";
      target: string;
      field: z.infer<typeof DareParticipantRateFieldV2Schema>;
    }
  | { kind: "game"; field: "duration_seconds" | "queue" }
  | {
      kind: "related_participant_count";
      target: string;
      relationship: "ally" | "opponent";
      championName: string | null;
    }
  | {
      kind: "timeline_event_count";
      eventType: string;
      target: string | null;
      role: "subject" | "killer" | "victim" | "assist" | "creator" | null;
      afterMs: number | null;
      beforeMs: number | null;
      itemId: number | null;
      monsterType: string | null;
      buildingType: string | null;
    }
  | {
      kind: "arithmetic";
      operator: "add" | "subtract" | "multiply" | "divide";
      left: DareValueV2;
      right: DareValueV2;
    };

export type DareBooleanExpressionV2 =
  | {
      kind: "comparison";
      value: DareValueV2;
      operator: "eq" | "neq" | "gte" | "lte" | "gt" | "lt";
      threshold: string | number | boolean;
    }
  | { kind: "and" | "or"; operands: DareBooleanExpressionV2[] }
  | { kind: "not"; operand: DareBooleanExpressionV2 };
