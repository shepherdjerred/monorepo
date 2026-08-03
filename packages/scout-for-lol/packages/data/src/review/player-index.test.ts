import { describe, expect, test } from "bun:test";

import { requirePlayerAtIndex } from "#src/review/player-index.ts";

describe("requirePlayerAtIndex", () => {
  test("accepts the first and last valid indexes", () => {
    const players = ["first", "middle", "last"];

    expect(requirePlayerAtIndex(players, 0)).toBe("first");
    expect(requirePlayerAtIndex(players, 2)).toBe("last");
  });

  test.each([
    {
      label: "negative",
      playerIndex: -1,
      message: "Invalid playerIndex -1 for 3 players",
    },
    {
      label: "out-of-range",
      playerIndex: 3,
      message: "Invalid playerIndex 3 for 3 players",
    },
    {
      label: "fractional",
      playerIndex: 1.5,
      message: "Invalid playerIndex 1.5 for 3 players",
    },
  ])("rejects $label index", ({ playerIndex, message }) => {
    expect(() =>
      requirePlayerAtIndex(["first", "middle", "last"], playerIndex),
    ).toThrow(message);
  });
});
