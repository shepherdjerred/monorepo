import { describe, expect, test } from "vitest";
import { RosterSchema } from "#src/model/riot/roster.ts";
import { testChampion } from "#src/testing/champion-fixture.ts";

function roster(size: number) {
  return Array.from({ length: size }, (_, index) =>
    testChampion(`Player${index.toString()}`),
  );
}

describe("RosterSchema", () => {
  test.each([1, 2, 3, 4, 5])("accepts a side of %i", (size) => {
    expect(RosterSchema.parse(roster(size))).toHaveLength(size);
  });

  test("rejects an empty side", () => {
    // A side we cannot classify at all is a broken payload, not a 0v5 game.
    expect(RosterSchema.safeParse([]).success).toBe(false);
  });

  test("rejects a side of six", () => {
    expect(RosterSchema.safeParse(roster(6)).success).toBe(false);
  });
});
