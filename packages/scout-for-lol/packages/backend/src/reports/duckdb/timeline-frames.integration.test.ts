import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { TimelineParticipantFrameLakeRow } from "@scout-for-lol/data";
import { DEFAULT_RENDER_SPEC } from "@scout-for-lol/data/model/reports/report.ts";
import type {
  ScoutQlOutput,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import type { PlanQueryInput } from "#src/reports/duckdb/compile-plan.ts";
import { resolveLakeFiles, type LakeFiles } from "#src/reports/duckdb/lake.ts";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";
import { writeTestLake } from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import { number_, runPlan } from "#src/testing/run-compiled-plan.ts";

/**
 * Timeline frames, compiled and run against a real seeded DuckDB lake.
 *
 * One solo game. Mira (Ahri) mid and Jax jungle on blue, Otto (Zed) mid on
 * red. Frames at 0, 10 and 15 minutes. Every expected value below is
 * arithmetic on those rows, written out so a reader can check it.
 */

const SERVER_ID = testGuildId("781");
const MIRA = testPuuid("frames-mira");
const JAX = testPuuid("frames-jax");
const OTTO = testPuuid("frames-otto");
const GAME = new Date(Date.UTC(2026, 4, 4, 12));

let files: LakeFiles;

function frame(input: {
  puuid: string;
  participantId: number;
  minute: number;
  totalGold: number;
  minions: number;
  jungle: number;
}): TimelineParticipantFrameLakeRow {
  const { puuid, participantId, minute, totalGold, minions, jungle } = input;
  return {
    match_id: "NA1_500",
    month: lakeMonth(GAME.getTime()),
    observed_at: lakeTimestamp(GAME.getTime()),
    frame_index: minute,
    // Real frames land a few milliseconds past the minute.
    frame_timestamp_ms: minute * 60_000 + 23,
    participant_id: participantId,
    puuid,
    position_x: 0,
    position_y: 0,
    current_gold: 0,
    total_gold: totalGold,
    gold_per_second: 0,
    minions_killed: minions,
    jungle_minions_killed: jungle,
    level: 1,
    xp: 0,
    time_enemy_spent_controlled: 0,
    ability_haste: null,
    ability_power: null,
    armor: null,
    attack_damage: null,
    attack_speed: null,
    health: null,
    health_max: null,
    magic_resist: null,
    movement_speed: null,
    power: null,
    power_max: null,
    total_damage_done: null,
    total_damage_done_to_champions: null,
    total_damage_taken: null,
  };
}

beforeAll(async () => {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "scoutql-frames-e2e-"));
  const base = {
    matchId: "NA1_500",
    queue: "solo",
    surrendered: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    gameCreationAt: GAME,
  };
  await writeTestLake(lakeDir, {
    serverId: SERVER_ID,
    matchFacts: [
      {
        ...base,
        playerId: 1,
        playerAlias: "Mira",
        puuid: MIRA,
        win: true,
        teamId: 100,
        teamPosition: "MIDDLE",
        championId: 103,
        championName: "Ahri",
      },
      {
        ...base,
        playerId: 2,
        playerAlias: "Jax",
        puuid: JAX,
        win: true,
        teamId: 100,
        teamPosition: "JUNGLE",
        championId: 24,
        championName: "Jax",
      },
    ],
    untrackedMatchFacts: [
      {
        ...base,
        playerId: 9,
        playerAlias: "Otto",
        puuid: OTTO,
        win: false,
        teamId: 200,
        teamPosition: "MIDDLE",
        championId: 238,
        championName: "Zed",
      },
    ],
    timelineFrames: [
      frame({
        puuid: MIRA,
        participantId: 3,
        minute: 0,
        totalGold: 500,
        minions: 0,
        jungle: 0,
      }),
      frame({
        puuid: MIRA,
        participantId: 3,
        minute: 10,
        totalGold: 3800,
        minions: 80,
        jungle: 4,
      }),
      frame({
        puuid: MIRA,
        participantId: 3,
        minute: 15,
        totalGold: 6000,
        minions: 120,
        jungle: 4,
      }),
      frame({
        puuid: JAX,
        participantId: 2,
        minute: 0,
        totalGold: 500,
        minions: 0,
        jungle: 0,
      }),
      frame({
        puuid: JAX,
        participantId: 2,
        minute: 10,
        totalGold: 3500,
        minions: 6,
        jungle: 50,
      }),
      frame({
        puuid: JAX,
        participantId: 2,
        minute: 15,
        totalGold: 5500,
        minions: 8,
        jungle: 70,
      }),
      frame({
        puuid: OTTO,
        participantId: 8,
        minute: 0,
        totalGold: 500,
        minions: 0,
        jungle: 0,
      }),
      frame({
        puuid: OTTO,
        participantId: 8,
        minute: 10,
        totalGold: 3300,
        minions: 70,
        jungle: 0,
      }),
      frame({
        puuid: OTTO,
        participantId: 8,
        minute: 15,
        totalGold: 5200,
        minions: 100,
        jungle: 0,
      }),
    ],
  });
  files = await resolveLakeFiles(lakeDir);
});

function col(column: string): ScoutQlScalarExpr {
  return { kind: "column", column };
}

function eq(column: string, value: number | string): ScoutQlPredicate {
  return {
    kind: "compare",
    op: "=",
    left: col(column),
    right: { kind: "literal", value },
  };
}

function avg(column: string): ScoutQlOutput {
  return {
    name: column,
    expr: { kind: "aggregate", func: "avg", arg: col(column), distinct: false },
    displayKind: "decimal",
    additive: false,
    evidence: { kind: "sample" },
  };
}

function framesInput(
  plan: Partial<ScoutQlPlan>,
  overrides: Partial<PlanQueryInput> = {},
): PlanQueryInput {
  return {
    plan: {
      source: "timeline_frames",
      outputs: [avg("creep_score")],
      timeWindow: { kind: "unbounded" },
      groupings: [],
      orderBy: [],
      limit: 25,
      playerRefs: [],
      render: DEFAULT_RENDER_SPEC,
      ...plan,
    },
    scope: GLOBAL_SCOPE,
    files,
    range: { start: new Date(0), end: new Date(Date.UTC(2027, 0, 1)) },
    limit: 25,
    ...overrides,
  };
}

/** First output by row label; a NULL result is left out, not read as a number. */
function byLabel(rows: Record<string, unknown>[]): Map<string, number> {
  return new Map(
    rows.flatMap((row) =>
      row["expr_0"] === null
        ? []
        : [[String(row["label"]), number_(row["expr_0"])] as const],
    ),
  );
}

describe("timeline_frames end-to-end", () => {
  test("CS at ten minutes counts lane and jungle, by player", async () => {
    const { rows } = await runPlan(
      framesInput({
        where: eq("minute", 10),
        groupings: [{ kind: "column", column: "player", name: "player" }],
      }),
    );
    const cs = byLabel(rows);
    // 80 lane + 4 jungle; the jungler's 6 + 50; Otto's 70.
    expect([...cs.values()].toSorted((a, b) => a - b)).toEqual([56, 70, 84]);
  });

  test("lane gold difference pairs a laner with the same position on the other team", async () => {
    const { rows } = await runPlan(
      framesInput({
        outputs: [avg("lane_gold_diff")],
        where: eq("minute", 15),
        groupings: [{ kind: "column", column: "champion", name: "champion" }],
      }),
    );
    const lead = byLabel(rows);
    expect(lead.get("Ahri")).toBe(6000 - 5200);
    expect(lead.get("Zed")).toBe(5200 - 6000);
    // Red has no jungler, so blue's has nobody to be compared with.
    expect(rows.find((row) => row["label"] === "Jax")?.["expr_0"]).toBeNull();
  });

  test("team gold difference ignores a filter on whose frames are shown", async () => {
    // Filtering to Mira's frames must not shrink her team to Mira: blue's
    // 3800 + 3500 against red's 3300 at ten minutes.
    const { rows } = await runPlan(
      framesInput({
        outputs: [avg("team_gold_diff")],
        where: {
          kind: "and",
          operands: [eq("minute", 10), eq("puuid", MIRA)],
        },
      }),
    );
    expect(number_(rows[0]?.["expr_0"])).toBe(3800 + 3500 - 3300);
  });

  test("server scope keeps only the server's tracked players", async () => {
    const { rows } = await runPlan(
      framesInput(
        {
          where: eq("minute", 10),
          groupings: [{ kind: "column", column: "player", name: "player" }],
        },
        { scope: guildScope(SERVER_ID) },
      ),
    );
    expect([...byLabel(rows).keys()].toSorted()).toEqual(["Jax", "Mira"]);
  });

  test("the time window reaches frames through the participant row", async () => {
    const { rows } = await runPlan(
      framesInput(
        {},
        {
          range: {
            start: new Date(Date.UTC(2026, 5, 1)),
            end: new Date(Date.UTC(2027, 0, 1)),
          },
        },
      ),
    );
    // The only game is in May; a June-onward window has no frames at all.
    expect(rows).toHaveLength(0);
  });
});
