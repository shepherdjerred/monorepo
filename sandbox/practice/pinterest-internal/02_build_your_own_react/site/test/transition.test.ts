import { describe, expect, it } from "vitest";
import { matchLines, phases, spring } from "#lib/lines.ts";
import type { CodeState } from "#lib/lines.ts";
import { transitionLines } from "#lib/transition.ts";
const state = (lines: number[]): CodeState => ({
  kind: "code",
  lines,
  focus: [],
  hovers: {},
});
describe("ordered code transitions", () => {
  it("matches duplicate lines by occurrence and order", () => {
    expect([
      ...matchLines(
        ["{", "same", "}", "same"],
        ["{", "same", "new", "}", "same"],
      ),
    ]).toEqual([
      [0, 0],
      [1, 1],
      [3, 2],
      [4, 3],
    ]);
    const matches = [...matchLines(["a", "b"], ["b", "a"])];
    expect(matches).toHaveLength(1);
  });
  it("exits, moves persistent lines, then enters", () => {
    const from = state([0, 1, 2]),
      to = state([0, 2, 3]);
    expect(phases(0.25)).toEqual({ exit: 1, move: 0, enter: 0 });
    expect(phases(0.75)).toEqual({ exit: 1, move: 1, enter: 0 });
    const early = transitionLines(from, to, 0.125);
    expect(early.find((line) => line.id === 1)?.opacity).toBe(0.5);
    expect(early.find((line) => line.id === 3)?.opacity).toBe(0);
    expect(
      transitionLines(from, to, 0.5).find((line) => line.id === 2)?.y,
    ).toBe(42);
    expect(
      transitionLines(from, to, 0.875).find((line) => line.id === 3)?.opacity,
    ).toBe(0.5);
    expect(
      transitionLines(from, to, 1)
        .filter((line) => line.opacity > 0)
        .map((line) => line.id),
    ).toEqual(to.lines);
  });
  it("retargets an interrupted spring from its current position and reverses to rest", () => {
    let value = { position: 0, velocity: 0 };
    for (let i = 0; i < 30; i++)
      value = spring(value.position, value.velocity, 1, 1 / 60);
    expect(value.position).toBeGreaterThan(0);
    expect(value.position).toBeLessThan(1);
    const interrupted = spring(value.position, value.velocity, 0, 1 / 60);
    expect(Math.abs(interrupted.position - value.position)).toBeLessThan(0.1);
    value = interrupted;
    for (let i = 0; i < 600; i++)
      value = spring(value.position, value.velocity, 0, 1 / 60);
    expect(value).toEqual({ position: 0, velocity: 0 });
  });
});
