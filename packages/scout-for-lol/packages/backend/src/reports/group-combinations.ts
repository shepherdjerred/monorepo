import type {
  ScoutQlGroupSize,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import {
  evaluateAggregate,
  evaluateHaving,
  type AggregateEvalContext,
  type FactRow,
} from "#src/reports/aggregate-eval.ts";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";
import type {
  PlanAggregateRow,
  PlanGroupMember,
  PlanOutputValue,
} from "#src/reports/plan-rows.ts";

/**
 * Teammate-group folding for the `player_groups` source.
 *
 * A "group unit" is the set of tracked players who shared a team in one match:
 * (matchId, teamId) for standard queues, plus playerSubteamId for Arena, where
 * teamId 100/200 is a whole side spanning several unrelated 2-3 player
 * subteams. Every size-k member combination of each unit becomes one folded
 * GAME row for that player tuple, and the plan's aggregates then run over
 * those rows in JS (aggregate-eval.ts).
 *
 * Folding a member set into one game row follows the catalog's own split:
 * game-level columns (win, queue, game_duration_seconds …) are identical
 * across a unit's members and are carried through unchanged, while
 * member-scoped counters (kills, gold_earned …) are summed. That is why the
 * catalog refuses to expose per-member identity or position columns for this
 * source — "which member?" has no answer for a group row.
 */

export type GroupFactRow = {
  playerId: number;
  playerAlias: string;
  matchId: string;
  teamId: number;
  /** Arena subteam (1-8); null for every non-Arena queue. */
  playerSubteamId: number | null;
  /** The referenced value columns for this participant. */
  values: ReadonlyMap<string, LakeScalar>;
};

export type FoldedGroup = {
  members: PlanGroupMember[];
  label: string;
  games: FactRow[];
};

export type GroupFoldInput = {
  facts: readonly GroupFactRow[];
  size: ScoutQlGroupSize;
  /** Columns identical across a unit's members (carried, never summed). */
  gameLevelColumns: ReadonlySet<string>;
};

export function foldGroupCombinations(input: GroupFoldInput): FoldedGroup[] {
  const units = new Map<string, Map<number, GroupFactRow>>();
  for (const fact of input.facts) {
    const unitKey = `${fact.matchId}:${fact.teamId.toString()}:${fact.playerSubteamId?.toString() ?? "-"}`;
    const unit = units.get(unitKey) ?? new Map<number, GroupFactRow>();
    // A player with two tracked accounts in one match keeps one fact; the SQL
    // projection already deduplicates, so this only guards hand-built inputs.
    unit.set(fact.playerId, fact);
    units.set(unitKey, unit);
  }

  const groups = new Map<string, FoldedGroup>();
  for (const unit of units.values()) {
    const members = [...unit.values()].toSorted(
      (left, right) => left.playerId - right.playerId,
    );
    const sizes =
      input.size === "all" ? rangeInclusive(2, members.length) : [input.size];
    for (const size of sizes) {
      forEachCombination(members, size, (combination) => {
        const key = combination
          .map((member) => member.playerId.toString())
          .join("|");
        const existing = groups.get(key) ?? emptyGroup(combination);
        existing.games.push(foldGameRow(combination, input.gameLevelColumns));
        groups.set(key, existing);
      });
    }
  }
  return [...groups.values()];
}

function emptyGroup(combination: GroupFactRow[]): FoldedGroup {
  return {
    members: combination.map((member) => ({
      playerId: member.playerId,
      alias: member.playerAlias,
    })),
    label: combination.map((member) => member.playerAlias).join(" + "),
    games: [],
  };
}

function foldGameRow(
  combination: GroupFactRow[],
  gameLevelColumns: ReadonlySet<string>,
): FactRow {
  const first = combination[0];
  if (first === undefined) {
    throw new Error("unreachable: a combination always holds members");
  }
  const folded = new Map<string, LakeScalar>();
  for (const column of first.values.keys()) {
    if (gameLevelColumns.has(column)) {
      folded.set(column, first.values.get(column) ?? null);
      continue;
    }
    folded.set(column, sumAcrossMembers(combination, column));
  }
  return folded;
}

function sumAcrossMembers(
  combination: GroupFactRow[],
  column: string,
): LakeScalar {
  let total: number | null = null;
  for (const member of combination) {
    const value = member.values.get(column) ?? null;
    if (value === null) continue;
    if (typeof value !== "number") {
      throw new TypeError(
        `Column "${column}" is member-scoped but is not numeric, so a teammate group has no value for it.`,
      );
    }
    total = (total ?? 0) + value;
  }
  return total;
}

function rangeInclusive(from: number, to: number): number[] {
  const out: number[] = [];
  for (let value = from; value <= to; value++) {
    out.push(value);
  }
  return out;
}

// Iterative k-subset enumeration over the (playerId-sorted) member array, so
// every emitted combination is already in canonical order.
function forEachCombination(
  members: GroupFactRow[],
  size: number,
  visit: (group: GroupFactRow[]) => void,
): void {
  if (size < 2 || size > members.length) {
    return;
  }
  const indices = rangeInclusive(0, size - 1);
  for (;;) {
    visit(
      indices
        .map((index) => members[index])
        .filter((member) => member !== undefined),
    );
    // Advance to the next combination (rightmost index that can move).
    let cursor = size - 1;
    while (cursor >= 0) {
      const current = indices[cursor];
      if (current !== undefined && current < members.length - (size - cursor)) {
        break;
      }
      cursor--;
    }
    if (cursor < 0) {
      return;
    }
    const bumped = (indices[cursor] ?? 0) + 1;
    for (let fill = cursor; fill < size; fill++) {
      indices[fill] = bumped + (fill - cursor);
    }
  }
}

// ── Aggregation: the JS half of what SQL does for every other source ─────────

export type GroupAggregationInput = {
  plan: ScoutQlPlan;
  groups: FoldedGroup[];
  gameLevelColumns: ReadonlySet<string>;
  limit: number;
};

/**
 * Evaluate the plan's outputs, HAVING, ORDER BY and LIMIT over folded groups.
 * The ordering rule matches the SQL path exactly: every key NULLS LAST, then
 * `label ASC` as the final tiebreak, so the two paths cannot disagree about
 * which rows survive a LIMIT.
 */
export function aggregateFoldedGroups(
  input: GroupAggregationInput,
): PlanAggregateRow[] {
  const rows = input.groups.flatMap((group) => {
    const outputs = new Map<string, LakeScalar>();
    const ctx: AggregateEvalContext = {
      rows: group.games,
      outputs,
      filterableColumns: input.gameLevelColumns,
    };
    const values: PlanOutputValue[] = input.plan.outputs.map((output) => {
      if (output.expr.kind === "grouping-ref") {
        throw new Error(
          "player_groups rows have no grouping key to echo — group(...) is the only grouping.",
        );
      }
      const value = evaluateAggregate(output.expr, ctx);
      outputs.set(output.name, value);
      return {
        name: output.name,
        value: typeof value === "boolean" ? String(value) : value,
        evidence: groupEvidence(output.evidence, ctx),
      };
    });
    if (
      input.plan.having !== undefined &&
      !evaluateHaving(input.plan.having, ctx)
    ) {
      return [];
    }
    return [
      {
        label: group.label,
        playerId: null,
        discordId: null,
        keys: [],
        groupMembers: group.members,
        outputs: values,
      },
    ];
  });
  return orderGroupRows(rows, input.plan).slice(0, input.limit);
}

function groupEvidence(
  evidence: ScoutQlPlan["outputs"][number]["evidence"],
  ctx: AggregateEvalContext,
): PlanOutputValue["evidence"] {
  if (evidence.kind === "rate") {
    return {
      kind: "rate",
      successes: evidenceCount(evaluateAggregate(evidence.successes, ctx)),
      trials: evidenceCount(evaluateAggregate(evidence.trials, ctx)),
    };
  }
  if (evidence.kind === "ratio") {
    return {
      kind: "ratio",
      numerator: evidenceCount(evaluateAggregate(evidence.numerator, ctx)),
      denominator: evidenceCount(evaluateAggregate(evidence.denominator, ctx)),
    };
  }
  return { kind: "sample", sampleCount: ctx.rows.length };
}

function evidenceCount(value: LakeScalar): number {
  if (value === null) return 0;
  if (typeof value !== "number") {
    throw new TypeError("Evidence companions must evaluate to numbers.");
  }
  return value;
}

function orderGroupRows(
  rows: PlanAggregateRow[],
  plan: ScoutQlPlan,
): PlanAggregateRow[] {
  return rows.toSorted((left, right) => {
    for (const key of plan.orderBy) {
      if (key.target.kind === "grouping") {
        throw new Error(
          "player_groups queries cannot ORDER BY a grouping key.",
        );
      }
      const comparison = compareOutputs(
        outputValue(left, key.target.name),
        outputValue(right, key.target.name),
        key.direction,
      );
      if (comparison !== 0) return comparison;
    }
    return left.label.localeCompare(right.label);
  });
}

function outputValue(
  row: PlanAggregateRow,
  name: string,
): number | string | null {
  const output = row.outputs.find((candidate) => candidate.name === name);
  if (output === undefined) {
    throw new Error(`ORDER BY target "${name}" is not an output.`);
  }
  return output.value;
}

function compareOutputs(
  left: number | string | null,
  right: number | string | null,
  direction: "asc" | "desc",
): number {
  // NULLS LAST in both directions, exactly as the SQL ORDER BY clause spells.
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const ordering =
    typeof left === "string" || typeof right === "string"
      ? String(left).localeCompare(String(right))
      : left - right;
  return direction === "asc" ? ordering : -ordering;
}
