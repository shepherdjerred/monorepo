import { describe, expect, test } from "vitest";
import { observationTurns } from "./monitor.ts";

type Row = { id: string; monitorObservations: { observedAt: Date }[] };

function row(id: string, observedAt?: number): Row {
  return {
    id,
    monitorObservations:
      observedAt === undefined ? [] : [{ observedAt: new Date(observedAt) }],
  };
}

describe("observationTurns (W1)", () => {
  test("puts never-observed deployments first, then the least recently observed", () => {
    // Rows arrive in acceptance order; ties keep it.
    const rows = [row("a", 10), row("b"), row("c", 5), row("d")];
    expect(observationTurns(rows).map((entry) => entry.id)).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
  });

  test("a capped tick rotates through every watching deployment", () => {
    const perTick = 20;
    let rows = Array.from({ length: 45 }, (_, index) => row(String(index)));
    const observedOn = new Map<string, number[]>();
    for (let tick = 1; tick <= 6; tick++) {
      const turn = observationTurns(rows).slice(0, perTick);
      for (const entry of turn)
        observedOn.set(entry.id, [...(observedOn.get(entry.id) ?? []), tick]);
      const taken = new Set(turn.map((entry) => entry.id));
      rows = rows.map((entry) =>
        taken.has(entry.id) ? row(entry.id, tick) : entry,
      );
    }
    // 45 deployments at 20 per tick: each is observed every third tick.
    expect(observedOn.size).toBe(45);
    for (const ticks of observedOn.values())
      expect(ticks.length).toBeGreaterThanOrEqual(2);
  });
});
