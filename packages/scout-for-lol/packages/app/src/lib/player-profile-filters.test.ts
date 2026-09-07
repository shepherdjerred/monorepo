import { describe, expect, test } from "vitest";
import { PLAYER_PROFILE_QUEUE_PRESETS } from "@scout-for-lol/data";
import {
  filterKey,
  parsePlayerProfileFilters,
  playerProfileSearch,
} from "#src/lib/player-profile-filters.ts";

const competitive = [...PLAYER_PROFILE_QUEUE_PRESETS.competitive];

describe("player profile URL state", () => {
  test("uses omitted parameters for All time and Competitive", () => {
    const filters = parsePlayerProfileFilters(new URLSearchParams());
    expect(filters).toEqual({ games: "all", queues: competitive });
    expect(playerProfileSearch(filters)).toBe("");
  });

  test("round-trips All games as an explicit sentinel", () => {
    const filters = parsePlayerProfileFilters(new URLSearchParams("queue=all"));
    expect(filters).toEqual({ games: "all" });
    expect(playerProfileSearch(filters)).toBe("?queue=all");
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
    expect(filterKey(filters)).not.toBe(
      filterKey({ games: "all", queues: competitive }),
    );
  });

  test("drops invalid or duplicate queue selections at the URL boundary", () => {
    expect(
      parsePlayerProfileFilters(new URLSearchParams("queue=solo&queue=solo")),
    ).toEqual({ games: "all", queues: competitive });
    expect(
      parsePlayerProfileFilters(new URLSearchParams("queue=not-real")),
    ).toEqual({ games: "all", queues: competitive });
  });
});
