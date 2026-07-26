import { describe, expect, test } from "bun:test";
import { splitSquad } from "#src/html/shared/squad-layout.ts";

describe("splitSquad", () => {
  test.each([
    [1, [1]],
    [2, [2]],
    [3, [3]],
    [4, [4]],
    [5, [5]],
    [6, [3, 3]],
    [7, [4, 3]],
    [8, [4, 4]],
    [9, [5, 4]],
    [10, [5, 5]],
    // Cross-guild duplicate configs can push the count past ten distinct
    // participants; every row must still stay within the five-player cap.
    [11, [4, 4, 3]],
    [12, [4, 4, 4]],
    [13, [5, 5, 3]],
    [15, [5, 5, 5]],
    [16, [4, 4, 4, 4]],
    [20, [5, 5, 5, 5]],
  ])("%i tracked players use rows of %p", (playerCount, expectedRowSizes) => {
    const players = Array.from({ length: playerCount }, (_, index) => index);
    const rows = splitSquad(players);

    expect(rows.map((row) => row.length)).toEqual(expectedRowSizes);
    expect(rows.flat()).toEqual(players);
  });

  test.each([1, 5, 6, 10, 11, 17, 23, 40])(
    "never emits a row larger than five (%i players)",
    (playerCount) => {
      const players = Array.from({ length: playerCount }, (_, index) => index);
      const rows = splitSquad(players);

      for (const row of rows) {
        expect(row.length).toBeLessThanOrEqual(5);
      }
      expect(rows.flat()).toEqual(players);
    },
  );
});
