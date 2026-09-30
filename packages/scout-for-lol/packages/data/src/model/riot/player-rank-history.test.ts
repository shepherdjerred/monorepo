import { describe, expect, test } from "vitest";
import { RankSchema, type Rank } from "#src/model/riot/rank.ts";
import { buildPlayerRankHistory } from "#src/model/riot/player-rank-history.ts";

const MAIN = "main-puuid";
const SMURF = "smurf-puuid";

function rank(
  tier: Rank["tier"],
  division: Rank["division"],
  lp: number,
): Rank {
  return RankSchema.parse({
    tier,
    division,
    lp,
    wins: 10,
    losses: 8,
  });
}

const NOW = new Date("2026-09-20T12:00:00-07:00");
const ACCOUNTS = [
  { puuid: MAIN, label: "Main#NA1" },
  { puuid: SMURF, label: "Smurf#NA1" },
];

describe("buildPlayerRankHistory", () => {
  test("plots current-split rankAfter and summarizes previous splits", () => {
    const history = buildPlayerRankHistory({
      now: NOW,
      accounts: ACCOUNTS.slice(0, 1),
      observations: [
        {
          puuid: MAIN,
          queue: "solo",
          at: new Date("2026-05-01T12:00:00-07:00"),
          rank: rank("platinum", 4, 10),
          rankBefore: rank("platinum", 3, 80),
        },
        {
          puuid: MAIN,
          queue: "solo",
          at: new Date("2026-08-10T12:00:00-07:00"),
          rank: rank("emerald", 2, 40),
        },
        {
          puuid: MAIN,
          queue: "solo",
          at: new Date("2026-09-01T12:00:00-07:00"),
          rank: rank("emerald", 1, 12),
        },
      ],
    });

    expect(history.currentSplit).toMatchObject({
      id: "2026_SEASON_3",
      displayName: "2026 Season 3",
    });
    expect(history.queues.solo.series).toHaveLength(1);
    expect(
      history.queues.solo.series[0]?.points.map((point) => point.rank.lp),
    ).toEqual([40, 12]);
    expect(history.queues.solo.previous).toEqual([
      {
        splitId: "2026_SEASON_2",
        displayName: "2026 Season 2",
        peak: rank("platinum", 4, 10),
        last: rank("platinum", 4, 10),
      },
    ]);
    expect(history.queues.flex.series).toEqual([]);
    expect(history.queues["ranked 5s"].series).toEqual([]);
  });

  test("extends the current split window past the last bundled act end", () => {
    const history = buildPlayerRankHistory({
      now: new Date("2026-10-21T12:00:00-07:00"),
      accounts: ACCOUNTS.slice(0, 1),
      observations: [
        {
          puuid: MAIN,
          queue: "flex",
          at: new Date("2026-10-21T08:00:00-07:00"),
          rank: rank("gold", 2, 5),
        },
      ],
    });
    expect(history.currentSplit.id).toBe("2026_SEASON_3");
    expect(history.currentSplit.end.getTime()).toBe(
      new Date("2026-10-21T12:00:00-07:00").getTime(),
    );
    expect(history.queues.flex.series[0]?.points).toHaveLength(1);
  });

  test("splits current-split series per account when more than one has points", () => {
    const history = buildPlayerRankHistory({
      now: NOW,
      accounts: ACCOUNTS,
      observations: [
        {
          puuid: MAIN,
          queue: "solo",
          at: new Date("2026-08-10T12:00:00-07:00"),
          rank: rank("diamond", 4, 20),
        },
        {
          puuid: SMURF,
          queue: "solo",
          at: new Date("2026-08-11T12:00:00-07:00"),
          rank: rank("silver", 1, 50),
        },
      ],
    });
    expect(
      history.queues.solo.series.map((series) => series.accountLabel),
    ).toEqual(["Main#NA1", "Smurf#NA1"]);
  });

  test("keeps a single series when only one of several accounts has current-split points", () => {
    const history = buildPlayerRankHistory({
      now: NOW,
      accounts: ACCOUNTS,
      observations: [
        {
          puuid: MAIN,
          queue: "solo",
          at: new Date("2026-08-10T12:00:00-07:00"),
          rank: rank("gold", 1, 0),
        },
        {
          puuid: SMURF,
          queue: "solo",
          at: new Date("2026-05-01T12:00:00-07:00"),
          rank: rank("iron", 4, 20),
        },
      ],
    });
    expect(history.queues.solo.series).toHaveLength(1);
    expect(history.queues.solo.series[0]?.accountLabel).toBe("Main#NA1");
  });

  test("buckets timestamps before the first act as Earlier", () => {
    const history = buildPlayerRankHistory({
      now: NOW,
      accounts: ACCOUNTS.slice(0, 1),
      observations: [
        {
          puuid: MAIN,
          queue: "ranked 5s",
          at: new Date("2025-07-01T00:00:00-07:00"),
          rank: rank("bronze", 2, 30),
        },
      ],
    });
    expect(history.queues["ranked 5s"].previous).toEqual([
      {
        splitId: "earlier",
        displayName: "Earlier",
        peak: rank("bronze", 2, 30),
        last: rank("bronze", 2, 30),
      },
    ]);
  });

  test("does not treat the previous split's rankBefore as this split's peak", () => {
    const history = buildPlayerRankHistory({
      now: NOW,
      accounts: ACCOUNTS.slice(0, 1),
      observations: [
        {
          puuid: MAIN,
          queue: "solo",
          at: new Date("2026-05-01T12:00:00-07:00"),
          rank: rank("gold", 4, 0),
          rankBefore: rank("diamond", 2, 50),
        },
      ],
    });
    expect(history.queues.solo.previous).toEqual([
      {
        splitId: "2026_SEASON_2",
        displayName: "2026 Season 2",
        peak: rank("gold", 4, 0),
        last: rank("gold", 4, 0),
      },
    ]);
  });

  test("throws when an observation is not in the requested account list", () => {
    expect(() =>
      buildPlayerRankHistory({
        now: NOW,
        accounts: ACCOUNTS.slice(0, 1),
        observations: [
          {
            puuid: SMURF,
            queue: "solo",
            at: NOW,
            rank: rank("gold", 4, 0),
          },
        ],
      }),
    ).toThrow(/unrequested PUUID/);
  });
});
