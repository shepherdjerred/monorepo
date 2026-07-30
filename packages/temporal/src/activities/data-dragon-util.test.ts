import { describe, expect, test } from "bun:test";
import {
  dataDragonPrTitle,
  hasMatchingPrTitle,
  isFinalAttempt,
} from "./data-dragon-util.ts";

describe("isFinalAttempt", () => {
  test("returns false before the final attempt", () => {
    expect(isFinalAttempt(1, 2)).toBe(false);
  });

  test("returns true at the final attempt", () => {
    expect(isFinalAttempt(2, 2)).toBe(true);
  });

  test("returns true past the configured max (defensive)", () => {
    expect(isFinalAttempt(3, 2)).toBe(true);
  });

  test("returns true on the only attempt when maxAttempts is 1", () => {
    expect(isFinalAttempt(1, 1)).toBe(true);
  });
});

describe("hasMatchingPrTitle", () => {
  test("matches an exact title for the target version", () => {
    expect(
      hasMatchingPrTitle(
        [dataDragonPrTitle("16.15.1"), "chore: something unrelated"],
        "16.15.1",
      ),
    ).toBe(true);
  });

  test("does not match a PR for a different version", () => {
    expect(hasMatchingPrTitle([dataDragonPrTitle("16.15.0")], "16.15.1")).toBe(
      false,
    );
  });

  test("does not match on an empty PR list", () => {
    expect(hasMatchingPrTitle([], "16.15.1")).toBe(false);
  });
});
