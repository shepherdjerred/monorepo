import { LeaguePuuidSchema } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import { mergeClashSighting } from "./sighting.ts";
import type { ClashSightingWrite } from "./sighting.ts";

const incomingPrematch: ClashSightingWrite = {
  platform: "NA1",
  gameId: "1",
  puuid: LeaguePuuidSchema.parse("p".repeat(78)),
  source: "prematch",
  queue: "clash",
  championId: 99,
  teamId: 100,
  observedAt: new Date("2026-09-19T18:00:00.000Z"),
  win: null,
};

describe("mergeClashSighting", () => {
  test("writes a new prematch lobby without a score", () => {
    const merged = mergeClashSighting({
      existing: undefined,
      incoming: incomingPrematch,
      labels: {
        cupKey: "bandle_city",
        cupDay: "day_1",
        teamRiotId: null,
      },
    });
    expect(merged.source).toBe("prematch");
    expect(merged.win).toBeNull();
    expect(merged.cupKey).toBe("bandle_city");
  });

  test("does not let a later lobby overwrite a scored match", () => {
    const merged = mergeClashSighting({
      existing: {
        source: "match",
        win: true,
        cupKey: "zaun",
        cupDay: "day_1",
        teamRiotId: null,
      },
      incoming: incomingPrematch,
      labels: { cupKey: null, cupDay: null, teamRiotId: null },
    });
    expect(merged.source).toBe("match");
    expect(merged.win).toBe(true);
    expect(merged.cupKey).toBe("zaun");
  });

  test("lets a scored match replace a lobby row", () => {
    const merged = mergeClashSighting({
      existing: {
        source: "prematch",
        win: null,
        cupKey: "demacia",
        cupDay: "day_1",
        teamRiotId: null,
      },
      incoming: { ...incomingPrematch, source: "match", win: false },
      labels: { cupKey: null, cupDay: null, teamRiotId: null },
    });
    expect(merged.source).toBe("match");
    expect(merged.win).toBe(false);
    expect(merged.cupKey).toBe("demacia");
  });
});
