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
  ])("%i tracked players use rows of %p", (playerCount, expectedRowSizes) => {
    const players = Array.from({ length: playerCount }, (_, index) => index);
    const rows = splitSquad(players);

    expect(rows.map((row) => row.length)).toEqual(expectedRowSizes);
    expect(rows.flat()).toEqual(players);
  });
});
