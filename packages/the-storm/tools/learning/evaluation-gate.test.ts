import { describe, expect, it } from "vitest";
import { evaluationSchedule, strengthResult } from "./evaluation-gate.ts";

function evidence(authoredWins = 120, basicWins = 160, mode = "pilot") {
  const matches = mode === "pilot" ? 200 : 2;
  return {
    version: 1,
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
    games: evaluationSchedule(matches, 500_000_000).map((matchup, index) => ({
      ...matchup,
      match: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      result:
        index % matches <
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
    })),
  };
}

describe("frozen strength gates", () => {
  it("counts timeouts as non-wins and requires each full boundary", () => {
    const passed = strengthResult(evidence(), 200, 500_000_000);
    expect(passed.passed).toBe(true);
    expect(
      passed.opponents.map((opponent) => [opponent.wins, opponent.timeouts]),
    ).toEqual([
      [120, 80],
      [160, 40],
    ]);
    expect(passed.opponents[0]?.authoredFallbacks).toBe(1000);
    expect(strengthResult(evidence(119, 160), 200, 500_000_000).passed).toBe(
      false,
    );
    expect(strengthResult(evidence(120, 159), 200, 500_000_000).passed).toBe(
      false,
    );
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
        strengthResult({ ...original, games }, 200, 500_000_000),
      ).toThrow();
  });

  it("diagnostics and optimized or retried evidence cannot pass", () => {
    expect(
      strengthResult(evidence(2, 2, "diagnostic"), 2, 500_000_000).passed,
    ).toBe(false);
    for (const altered of [
      { optimized: true },
      { retried_duels: 1 },
      { acceptance: "accepted" },
    ])
      expect(() =>
        strengthResult({ ...evidence(), ...altered }, 200, 500_000_000),
      ).toThrow();
    expect(() => strengthResult(evidence(), 200, 400_000_000)).toThrow();
  });

  it("pairs exactly one game per side for each seed and both opponents", () => {
    const schedule = evaluationSchedule(200, 500_000_000);
    expect(schedule).toHaveLength(400);
    expect(schedule.slice(0, 2)).toEqual([
      { opponent: "authored", seed: 500_000_000, side: "red" },
      { opponent: "authored", seed: 500_000_000, side: "blue" },
    ]);
    expect(schedule[200]).toEqual({
      opponent: "basic",
      seed: 500_000_000,
      side: "red",
    });
    for (const matches of [1, 3, 201, 202])
      expect(() => evaluationSchedule(matches, 0)).toThrow();
  });
});
