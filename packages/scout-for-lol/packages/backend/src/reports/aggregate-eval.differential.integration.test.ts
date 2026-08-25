import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import {
  evaluateAggregate,
  type AggregateEvalContext,
  type FactRow,
} from "#src/reports/aggregate-eval.ts";
import { runPlanAggregation } from "#src/reports/duckdb/execute.ts";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import type {
  PlanAggregateRow,
  PlanOutputEvidence,
} from "#src/reports/plan-rows.ts";
import { writeTestLake } from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

/**
 * SQL-vs-JS differential.
 *
 * `player_groups` aggregates in JS (aggregate-eval.ts) because its unit is a
 * k-subset of the players in one game, which is not a relation DuckDB can
 * GROUP BY. Every other source aggregates in SQL. Two implementations of one
 * expression language drift silently, so this pins them together: the same
 * plan runs through the lake and through the evaluator over the same facts,
 * and both the values AND the evidence counts must agree.
 *
 * Evidence is asserted deliberately. A rate's value stays plausible when its
 * denominator is wrong — only the error bar moves, and the error bar is the
 * half a reader treats as authoritative.
 */

const SERVER_ID = testGuildId("881");
const PLAYER = testPuuid("differential-player");
const DAY = new Date(Date.UTC(2026, 4, 10, 12));

/** kills, deaths, win, queue (null = an unmapped queue). */
const FACTS: {
  kills: number;
  deaths: number;
  win: boolean;
  queue: string | null;
}[] = [
  { kills: 2, deaths: 4, win: false, queue: "solo" },
  { kills: 7, deaths: 1, win: true, queue: "solo" },
  { kills: 12, deaths: 6, win: false, queue: "flex" },
  { kills: 20, deaths: 2, win: true, queue: null },
  { kills: 3, deaths: 3, win: true, queue: null },
];

let lakeDir: string;

beforeAll(async () => {
  lakeDir = await mkdtemp(path.join(tmpdir(), "scoutql-differential-"));
  await writeTestLake(lakeDir, {
    serverId: SERVER_ID,
    matchFacts: FACTS.map((fact, index) => ({
      playerId: 1,
      playerAlias: "Differential",
      matchId: `NA1_diff_${index.toString()}`,
      puuid: PLAYER,
      queue: fact.queue,
      win: fact.win,
      surrendered: false,
      kills: fact.kills,
      deaths: fact.deaths,
      assists: 1,
      gameCreationAt: DAY,
    })),
  });
});

/** The same facts as rows the JS evaluator reads. */
function jsRows(): FactRow[] {
  return FACTS.map(
    (fact) =>
      new Map<string, LakeScalar>([
        ["kills", fact.kills],
        ["deaths", fact.deaths],
        ["win", fact.win],
        ["queue", fact.queue],
      ]),
  );
}

async function sqlRow(plan: ScoutQlPlan): Promise<PlanAggregateRow> {
  const result = await runPlanAggregation({
    plan,
    scope: guildScope(SERVER_ID),
    range: {
      start: new Date(Date.UTC(2026, 0, 1)),
      end: new Date(Date.UTC(2026, 11, 31)),
    },
    limit: 100,
    lakeDir,
  });
  const [row] = result.rows;
  if (row === undefined) throw new Error("expected one aggregated row");
  return row;
}

function jsOutputs(plan: ScoutQlPlan): PlanAggregateRow["outputs"] {
  const outputs = new Map<string, LakeScalar>();
  const ctx: AggregateEvalContext = {
    rows: jsRows(),
    outputs,
    filterableColumns: new Set(["win", "queue"]),
  };
  return plan.outputs.map((output) => {
    if (output.expr.kind === "grouping-ref") {
      throw new Error("the differential plans select no grouping echoes");
    }
    const value = evaluateAggregate(output.expr, ctx);
    outputs.set(output.name, value);
    return {
      name: output.name,
      value: typeof value === "boolean" ? String(value) : value,
      evidence: jsEvidence(output.evidence, ctx),
    };
  });
}

function jsEvidence(
  evidence: ScoutQlPlan["outputs"][number]["evidence"],
  ctx: AggregateEvalContext,
): PlanOutputEvidence {
  if (evidence.kind === "rate") {
    return {
      kind: "rate",
      successes: numeric(evaluateAggregate(evidence.successes, ctx)),
      trials: numeric(evaluateAggregate(evidence.trials, ctx)),
    };
  }
  if (evidence.kind === "ratio") {
    return {
      kind: "ratio",
      numerator: numeric(evaluateAggregate(evidence.numerator, ctx)),
      denominator: numeric(evaluateAggregate(evidence.denominator, ctx)),
    };
  }
  return { kind: "sample", sampleCount: ctx.rows.length };
}

function numeric(value: LakeScalar): number {
  if (value === null) return 0;
  if (typeof value !== "number") {
    throw new TypeError("evidence companions must be numeric");
  }
  return value;
}

function closeEnough(left: LakeScalar, right: LakeScalar): void {
  if (typeof left === "number" && typeof right === "number") {
    expect(left).toBeCloseTo(right, 10);
    return;
  }
  expect(left).toEqual(right);
}

async function assertAgreement(query: string): Promise<void> {
  const plan = compileScoutQl(query);
  const sql = await sqlRow(plan);
  const js = jsOutputs(plan);
  expect(js.map((output) => output.name)).toEqual(
    sql.outputs.map((output) => output.name),
  );
  for (const [index, expected] of sql.outputs.entries()) {
    const actual = js[index];
    if (actual === undefined) throw new Error("output arity mismatch");
    closeEnough(actual.value, expected.value);
    expect(actual.evidence.kind).toBe(expected.evidence.kind);
    if (actual.evidence.kind === "rate" && expected.evidence.kind === "rate") {
      expect(actual.evidence.successes).toBe(expected.evidence.successes);
      expect(actual.evidence.trials).toBe(expected.evidence.trials);
    }
    if (
      actual.evidence.kind === "ratio" &&
      expected.evidence.kind === "ratio"
    ) {
      closeEnough(actual.evidence.numerator, expected.evidence.numerator);
      closeEnough(actual.evidence.denominator, expected.evidence.denominator);
    }
  }
}

const FROM = "FROM match_participants GROUP BY player";

describe("SQL and JS agree on the same aggregate expressions", () => {
  test("counts, sums and a plain rate", async () => {
    await assertAgreement(
      `SELECT COUNT(*) AS games, SUM(kills) AS kills, SUM(deaths) AS deaths, AVG(win::INT) AS win_rate ${FROM}`,
    );
  });

  test("a conditional rate over a NULLABLE column keeps the same denominator", async () => {
    // `queue` is NULL for an unmapped queue, so `(queue = 'solo')` is NULL —
    // not false — for those rows. Both halves must drop them: the average AND
    // its trial count. A two-valued evaluator would score them as misses and
    // report the same value against a larger denominator.
    await assertAgreement(
      `SELECT AVG((queue = 'solo')::INT) AS solo_share, COUNT(*) AS games ${FROM}`,
    );
    const plan = compileScoutQl(
      `SELECT AVG((queue = 'solo')::INT) AS solo_share ${FROM}`,
    );
    const row = await sqlRow(plan);
    const evidence = row.outputs[0]?.evidence;
    if (evidence?.kind !== "rate") throw new Error("expected rate evidence");
    // Three rows have a mapped queue; two of those are solo.
    expect(evidence).toEqual({ kind: "rate", successes: 2, trials: 3 });
  });

  test("percentiles, spread and extremes", async () => {
    await assertAgreement(
      `SELECT MEDIAN(kills) AS med, QUANTILE_CONT(kills, 0.9) AS p90, STDDEV(kills) AS spread, MIN(kills) AS low, MAX(kills) AS high ${FROM}`,
    );
  });

  test("an additive quotient and its ratio evidence", async () => {
    await assertAgreement(
      `SELECT SUM(kills) / NULLIF(SUM(deaths), 0) AS kd ${FROM}`,
    );
  });

  test("FILTER narrows the aggregate and its evidence together", async () => {
    await assertAgreement(
      "SELECT COUNT(*) FILTER (WHERE queue = 'solo') AS solo_games, " +
        "AVG(win::INT) FILTER (WHERE queue = 'solo') AS solo_win_rate, " +
        `SUM(kills) FILTER (WHERE win) AS winning_kills ${FROM}`,
    );
  });

  test("arithmetic over aggregates, rounding and NULL guards", async () => {
    await assertAgreement(
      "SELECT ROUND(AVG(win::INT), 2) AS win_rate, " +
        "(SUM(kills) + 1) * 2 AS scaled, " +
        `COALESCE(SUM(kills) / NULLIF(COUNT(*), 0), 0) AS kills_per_game ${FROM}`,
    );
  });
});
