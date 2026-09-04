import { describe, expect, test } from "vitest";
import {
  filterKey,
  parsePlayerProfileFilters,
  playerProfileSearch,
} from "#src/lib/player-profile-filters.ts";

describe("player profile URL state", () => {
  test("uses omitted parameters for Last 20 and All games", () => {
    const filters = parsePlayerProfileFilters(new URLSearchParams());
    expect(filters).toEqual({ games: 20 });
    expect(playerProfileSearch(filters)).toBe("");
  });

  test("parses and canonicalizes repeated queue parameters", () => {
    const filters = parsePlayerProfileFilters(
      new URLSearchParams("queue=flex&games=50&queue=solo"),
    );
    expect(filters).toEqual({ games: 50, queues: ["flex", "solo"] });
    expect(playerProfileSearch(filters)).toBe(
      "?games=50&queue=solo&queue=flex",
    );
    expect(filterKey(filters)).toBe("50:flex,solo");
    expect(filterKey(filters)).not.toBe(filterKey({ games: 20 }));
  });

  test("drops invalid or duplicate queue selections at the URL boundary", () => {
    expect(
      parsePlayerProfileFilters(new URLSearchParams("queue=solo&queue=solo")),
    ).toEqual({ games: 20 });
    expect(
      parsePlayerProfileFilters(new URLSearchParams("queue=not-real")),
    ).toEqual({ games: 20 });
  });
});
