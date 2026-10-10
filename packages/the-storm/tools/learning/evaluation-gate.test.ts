import { describe, expect, it } from "vitest";
import { evaluationSchedule, strengthResult } from "./evaluation-gate.ts";
import { unitMaps } from "./maps/test-support.ts";
import type { MapBinding } from "./maps/plan.ts";

function evidence(
  authoredWins = 120,
  basicWins = 160,
  mode = "pilot",
  maps = unitMaps.maps,
) {
  const matches = mode === "pilot" ? 200 : 2;
  const counts = { authored: 0, basic: 0 };
  return {
    version: 2,
    maps,
    engine: "Paper",
    mode,
    acceptance: "unaccepted",
    actor_seed: 17,
    weights_sha256: "a".repeat(64),
    manifest_sha256: "b".repeat(64),
    optimized: false,
    retried_duels: 0,
    blind_preference_checked: false,
    pilot_acceptance_checked: false,
    games: evaluationSchedule(matches, 500_000_000, maps).map(
      (matchup, index) => ({
        ...matchup,
        engine: "Paper",
        match: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        result:
          counts[matchup.opponent]++ <
          (matchup.opponent === "authored" ? authoredWins : basicWins)
            ? "win"
            : "timeout",
        frames: 100,
        submitted_controls: 98,
        confirmed_controls: 95,
        applied_controls: 95,
        authored_fallbacks: 5,
        missed_ticks: 1,
        rejected_actions: 1,
        memory_resets: 1,
        dealt: 20,
        received: 8,
        seconds: 5,
        max_inference_ms: 2,
      }),
    ),
  };
}

describe("frozen strength gates", () => {
  it("counts timeouts as non-wins and requires each full boundary", () => {
    const passed = strengthResult(evidence(), 200, 500_000_000, unitMaps.maps);
    expect(passed.passed).toBe(true);
    expect(
      passed.opponents.map((opponent) => [opponent.wins, opponent.timeouts]),
    ).toEqual([
      [120, 80],
      [160, 40],
    ]);
    expect(passed.opponents[0]?.authoredFallbacks).toBe(1000);
    expect(
      strengthResult(evidence(119, 160), 200, 500_000_000, unitMaps.maps)
        .passed,
    ).toBe(false);
    expect(
      strengthResult(evidence(120, 159), 200, 500_000_000, unitMaps.maps)
        .passed,
    ).toBe(false);
  });

  it("rejects omitted, duplicated, reordered and wrong-side results", () => {
    const original = evidence();
    const first = original.games[0];
    if (first === undefined) throw new Error("fixture missing first matchup");
    for (const games of [
      original.games.slice(1),
      [first, first, ...original.games.slice(2)],
      [...original.games].reverse(),
      [{ ...first, side: "blue" }, ...original.games.slice(1)],
    ])
      expect(() =>
        strengthResult({ ...original, games }, 200, 500_000_000, unitMaps.maps),
      ).toThrow();
  });

  it("diagnostics and optimized or retried evidence cannot pass", () => {
    expect(
      strengthResult(
        evidence(2, 2, "diagnostic"),
        2,
        500_000_000,
        unitMaps.maps,
      ).passed,
    ).toBe(false);
    for (const altered of [
      { optimized: true },
      { retried_duels: 1 },
      { acceptance: "accepted" },
    ])
      expect(() =>
        strengthResult(
          { ...evidence(), ...altered },
          200,
          500_000_000,
          unitMaps.maps,
        ),
      ).toThrow();
    expect(() =>
      strengthResult(evidence(), 200, 400_000_000, unitMaps.maps),
    ).toThrow();
  });

  it("pairs exactly one game per side for each seed and both opponents", () => {
    const schedule = evaluationSchedule(200, 500_000_000, unitMaps.maps);
    expect(schedule).toHaveLength(400);
    expect(schedule.slice(0, 2)).toEqual([
      {
        ...unitMaps.maps[0],
        opponent: "authored",
        seed: 500_000_000,
        side: "red",
      },
      {
        ...unitMaps.maps[0],
        opponent: "authored",
        seed: 500_000_000,
        side: "blue",
      },
    ]);
    expect(schedule[200]).toEqual({
      ...unitMaps.maps[0],
      opponent: "basic",
      seed: 500_000_000,
      side: "red",
    });
    for (const matches of [1, 3, 201, 202])
      expect(() => evaluationSchedule(matches, 0, unitMaps.maps)).toThrow();
  });

  it("balances the fixed 200 games across all 32 maps, grouping each map's paired opponents", () => {
    const maps: MapBinding[] = Array.from({ length: 32 }, (_, index) => ({
      map: `map-${index.toString().padStart(2, "0")}`,
      blocksSha256: "a".repeat(64),
      scenarioSha256: "b".repeat(64),
    }));
    const schedule = evaluationSchedule(200, 500_000_000, maps);
    expect(schedule).toHaveLength(400);
    expect([...new Set(schedule.map((game) => game.map))]).toEqual(
      maps.map((binding) => binding.map),
    );
    for (const binding of maps) {
      const authored = schedule.filter(
        (game) => game.map === binding.map && game.opponent === "authored",
      );
      const basic = schedule.filter(
        (game) => game.map === binding.map && game.opponent === "basic",
      );
      expect([6, 8]).toContain(authored.length);
      expect(authored.map(({ seed, side }) => ({ seed, side }))).toEqual(
        basic.map(({ seed, side }) => ({ seed, side })),
      );
      expect(authored.filter((game) => game.side === "red")).toHaveLength(
        authored.length / 2,
      );
    }
    const report = evidence(120, 160, "pilot", maps);
    expect(strengthResult(report, 200, 500_000_000, maps).passed).toBe(true);
    const first = report.games[0];
    if (first === undefined) throw new Error("fixture missing first matchup");
    for (const altered of [
      { version: 1 },
      { maps: maps.slice(1) },
      {
        games: [
          { ...first, blocksSha256: "c".repeat(64) },
          ...report.games.slice(1),
        ],
      },
      {
        games: [
          { ...first, scenarioSha256: "c".repeat(64) },
          ...report.games.slice(1),
        ],
      },
    ])
      expect(() =>
        strengthResult({ ...report, ...altered }, 200, 500_000_000, maps),
      ).toThrow();
    expect(() => strengthResult(evidence(), 200, 500_000_000, maps)).toThrow();
    expect(() => evaluationSchedule(2, 0, maps)).toThrow(
      /cover every admitted map/u,
    );
    expect(() => evaluationSchedule(200, 0, [])).toThrow();
  });
});
