import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  clashSightingWriteFromLake,
  clashLakeRowsMissingFromSightings,
} from "./backfill.ts";

describe("clashSightingWriteFromLake", () => {
  test("maps a scored leftover match and a lobby prematch", () => {
    const puuid = LeaguePuuidSchema.parse("p".repeat(78));
    const scored = clashSightingWriteFromLake({
      platform_id: "EUW1",
      game_id: "7721480520",
      puuid,
      queue: "clash",
      champion_id: 157,
      team_id: 100,
      observed_ms: Date.parse("2026-02-07T18:00:00.000Z"),
      win: true,
      source: "match",
    });
    expect(scored.source).toBe("match");
    expect(scored.win).toBe(true);
    expect(scored.platform).toBe("EUW1");

    const lobby = clashSightingWriteFromLake({
      platform_id: "NA1",
      game_id: "5645340874",
      puuid,
      queue: "clash",
      champion_id: 234,
      team_id: 100,
      observed_ms: Date.parse("2026-09-19T18:00:00.000Z"),
      win: null,
      source: "prematch",
    });
    expect(lobby.source).toBe("prematch");
    expect(lobby.win).toBeNull();
  });

  test("keeps lake rows whose identity is not already stored", () => {
    const puuid = "p".repeat(78);
    const stored = {
      platform: "NA1",
      gameId: "100",
      puuid,
      source: "prematch",
    };
    const rows = [
      {
        platform_id: "NA1",
        game_id: "100",
        puuid,
        queue: "clash",
        champion_id: 1,
        team_id: 100,
        observed_ms: 1,
        win: null,
        source: "prematch" as const,
      },
      {
        platform_id: "NA1",
        game_id: "101",
        puuid,
        queue: "clash",
        champion_id: 2,
        team_id: 100,
        observed_ms: 2,
        win: null,
        source: "prematch" as const,
      },
    ];
    expect(clashLakeRowsMissingFromSightings(rows, [stored])).toEqual([
      rows[1],
    ]);
  });

  test("keeps a scored match that upgrades an existing lobby sighting", () => {
    const puuid = "p".repeat(78);
    const rows = [
      {
        platform_id: "NA1",
        game_id: "100",
        puuid,
        queue: "clash",
        champion_id: 1,
        team_id: 100,
        observed_ms: 1,
        win: true,
        source: "match" as const,
      },
    ];
    expect(
      clashLakeRowsMissingFromSightings(rows, [
        { platform: "NA1", gameId: "100", puuid, source: "prematch" },
      ]),
    ).toEqual(rows);
    expect(
      clashLakeRowsMissingFromSightings(rows, [
        { platform: "NA1", gameId: "100", puuid, source: "match" },
      ]),
    ).toEqual([]);
  });
});
