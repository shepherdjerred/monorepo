import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";

/**
 * The engine's intermediate row shape: one aggregated group, keyed back to the
 * plan's own output names.
 *
 * SQL and JS aggregation (lake sources vs `player_groups`) both produce this,
 * so everything downstream — result rows, evidence, temporal comparison,
 * snapshots — has exactly one shape to read.
 */

export type PlanGroupMember = { playerId: number; alias: string };

/**
 * The companions an output's confidence interval is computed from, already
 * read out of the query. Which shape appears is decided at ScoutQL compile
 * (`plan.outputs[i].evidence`), not here.
 */
export type PlanOutputEvidence =
  | { kind: "rate"; successes: number; trials: number }
  | { kind: "ratio"; numerator: number; denominator: number }
  | { kind: "sample"; sampleCount: number };

export type PlanOutputValue = {
  name: string;
  value: number | string | null;
  evidence: PlanOutputEvidence;
};

export type PlanAggregateRow = {
  /** The joined dimension label (' • ' between groupings, 'All' for none). */
  label: string;
  playerId: number | null;
  discordId: string | null;
  /**
   * The typed grouping keys, aligned with `plan.groupings`. These — not the
   * rendered label — are what the temporal comparison and the histogram
   * bucket labels key off: a label is a display string that two periods
   * legitimately spell differently.
   */
  keys: LakeScalar[];
  /** Member identities for a teammate-group row; null for every other row. */
  groupMembers: PlanGroupMember[] | null;
  outputs: PlanOutputValue[];
};

export type PlanAggregationResult = {
  rows: PlanAggregateRow[];
  rowsScanned: number;
};

/**
 * A result row paired with the same bucket from the preceding period, when
 * `compare = previous_period` asked for one. The pairing is decided by the
 * typed grouping keys (temporal-comparison.ts), never by the rendered label.
 */
export type PlanComparedRow = {
  row: PlanAggregateRow;
  baseline: PlanAggregateRow | null;
};
