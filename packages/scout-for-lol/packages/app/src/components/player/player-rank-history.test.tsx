import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RankSchema, type PlayerRankHistory } from "@scout-for-lol/data";
import {
  PlayerRankHistoryCard,
  dailyClosePoints,
  emptyRangeMessage,
  graphXAxisMax,
  groupPointsByGranularity,
  periodRange,
  pointsInRange,
  preparePeriodSeries,
  queueHasCurrentPoints,
  rankHistoryLineSeries,
} from "#src/components/player/player-rank-history.tsx";

const EMERALD = RankSchema.parse({
  tier: "emerald",
  division: 2,
  lp: 40,
  wins: 20,
  losses: 16,
});
const PLATINUM = RankSchema.parse({
  tier: "platinum",
  division: 1,
  lp: 80,
  wins: 40,
  losses: 30,
});

const EMPTY_QUEUE = { series: [], previous: [] };

function history(
  overrides: Partial<PlayerRankHistory["queues"]>,
): PlayerRankHistory {
  return {
    currentSplit: {
      id: "2026_SEASON_3",
      displayName: "2026 Season 3",
      start: new Date("2026-07-29T12:00:00-07:00"),
      end: new Date("2026-09-22T23:59:59-07:00"),
    },
    queues: {
      solo: EMPTY_QUEUE,
      flex: EMPTY_QUEUE,
      "ranked 5s": EMPTY_QUEUE,
      ...overrides,
    },
  };
}

describe("player rank history", () => {
  test("treats a queue as empty until a current-split point exists", () => {
    expect(queueHasCurrentPoints(EMPTY_QUEUE)).toBe(false);
    expect(
      queueHasCurrentPoints({
        series: [
          {
            accountLabel: "Main#NA1",
            points: [
              {
                at: new Date("2026-08-10T12:00:00Z"),
                leaguePoints: 2100,
                rank: EMERALD,
              },
            ],
          },
        ],
        previous: [],
      }),
    ).toBe(true);
  });

  test("explains an empty current split and lists previous seasons", () => {
    const html = renderToStaticMarkup(
      <PlayerRankHistoryCard
        history={history({
          solo: {
            series: [],
            previous: [
              {
                splitId: "2026_SEASON_2",
                displayName: "2026 Season 2",
                peak: PLATINUM,
                last: EMERALD,
              },
            ],
          },
        })}
      />,
    );
    expect(html).toContain("Ranked history");
    expect(html).toContain("Solo / duo");
    expect(html).toContain("Flex");
    expect(html).toContain("Ranked 5s");
    expect(html).toContain("2026 Season 3");
    expect(html).toContain("no ranked snapshots");
    expect(html).toContain("Previous seasons");
    expect(html).toContain("2026 Season 2");
    expect(html).toContain("live ranked game");
  });

  test("renders a current-split chart region for a populated queue", () => {
    const html = renderToStaticMarkup(
      <PlayerRankHistoryCard
        history={history({
          solo: {
            series: [
              {
                accountLabel: "Main#NA1",
                points: [
                  {
                    at: new Date("2026-08-10T12:00:00Z"),
                    leaguePoints: 2100,
                    rank: EMERALD,
                  },
                ],
              },
            ],
            previous: [],
          },
        })}
      />,
    );
    expect(html).toContain("Solo / duo · 2026 Season 3");
    expect(html).not.toContain("Previous seasons");
  });

  test("clamps the x-axis to today while the split is still running", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    expect(graphXAxisMax(new Date("2026-10-15T00:00:00Z"), now)).toBe(
      now.getTime(),
    );
    expect(graphXAxisMax(new Date("2026-09-22T23:59:59Z"), now)).toBe(
      new Date("2026-09-22T23:59:59Z").getTime(),
    );
  });

  test("renders snapshots as a step line that holds between games", () => {
    const series = rankHistoryLineSeries({
      accountLabel: "Main#NA1",
      points: [
        {
          at: new Date(2026, 7, 10, 12),
          leaguePoints: 2100,
          rank: EMERALD,
        },
        {
          at: new Date(2026, 7, 11, 12),
          leaguePoints: 2150,
          rank: EMERALD,
        },
      ],
    });
    expect(series.name).toBe("Main#NA1");
    expect(series.type).toBe("line");
    expect(series.step).toBe("end");
    expect(series.showSymbol).toBe(true);
    expect(series.data).toHaveLength(2);
    expect(series.data[0]?.value).toEqual([
      new Date(2026, 7, 10, 12).getTime(),
      2100,
    ]);
  });

  test("collapses each day to its last snapshot in day order", () => {
    const points = dailyClosePoints([
      { at: new Date(2026, 7, 21, 10), leaguePoints: 2100, rank: EMERALD },
      { at: new Date(2026, 7, 21, 22), leaguePoints: 2050, rank: EMERALD },
      { at: new Date(2026, 7, 22, 9), leaguePoints: 2120, rank: EMERALD },
    ]);
    expect(points).toHaveLength(2);
    expect(points[0]?.leaguePoints).toBe(2050);
    expect(points[0]?.at).toEqual(new Date(2026, 7, 21, 22));
    expect(points[1]?.leaguePoints).toBe(2120);
  });

  test("series data maps every prepared point as given", () => {
    const series = rankHistoryLineSeries({
      accountLabel: "Main#NA1",
      points: [
        { at: new Date(2026, 7, 21, 10), leaguePoints: 2100, rank: EMERALD },
        { at: new Date(2026, 7, 21, 22), leaguePoints: 2050, rank: EMERALD },
      ],
    });
    expect(series.data).toHaveLength(2);
  });

  test("hides symbols on dense series", () => {
    const points = Array.from({ length: 41 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 7, 1 + index)),
      leaguePoints: 2000 + index,
      rank: EMERALD,
    }));
    expect(
      rankHistoryLineSeries({ accountLabel: "Main#NA1", points }).showSymbol,
    ).toBe(false);
  });
});

describe("rank history periods", () => {
  test("groups per game or per day by granularity", () => {
    const points = [
      { at: new Date(2026, 7, 21, 10), leaguePoints: 2100, rank: EMERALD },
      { at: new Date(2026, 7, 21, 22), leaguePoints: 2050, rank: EMERALD },
    ];
    expect(groupPointsByGranularity(points, "game")).toEqual(points);
    const daily = groupPointsByGranularity(points, "day");
    expect(daily).toHaveLength(1);
    expect(daily[0]?.leaguePoints).toBe(2050);
  });

  test("keeps range boundaries inclusive", () => {
    const start = new Date(2026, 8, 19, 12);
    const end = new Date(2026, 8, 26, 12);
    const points = pointsInRange(
      [
        { at: new Date(2026, 8, 19, 12), leaguePoints: 2100, rank: EMERALD },
        { at: new Date(2026, 8, 26, 12), leaguePoints: 2120, rank: EMERALD },
        {
          at: new Date(2026, 8, 19, 11, 59),
          leaguePoints: 2000,
          rank: EMERALD,
        },
      ],
      start,
      end,
    );
    expect(points.map((point) => point.leaguePoints)).toEqual([2100, 2120]);
  });

  test("derives the trailing window or the whole split", () => {
    const now = new Date(2026, 8, 26, 12);
    const splitStart = new Date(2026, 6, 29, 12);
    const futureEnd = new Date(2026, 9, 15, 12);
    expect(periodRange("7d", splitStart, futureEnd, now)).toEqual({
      start: new Date(2026, 8, 19, 12),
      end: now,
    });
    expect(periodRange("season", splitStart, futureEnd, now)).toEqual({
      start: splitStart,
      end: now,
    });
    expect(
      periodRange("30d", new Date(2026, 8, 16, 12), futureEnd, now).start,
    ).toEqual(new Date(2026, 8, 16, 12));
    expect(
      periodRange("season", splitStart, new Date(2026, 8, 22, 12), now).end,
    ).toEqual(new Date(2026, 8, 22, 12));
  });

  test("filters to the window before grouping", () => {
    const now = new Date(2026, 8, 26, 12);
    const series = [
      {
        accountLabel: "Main#NA1",
        points: [
          { at: new Date(2026, 8, 10, 12), leaguePoints: 2000, rank: EMERALD },
          { at: new Date(2026, 8, 20, 10), leaguePoints: 2100, rank: EMERALD },
          { at: new Date(2026, 8, 20, 22), leaguePoints: 2050, rank: EMERALD },
          { at: new Date(2026, 8, 25, 12), leaguePoints: 2120, rank: EMERALD },
        ],
      },
    ];
    const splitStart = new Date(2026, 6, 29, 12);
    const splitEnd = new Date(2026, 9, 15, 12);
    const week = preparePeriodSeries(
      series,
      "7d",
      periodRange("7d", splitStart, splitEnd, now),
    );
    expect(week[0]?.points.map((point) => point.leaguePoints)).toEqual([
      2100, 2050, 2120,
    ]);
    const month = preparePeriodSeries(
      series,
      "30d",
      periodRange("30d", splitStart, splitEnd, now),
    );
    expect(month[0]?.points.map((point) => point.leaguePoints)).toEqual([
      2000, 2050, 2120,
    ]);
  });

  test("explains an empty trailing window", () => {
    expect(emptyRangeMessage("7d")).toContain("last 7 days");
    expect(emptyRangeMessage("season")).not.toContain("last");
  });

  test("renders the period selector once with season selected", () => {
    const html = renderToStaticMarkup(
      <PlayerRankHistoryCard history={history({})} />,
    );
    expect(html).toContain("History period");
    expect(html).toContain("7D");
    expect(html).toContain("30D");
    expect(html).toContain("Season");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});
