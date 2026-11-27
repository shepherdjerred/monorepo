import { describe, expect, test } from "vitest";
import { wholePercent } from "#src/lib/format/percent.ts";
import { rankedFilters } from "#src/lib/player/feed-filters.ts";
import {
  parsePlayerPageFilters,
  playerPageSearchParams,
} from "#src/lib/player/page-filters.ts";

describe("the Player page's filters in its URL", () => {
  test("a visit with no queue starts on every game", () => {
    expect(parsePlayerPageFilters(new URLSearchParams(""))).toEqual({
      games: "all",
    });
    expect(parsePlayerPageFilters(new URLSearchParams("games=50"))).toEqual({
      games: 50,
    });
  });

  test("queues in the URL are the filter, and queue=all is every game", () => {
    expect(
      parsePlayerPageFilters(new URLSearchParams("queue=solo&queue=flex")),
    ).toEqual({ games: "all", queues: ["solo", "flex"] });
    expect(parsePlayerPageFilters(new URLSearchParams("queue=all"))).toEqual({
      games: "all",
    });
  });

  test("every game writes nothing, and Ranked writes its queues out", () => {
    expect(playerPageSearchParams({ games: "all" }).toString()).toBe("");
    expect(playerPageSearchParams({ games: 20 }).toString()).toBe("games=20");
    const ranked = playerPageSearchParams(rankedFilters({ games: "all" }));
    expect(ranked.getAll("queue")).toEqual([
      "solo",
      "flex",
      "ranked 5s",
      "clash",
    ]);
  });

  test("what is written reads back as the same filters", () => {
    const ranked = rankedFilters({ games: 20 });
    expect(parsePlayerPageFilters(playerPageSearchParams(ranked))).toEqual(
      ranked,
    );
    const flexOnly = { games: 50 as const, queues: ["flex" as const] };
    expect(parsePlayerPageFilters(playerPageSearchParams(flexOnly))).toEqual(
      flexOnly,
    );
  });
});

describe("wholePercent", () => {
  test("rounds a rate to a whole number", () => {
    expect(wholePercent(59.3)).toBe("59%");
    expect(wholePercent(75)).toBe("75%");
    expect(wholePercent(66.67)).toBe("67%");
    expect(wholePercent(0)).toBe("0%");
  });
});
