import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  clashSightingWriteFromLake,
  clashLakeObservedSinceClause,
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

  test("adds an observed_ms watermark only when a previous sighting exists", () => {
    expect(clashLakeObservedSinceClause(undefined)).toEqual({
      sql: "",
      params: [],
    });
    const clause = clashLakeObservedSinceClause(1_700_000_000_000);
    expect(clause.sql).toBe(" AND observed_ms >= ?");
    expect(clause.params).toHaveLength(1);
  });
});
