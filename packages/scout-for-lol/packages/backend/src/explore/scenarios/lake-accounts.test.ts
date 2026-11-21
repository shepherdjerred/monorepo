import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ExploreScenarioAccountSelectorSchema } from "@scout-for-lol/data";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { resolveScenarioAccount } from "./lake-accounts.ts";

/**
 * Three accounts: one whose latest game froze as an end-of-game record, one
 * whose latest game has a timeline, and one with more games than either
 * whose latest game is complete without a timeline.
 */
const ROWS = [
  ["e".repeat(78), "Classic", "NA1_100", "2026-11-20 10:00:00", "end_of_game"],
  ["e".repeat(78), "Classic", "NA1_101", "2026-11-19 10:00:00", "complete"],
  ["t".repeat(78), "Timeline", "NA1_200", "2026-11-20 10:00:00", "complete"],
  ["b".repeat(78), "Busy", "NA1_300", "2026-11-20 11:00:00", "complete"],
  ["b".repeat(78), "Busy", "NA1_301", "2026-11-19 11:00:00", "end_of_game"],
  ["b".repeat(78), "Busy", "NA1_302", "2026-11-18 11:00:00", "complete"],
] as const;

let buildDir: string;

beforeAll(async () => {
  buildDir = await mkdtemp(path.join(tmpdir(), "scenario-accounts-"));
  await mkdir(path.join(buildDir, "matches", "month=2026-11"), {
    recursive: true,
  });
  await mkdir(path.join(buildDir, "timeline_coverage", "month=2026-11"), {
    recursive: true,
  });
  const values = ROWS.map(
    ([puuid, name, matchId, endedAt, coverage]) =>
      `('${puuid}', '${name}', 'NA1', 'NA1', '${matchId}', TIMESTAMP '${endedAt}', 1800, 'Ahri', '${coverage}')`,
  ).join(", ");
  await withDuckDBConnection(async (session) => {
    await session.run(
      `COPY (SELECT * FROM (VALUES ${values}) AS t(puuid, riot_id_game_name, riot_id_tagline, platform_id, match_id, game_end_at, game_duration_seconds, champion_name, coverage)) TO '${path.join(buildDir, "matches", "month=2026-11", "data.parquet")}' (FORMAT PARQUET)`,
    );
    await session.run(
      `COPY (SELECT 'NA1_200' AS match_id) TO '${path.join(buildDir, "timeline_coverage", "month=2026-11", "data.parquet")}' (FORMAT PARQUET)`,
    );
  });
});

afterAll(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

async function resolve(selector: unknown) {
  return await resolveScenarioAccount({
    buildDir,
    selector: ExploreScenarioAccountSelectorSchema.parse(selector),
    exclude: new Set(),
  });
}

describe("choosing a scenario account from the lake", () => {
  test("by default, the account with the most games", async () => {
    expect(await resolve({ kind: "lake" })).toMatchObject({
      gameName: "Busy",
      latestMatchId: "NA1_300",
    });
  });

  test("latestEndOfGame picks an account whose latest game is an end-of-game record", async () => {
    // Busy has an end-of-game game, but not as its latest.
    expect(
      await resolve({ kind: "lake", latestEndOfGame: true }),
    ).toMatchObject({ gameName: "Classic", latestMatchId: "NA1_100" });
  });

  test("withTimeline still picks an account whose latest game has a timeline", async () => {
    expect(await resolve({ kind: "lake", withTimeline: true })).toMatchObject({
      gameName: "Timeline",
      latestMatchId: "NA1_200",
    });
  });
});
