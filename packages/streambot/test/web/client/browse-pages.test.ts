import type { BrowsePage } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { describe, expect, test } from "vitest";
import {
  applyChanges,
  readOffset,
} from "@shepherdjerred/streambot/web/client/library/query-params.ts";
import { pageRange } from "@shepherdjerred/streambot/web/client/library/paging.ts";
import { withCurrent } from "@shepherdjerred/streambot/web/client/library/filter-options.ts";
import {
  groupSeasons,
  libraryUrl,
  readLibraryFilters,
  seasonTitle,
} from "@shepherdjerred/streambot/web/client/library/library-query.ts";
import {
  historyItem,
  type HistoryEntry,
} from "@shepherdjerred/streambot/web/client/history/history-items.ts";
import {
  historyUrl,
  readHistoryFilters,
} from "@shepherdjerred/streambot/web/client/history/history-query.ts";
import {
  canWatch,
  gameItem,
  groupGames,
  readLiveFilters,
  sportsUrl,
  type Game,
} from "@shepherdjerred/streambot/web/client/live/games.ts";
import { albumPlayItem } from "@shepherdjerred/streambot/web/client/music/browse-items.ts";

describe("address filters", () => {
  test("a filter change returns to the first page", () => {
    const next = applyChanges(new URLSearchParams("q=a&offset=100"), {
      library: "Movies",
    });
    expect(next.toString()).toBe("q=a&library=Movies");
  });

  test("a change that names the offset keeps it, and an empty value clears a filter", () => {
    const next = applyChanges(new URLSearchParams("q=a&library=Movies"), {
      offset: "50",
      library: "",
    });
    expect(next.toString()).toBe("q=a&offset=50");
  });

  test("reads only plain offsets", () => {
    expect(readOffset(new URLSearchParams("offset=150"))).toBe(150);
    expect(readOffset(new URLSearchParams("offset=-1"))).toBe(0);
    expect(readOffset(new URLSearchParams("offset=abc"))).toBe(0);
    expect(readOffset(new URLSearchParams(""))).toBe(0);
  });

  test("a filter's current value stays selectable", () => {
    const options = [{ value: "", label: "All" }];
    expect(withCurrent(options, "Shows")).toEqual([
      { value: "", label: "All" },
      { value: "Shows", label: "Shows" },
    ]);
    expect(withCurrent(options, "")).toBe(options);
  });
});

describe("paging", () => {
  test("the first page has no previous", () => {
    expect(pageRange(0, 120, 50)).toEqual({
      first: 1,
      last: 50,
      previous: null,
      next: 50,
    });
  });

  test("a middle and a last page", () => {
    expect(pageRange(50, 120, 50)).toMatchObject({ previous: 0, next: 100 });
    expect(pageRange(100, 120, 50)).toEqual({
      first: 101,
      last: 120,
      previous: 50,
      next: null,
    });
  });

  test("an exact multiple does not invent an empty page", () => {
    expect(pageRange(50, 100, 50)).toMatchObject({ last: 100, next: null });
  });

  test("an offset past the end leads back to the last page", () => {
    expect(pageRange(500, 120, 50)).toMatchObject({
      first: 101,
      previous: 100,
      next: null,
    });
  });

  test("nothing to page", () => {
    expect(pageRange(0, 0)).toEqual({
      first: 0,
      last: 0,
      previous: null,
      next: null,
    });
  });
});

describe("library query", () => {
  test("titles with no series, episodes with one", () => {
    const base = { query: "", library: "", series: "", offset: 0 };
    expect(libraryUrl("1", base)).toBe("/api/library?guildId=1&view=titles");
    expect(
      libraryUrl("1", {
        query: "x",
        library: "TV",
        series: "Show",
        offset: 50,
      }),
    ).toBe(
      "/api/library?guildId=1&view=entries&query=x&library=TV&series=Show&offset=50",
    );
  });

  test("reads the address", () => {
    expect(
      readLibraryFilters(new URLSearchParams("q=a&series=S&offset=50")),
    ).toEqual({ query: "a", library: "", series: "S", offset: 50 });
  });

  test("groups episodes by season in order", () => {
    const groups = groupSeasons([
      { id: "a", season: 1 },
      { id: "b", season: 1 },
      { id: "c", season: 2 },
      { id: "d" },
    ]);
    expect(groups.map((group) => [group.season, group.items.length])).toEqual([
      [1, 2],
      [2, 1],
      [undefined, 1],
    ]);
    expect(seasonTitle(2)).toBe("Season 2");
    expect(seasonTitle(undefined)).toBe("Episodes");
  });
});

describe("history", () => {
  test("a replay carries its history selection", () => {
    const entry: HistoryEntry = {
      id: "h1",
      title: "A song",
      provider: "local",
      playedAt: 1_700_000_000_000,
      endedAt: null,
      outcome: null,
      replayAvailable: true,
      durationSeconds: 60,
      mediaKind: null,
      actions: ["watch"],
    };
    const item = historyItem(entry);
    expect(item.selection).toEqual({ kind: "history", id: "h1" });
    expect(item.actions).toEqual(["watch"]);
    const gone = historyItem({ ...entry, replayAvailable: false, actions: [] });
    expect(gone.selection).toBeNull();
    expect(gone.actions).toEqual([]);
  });

  test("query from and to the address", () => {
    const filters = readHistoryFilters(
      new URLSearchParams("visibility=server&provider=youtube&q=a&offset=50"),
    );
    expect(filters).toEqual({
      visibility: "server",
      provider: "youtube",
      query: "a",
      offset: 50,
    });
    expect(historyUrl("1", filters)).toBe(
      "/api/history?guildId=1&visibility=server&provider=youtube&query=a&offset=50",
    );
    expect(readHistoryFilters(new URLSearchParams("provider=nope"))).toEqual({
      visibility: "mine",
      provider: "",
      query: "",
      offset: 0,
    });
  });
});

const GAME: Game = {
  id: "g",
  title: "A v B",
  provider: "streameast",
  status: "live",
  startsAt: null,
};

describe("live games", () => {
  test("watch only where the game is playable", () => {
    expect(canWatch(GAME)).toBe(true);
    expect(canWatch({ ...GAME, status: "unknown" })).toBe(true);
    expect(canWatch({ ...GAME, status: "scheduled" })).toBe(false);
    expect(canWatch({ ...GAME, proOnly: true })).toBe(false);
    expect(gameItem(GAME).actions).toEqual(["watch"]);
    expect(gameItem({ ...GAME, proOnly: true }).actions).toEqual([]);
    expect(gameItem(GAME).selection).toEqual({ kind: "sports", id: "g" });
  });

  test("separates live from upcoming", () => {
    const groups = groupGames([
      GAME,
      { ...GAME, id: "s", status: "scheduled" },
      { ...GAME, id: "u", status: "unknown" },
    ]);
    expect(groups.live.map((game) => game.id)).toEqual(["g"]);
    expect(groups.upcoming.map((game) => game.id)).toEqual(["s"]);
    expect(groups.unconfirmed.map((game) => game.id)).toEqual(["u"]);
  });

  test("LoL Esports needs the capability and defaults to a week", () => {
    expect(
      readLiveFilters(new URLSearchParams("provider=lolesports"), false),
    ).toMatchObject({ provider: "streameast", range: "today" });
    expect(
      readLiveFilters(
        new URLSearchParams("provider=lolesports&league=lck"),
        true,
      ),
    ).toMatchObject({ provider: "lolesports", league: "lck", range: "week" });
    expect(
      readLiveFilters(new URLSearchParams("league=lck&range=week"), true),
    ).toMatchObject({ provider: "streameast", league: "", range: "week" });
  });

  test("sports URL carries the viewer's time zone", () => {
    expect(
      sportsUrl(
        "1",
        { query: "", provider: "auto", league: "", range: "today" },
        "America/Los_Angeles",
      ),
    ).toBe(
      "/api/sports?guildId=1&provider=auto&range=today&timeZone=America%2FLos_Angeles",
    );
  });
});

describe("album page", () => {
  const page: BrowsePage = {
    header: { kind: "album", id: "a", title: "Album" },
    rows: [],
  };

  test("play-all selects the album's music id", () => {
    const item = albumPlayItem({
      ...page,
      play: { id: "p1", actions: ["listen"], menuActions: ["watch"] },
    });
    expect(item?.selection).toEqual({ kind: "music", id: "p1" });
    expect(item?.actions).toEqual(["listen"]);
    expect(item?.menuActions).toEqual(["watch"]);
  });

  test("no play-all without an offer", () => {
    expect(albumPlayItem(page)).toBeNull();
    expect(
      albumPlayItem({ ...page, play: { id: "p1", actions: [] } }),
    ).toBeNull();
  });
});
