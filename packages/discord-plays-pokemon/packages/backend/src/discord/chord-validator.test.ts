import { describe, expect, test } from "bun:test";
import { isValid, type ChordLimits } from "./chord-validator.ts";
import { parseChord } from "#src/game/command/chord.ts";

// Goal-bot-style limits where the three caps DIFFER, so the per-command-quantity
// check is provably bound to maxQuantityPerAction (not maxCommands).
const limits: ChordLimits = {
  maxCommands: 32,
  maxTotal: 200,
  maxQuantityPerAction: 60,
};

function chord(value: string) {
  const parsed = parseChord(value);
  if (parsed === undefined) {
    throw new Error(`test chord did not parse: ${value}`);
  }
  return parsed;
}

describe("isValid", () => {
  test("accepts a chord within every cap", () => {
    expect(isValid(chord("a a 5d a"), limits)).toBe(true);
  });

  test("rejects more commands than maxCommands", () => {
    expect(isValid(chord("a"), { ...limits, maxCommands: 1 })).toBe(true);
    expect(isValid(chord("a a"), { ...limits, maxCommands: 1 })).toBe(false);
  });

  test("rejects when the total quantity exceeds maxTotal", () => {
    expect(isValid(chord("50d 50d 50d 50d"), limits)).toBe(true); // 200 == cap
    expect(isValid(chord("50d 50d 50d 51d"), limits)).toBe(false); // 201 > cap
  });

  test("bounds a single command's quantity by maxQuantityPerAction, not maxCommands", () => {
    // 50 > maxCommands (32) but <= maxQuantityPerAction (60): the old code
    // compared against max_commands and would have WRONGLY rejected this.
    expect(isValid(chord("50d"), limits)).toBe(true);
    // 70 > maxQuantityPerAction (60): correctly rejected.
    expect(isValid(chord("70d"), limits)).toBe(false);
  });

  test("treats the caps as inclusive boundaries", () => {
    expect(isValid(chord("60d"), limits)).toBe(true); // == maxQuantityPerAction
    expect(isValid(chord("61d"), limits)).toBe(false);
  });

  test("chat-user limits (all 10) keep chords small", () => {
    const chat: ChordLimits = {
      maxCommands: 10,
      maxTotal: 10,
      maxQuantityPerAction: 10,
    };
    expect(isValid(chord("5d 5d"), chat)).toBe(true); // total 10
    expect(isValid(chord("11d"), chat)).toBe(false); // single qty 11 > 10
    expect(isValid(chord("40d"), limits)).toBe(true); // same chord, goal limits
  });
});
