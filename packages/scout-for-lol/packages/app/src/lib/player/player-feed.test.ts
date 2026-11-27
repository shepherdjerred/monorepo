import { describe, expect, test } from "vitest";
import {
  feedRows,
  playerHistoryInput,
  queueLabel,
  splitClimb,
  type RankHistory,
} from "#src/lib/player/player-feed.ts";
import {
  historyEntry,
  matchId,
  NOW_MS,
  PLAYER_ID,
  rankPoint,
} from "#src/lib/player/player-fixtures.ts";

describe("playerHistoryInput", () => {
  test("asks for the newest games under the page's filters", () => {
    expect(
      playerHistoryInput(PLAYER_ID, { games: 50, queues: ["solo", "flex"] }),
    ).toEqual({
      playerId: PLAYER_ID,
      limit: 20,
      games: 50,
      queues: ["solo", "flex"],
    });
    expect(playerHistoryInput(PLAYER_ID, { games: "all" })).toEqual({
      playerId: PLAYER_ID,
      limit: 20,
      games: "all",
    });
  });
});

describe("queueLabel", () => {
  test("capitalises each word of the queue's name", () => {
    expect(queueLabel("solo")).toBe("Ranked Solo");
    expect(queueLabel("flex")).toBe("Ranked Flex");
    expect(queueLabel("ARAM")).toBe("ARAM");
    expect(queueLabel("SOME_NEW_MODE")).toBe("Some New Mode");
    expect(queueLabel(null)).toBeUndefined();
  });
});

describe("feedRows", () => {
  test("turns each game into the parts of one sentence", () => {
    const [row] = feedRows([historyEntry({ largestMultiKill: 4 })], NOW_MS);
    expect(row).toEqual({
      matchId: matchId(1),
      result: "win",
      championId: 103,
      kda: { kills: 9, deaths: 2, assists: 11 },
      lpChange: 21,
      when: "2 hours ago",
      detail: "Ranked Solo",
      highlight: "Quadra kill",
    });
  });

  test("leaves out LP when it is not known and a mark when there is none", () => {
    const [row] = feedRows(
      [historyEntry({ leaguePointsDelta: null, win: false })],
      NOW_MS,
    );
    expect(row?.result).toBe("loss");
    expect(row?.lpChange).toBeUndefined();
    expect(row?.highlight).toBeUndefined();
  });
});

function history(
  points: ReturnType<typeof rankPoint>[],
  accounts = 1,
): RankHistory {
  const series = Array.from({ length: accounts }, (_, index) => ({
    accountLabel: `Account ${index.toString()}`,
    points: index === 0 ? points : points.slice(0, 1),
  }));
  return {
    currentSplit: {
      id: "s1",
      displayName: "Split 1",
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-12-31T00:00:00.000Z",
    },
    queues: {
      solo: { series, previous: [] },
      flex: { series: [], previous: [] },
      "ranked 5s": { series: [], previous: [] },
    },
  };
}

describe("splitClimb", () => {
  test("reads a climb across a tier and marks where the new tier was reached", () => {
    const climb = splitClimb(
      history([
        rankPoint("platinum", 2, 30, "2026-09-02T00:00:00.000Z"),
        rankPoint("platinum", 1, 90, "2026-09-03T00:00:00.000Z"),
        rankPoint("emerald", 4, 10, "2026-09-04T00:00:00.000Z"),
        rankPoint("emerald", 2, 64, "2026-09-05T00:00:00.000Z"),
      ]),
    );
    expect(climb?.sentence).toBe(
      "Climbed from Platinum II to Emerald II in 3 ranked games.",
    );
    expect(climb?.points).toHaveLength(4);
    expect(climb?.points).toEqual(climb?.points.toSorted((a, b) => a - b));
    expect(climb?.reached).toEqual({ index: 2, label: "Reached Emerald" });
  });

  test("puts the points in time order whatever order they arrive in", () => {
    const climb = splitClimb(
      history([
        rankPoint("emerald", 2, 64, "2026-09-05T00:00:00.000Z"),
        rankPoint("platinum", 2, 30, "2026-09-02T00:00:00.000Z"),
      ]),
    );
    expect(climb?.start.tier).toBe("platinum");
    expect(climb?.now.tier).toBe("emerald");
  });

  test("calls a fall a drop and has no mark for it", () => {
    const climb = splitClimb(
      history([
        rankPoint("emerald", 2, 64, "2026-09-02T00:00:00.000Z"),
        rankPoint("platinum", 1, 12, "2026-09-03T00:00:00.000Z"),
      ]),
    );
    expect(climb?.sentence).toBe(
      "Dropped from Emerald II to Platinum I in 1 ranked game.",
    );
    expect(climb?.reached).toBeUndefined();
  });

  test("states LP when the division did not change", () => {
    const up = splitClimb(
      history([
        rankPoint("emerald", 2, 10, "2026-09-02T00:00:00.000Z"),
        rankPoint("emerald", 2, 64, "2026-09-03T00:00:00.000Z"),
      ]),
    );
    expect(up?.sentence).toBe("Up 54 LP in 1 ranked game.");
    const flat = splitClimb(
      history([
        rankPoint("emerald", 2, 64, "2026-09-02T00:00:00.000Z"),
        rankPoint("emerald", 2, 64, "2026-09-03T00:00:00.000Z"),
      ]),
    );
    expect(flat?.sentence).toBe("Holding Emerald II over 1 ranked game.");
  });

  test("uses the account with the most history", () => {
    const climb = splitClimb(
      history(
        [
          rankPoint("platinum", 2, 30, "2026-09-02T00:00:00.000Z"),
          rankPoint("platinum", 1, 90, "2026-09-03T00:00:00.000Z"),
        ],
        2,
      ),
    );
    expect(climb?.points).toHaveLength(2);
  });

  test("is absent until there are two points to draw a line between", () => {
    expect(splitClimb(history([]))).toBeNull();
    expect(
      splitClimb(
        history([rankPoint("emerald", 2, 64, "2026-09-02T00:00:00.000Z")]),
      ),
    ).toBeNull();
  });
});
