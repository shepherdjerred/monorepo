import { beforeAll, describe, expect, test } from "vitest";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { PlanQueryInput } from "#src/reports/duckdb/compile-plan.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import { writeTempTestLake } from "#src/testing/test-report-lake.ts";
import { testFrameRow } from "#src/testing/test-timeline-rows.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import {
  and,
  avgOf,
  col,
  eq,
  number_,
  runPlan,
  sourceInput,
} from "#src/testing/run-compiled-plan.ts";

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

beforeAll(async () => {
  const base = {
    matchId: "NA1_500",
    queue: "solo",
    surrendered: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    gameCreationAt: GAME,
  };
  files = await writeTempTestLake("scoutql-frames-e2e-", {
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
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: MIRA,
        participantId: 3,
        minute: 0,
        totalGold: 500,
        minions: 0,
        jungle: 0,
      }),
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: MIRA,
        participantId: 3,
        minute: 10,
        totalGold: 3800,
        minions: 80,
        jungle: 4,
      }),
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: MIRA,
        participantId: 3,
        minute: 15,
        totalGold: 6000,
        minions: 120,
        jungle: 4,
      }),
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: JAX,
        participantId: 2,
        minute: 0,
        totalGold: 500,
        minions: 0,
        jungle: 0,
      }),
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: JAX,
        participantId: 2,
        minute: 10,
        totalGold: 3500,
        minions: 6,
        jungle: 50,
      }),
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: JAX,
        participantId: 2,
        minute: 15,
        totalGold: 5500,
        minions: 8,
        jungle: 70,
      }),
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: OTTO,
        participantId: 8,
        minute: 0,
        totalGold: 500,
        minions: 0,
        jungle: 0,
      }),
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: OTTO,
        participantId: 8,
        minute: 10,
        totalGold: 3300,
        minions: 70,
        jungle: 0,
      }),
      testFrameRow({
        matchId: "NA1_500",
        gameCreationAt: GAME,
        puuid: OTTO,
        participantId: 8,
        minute: 15,
        totalGold: 5200,
        minions: 100,
        jungle: 0,
      }),
    ],
  });
});

function framesInput(
  plan: Partial<ScoutQlPlan>,
  overrides: Partial<PlanQueryInput> = {},
): PlanQueryInput {
  return sourceInput(
    files,
    {
      source: "timeline_frames",
      outputs: [avgOf(col("creep_score"))],
      ...plan,
    },
    overrides,
  );
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
        outputs: [avgOf(col("lane_gold_diff"))],
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
        outputs: [avgOf(col("team_gold_diff"))],
        where: and(eq("minute", 10), eq("puuid", MIRA)),
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
