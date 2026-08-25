import type { VisualizationSnapshot } from "@scout-for-lol/data";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";
import type { TemporalContext } from "#src/reports/temporal-plan.ts";
import type { TemporalRange } from "#src/reports/temporal-range.ts";

/**
 * The report query layer's result contract.
 *
 * `query-engine.ts` orchestrates aggregation, temporal comparison and
 * visualisation, and each of those modules consumes these shapes while the
 * engine imports their entry points back. Declaring the contract in its own
 * module is what keeps that from being an import cycle.
 */

export type ReportResultValue = {
  column: string;
  value: number | string | null;
  comparisonValue?: number | string | null;
  absoluteDelta?: number | null;
  percentageDelta?: number | null;
  comparisonSampleSize?: number;
  comparisonGames?: number;
  comparisonSuccesses?: number;
  comparisonNumerator?: number;
  comparisonDenominator?: number;
  sampleSize?: number;
  games?: number;
  successes?: number;
  numerator?: number;
  denominator?: number;
};

export type ReportMentionIdentity =
  | {
      kind: "player";
      playerId: number | null;
      alias: string;
      discordId: string | null;
    }
  | {
      kind: "group";
      members: { playerId: number; alias: string }[];
    };

export type ReportResultRow = {
  label: string;
  dimensions: string[];
  /**
   * The typed grouping keys behind the label, aligned with `plan.groupings`.
   * Charts read these rather than re-parsing the label: a numeric histogram
   * bucket has to sort as a number, and a week bucket has to compare as a
   * date, neither of which a display string can be trusted for.
   */
  keys: LakeScalar[];
  mentionIdentity: ReportMentionIdentity | null;
  values: ReportResultValue[];
};

export type ReportQueryResult = {
  plan: ScoutQlPlan;
  columns: string[];
  rows: ReportResultRow[];
  rowsScanned: number;
  /** The range actually executed, after competition clamping or an override. */
  range: TemporalRange;
  /** Set when `compare = previous_period` ran a second aggregation. */
  temporal?: TemporalContext | undefined;
  visualization?: VisualizationSnapshot;
  evidence?: {
    label: string;
    games: number;
    values: {
      column: string;
      sampleSize: number;
      successes?: number;
      numerator?: number;
      denominator?: number;
    }[];
  }[];
};
