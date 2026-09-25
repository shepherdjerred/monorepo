import { beforeAll, describe, expect, test } from "vitest";
import type { TimelineEventParticipantLakeRow } from "@scout-for-lol/data";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { PlanQueryInput } from "#src/reports/duckdb/compile-plan.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";
import { writeTempTestLake } from "#src/testing/test-report-lake.ts";
import { testEventRow } from "#src/testing/test-timeline-rows.ts";
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
 * Timeline events, compiled and run against a real seeded DuckDB lake.
 *
 * NA1_600, blue wins: Jax takes the first dragon at 6:30, Otto the second at
 * 12:00, Mira the Elder at 30:00; Mira kills Otto alone at 8:00 and again
 * with Jax's help at 14:00; a tower executes Mira at 15:00. NA1_601, red
 * wins: Otto takes the first dragon at 8:00 and Mira takes the Elder anyway at
 * 32:00. Otto is untracked.
 */

const SERVER_ID = testGuildId("791");
const MIRA = testPuuid("events-mira");
const JAX = testPuuid("events-jax");
const OTTO = testPuuid("events-otto");
const GAME_600 = new Date(Date.UTC(2026, 4, 4, 12));
const GAME_601 = new Date(Date.UTC(2026, 4, 6, 12));

let files: LakeFiles;

function event(
  row: Parameters<typeof testEventRow>[1],
): ReturnType<typeof testEventRow> {
  return testEventRow(row.match_id === "NA1_600" ? GAME_600 : GAME_601, row);
}

function dragon(
  eventId: string,
  matchId: string,
  input: { killer: number; team: number; atMs: number; kind: string },
): ReturnType<typeof testEventRow> {
  return event({
    event_id: eventId,
    match_id: matchId,
    event_type: "ELITE_MONSTER_KILL",
    event_timestamp_ms: input.atMs,
    killer_id: input.killer,
    killer_team_id: input.team,
    monster_type: "DRAGON",
    monster_sub_type: input.kind,
  });
}

function assist(
  eventId: string,
  participantId: number,
  puuid: string,
): TimelineEventParticipantLakeRow {
  return {
    event_id: eventId,
    match_id: "NA1_600",
    month: lakeMonth(GAME_600.getTime()),
    observed_at: lakeTimestamp(GAME_600.getTime()),
    participant_id: participantId,
    puuid,
    role: "assist",
    role_index: 0,
  };
}

beforeAll(async () => {
  const base = {
    queue: "solo",
    surrendered: false,
    kills: 0,
    deaths: 0,
    assists: 0,
  };
  // playerId doubles as the participant slot in the test lake.
  const mira = { ...base, playerId: 3, playerAlias: "Mira", puuid: MIRA };
  const jax = { ...base, playerId: 2, playerAlias: "Jax", puuid: JAX };
  const otto = { ...base, playerId: 8, playerAlias: "Otto", puuid: OTTO };
  files = await writeTempTestLake("scoutql-events-e2e-", {
    serverId: SERVER_ID,
    matchFacts: [
      {
        ...mira,
        matchId: "NA1_600",
        win: true,
        teamId: 100,
        championId: 103,
        championName: "Ahri",
        gameCreationAt: GAME_600,
      },
      {
        ...jax,
        matchId: "NA1_600",
        win: true,
        teamId: 100,
        championId: 24,
        championName: "Jax",
        gameCreationAt: GAME_600,
      },
      {
        ...mira,
        matchId: "NA1_601",
        win: false,
        teamId: 100,
        championId: 103,
        championName: "Ahri",
        gameCreationAt: GAME_601,
      },
    ],
    untrackedMatchFacts: [
      {
        ...otto,
        matchId: "NA1_600",
        win: false,
        teamId: 200,
        championId: 238,
        championName: "Zed",
        gameCreationAt: GAME_600,
      },
      {
        ...otto,
        matchId: "NA1_601",
        win: true,
        teamId: 200,
        championId: 238,
        championName: "Zed",
        gameCreationAt: GAME_601,
      },
    ],
    timelineEvents: [
      dragon("e1", "NA1_600", {
        killer: 2,
        team: 100,
        atMs: 390_000,
        kind: "FIRE_DRAGON",
      }),
      dragon("e2", "NA1_600", {
        killer: 8,
        team: 200,
        atMs: 720_000,
        kind: "WATER_DRAGON",
      }),
      event({
        event_id: "e3",
        match_id: "NA1_600",
        event_type: "CHAMPION_KILL",
        event_timestamp_ms: 480_000,
        killer_id: 3,
        victim_id: 8,
      }),
      event({
        event_id: "e4",
        match_id: "NA1_600",
        event_type: "CHAMPION_KILL",
        event_timestamp_ms: 840_000,
        killer_id: 3,
        victim_id: 8,
      }),
      // An execution: the tower got the kill, so no player did.
      event({
        event_id: "e8",
        match_id: "NA1_600",
        event_type: "CHAMPION_KILL",
        event_timestamp_ms: 900_000,
        killer_id: 0,
        victim_id: 3,
      }),
      dragon("e5", "NA1_600", {
        killer: 3,
        team: 100,
        atMs: 1_800_000,
        kind: "ELDER_DRAGON",
      }),
      dragon("e6", "NA1_601", {
        killer: 8,
        team: 200,
        atMs: 480_000,
        kind: "EARTH_DRAGON",
      }),
      dragon("e7", "NA1_601", {
        killer: 3,
        team: 100,
        atMs: 1_920_000,
        kind: "ELDER_DRAGON",
      }),
    ],
    timelineEventParticipants: [assist("e4", 2, JAX)],
  });
});

function eventsInput(
  plan: Partial<ScoutQlPlan>,
  overrides: Partial<PlanQueryInput> = {},
): PlanQueryInput {
  return sourceInput(files, { source: "timeline_events", ...plan }, overrides);
}

const FIRST_DRAGON = and(
  eq("event_type", "ELITE_MONSTER_KILL"),
  eq("monster_type", "DRAGON"),
  eq("is_first_of_kind", true),
);

describe("timeline_events end-to-end", () => {
  test("averages the time of each game's first dragon", async () => {
    const { rows } = await runPlan(
      eventsInput({
        outputs: [avgOf(col("event_timestamp_ms"))],
        where: FIRST_DRAGON,
      }),
    );
    // 6:30 in one game and 8:00 in the other.
    expect(number_(rows[0]?.["expr_0"])).toBe((390_000 + 480_000) / 2);
  });

  test("decides which dragon was first before any filter applies", async () => {
    // NA1_600's water dragon came second. Filtering to water dragons must not
    // promote it to "first" — which it would if the filter reached the window.
    const { rows } = await runPlan(
      eventsInput({
        where: and(FIRST_DRAGON, eq("monster_sub_type", "WATER_DRAGON")),
      }),
    );
    expect(rows).toHaveLength(0);
  });

  test("reports how often the team that took Elder won", async () => {
    const { rows } = await runPlan(
      eventsInput({
        outputs: [
          avgOf({ kind: "cast", to: "int", operand: col("killer_team_won") }),
        ],
        where: eq("monster_sub_type", "ELDER_DRAGON"),
      }),
    );
    // Blue took Elder and won one game; blue took Elder and lost the other.
    expect(number_(rows[0]?.["expr_0"])).toBe(0.5);
  });

  test("groups by a looked-up column, joining its lookup", async () => {
    const { rows } = await runPlan(
      eventsInput({
        where: eq("monster_sub_type", "ELDER_DRAGON"),
        groupings: [
          {
            kind: "column",
            column: "killer_team_won",
            name: "killer_team_won",
          },
        ],
      }),
    );
    // One Elder taken by the winners, one by the losers.
    expect(rows.map((row) => String(row["label"])).toSorted()).toEqual([
      "false",
      "true",
    ]);
  });

  test("counts solo kills per player, not assisted ones or executions", async () => {
    const { rows } = await runPlan(
      eventsInput({
        where: eq("is_solo_kill", true),
        groupings: [{ kind: "column", column: "player", name: "player" }],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(number_(rows[0]?.["expr_0"])).toBe(1);
  });

  test("server scope keeps events whose actor the server tracks", async () => {
    const { rows } = await runPlan(
      eventsInput(
        { where: eq("event_type", "ELITE_MONSTER_KILL") },
        { scope: guildScope(SERVER_ID) },
      ),
    );
    // Jax's dragon and Mira's two Elders; Otto's two dragons are untracked.
    expect(number_(rows[0]?.["expr_0"])).toBe(3);
  });
});
