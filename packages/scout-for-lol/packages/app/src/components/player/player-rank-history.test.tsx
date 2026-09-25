import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RankSchema, type PlayerRankHistory } from "@scout-for-lol/data";
import {
  PlayerRankHistoryCard,
  queueHasCurrentPoints,
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
});
