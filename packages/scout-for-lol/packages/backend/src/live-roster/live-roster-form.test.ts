import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import type { LeaguePuuid, RiotMatchId } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  LiveFormBudgetDeferred,
  type LiveFormRiotApi,
} from "#src/live-roster/live-roster-form-riot.ts";
import { recordLiveGameRoster } from "#src/live-roster/live-roster-record.ts";
import {
  recordLiveRosterRecentForm,
  summarizeRankedGames,
} from "#src/live-roster/live-roster-form.ts";
import { LiveRecentFormMapSchema } from "#src/live-roster/live-roster-schema.ts";
import {
  LIVE_MATCH_ID,
  liveContext,
  seatPuuid,
} from "#src/live-roster/live-roster.test-fixtures.ts";

const { prisma } = createTestDatabase("live-roster-form");

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = new Date("2026-11-26T20:05:00.000Z");
const DETECTED_AT = new Date("2026-11-26T20:00:00.000Z");

beforeEach(async () => {
  await prisma.liveGameRoster.deleteMany();
  await prisma.matchTrackedAccount.deleteMany();
  await recordLiveGameRoster(liveContext([2]), DETECTED_AT, prisma);
});

type Game = { champion: number; win: boolean };

/** Newest first, as Riot lists them. */
const FORM: Record<number, Game[]> = {
  // Their Syndra: two wins on her in five, then a loss on another champion.
  7: [
    { champion: 134, win: true },
    { champion: 134, win: true },
    { champion: 7, win: false },
    { champion: 134, win: false },
    { champion: 1, win: true },
  ],
  // Their jungler: five in a row.
  6: Array.from({ length: 5 }, () => ({ champion: 234, win: true })),
};

const SOLO_ENTRY = [
  {
    queueType: "RANKED_SOLO_5x5",
    tier: "EMERALD",
    rank: "II",
    leaguePoints: 61,
    wins: 120,
    losses: 100,
  },
];

type Recorded = { name: string; seat: number };

function seatOf(puuid: LeaguePuuid): number {
  return (
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((seat) => seatPuuid(seat) === puuid) ??
    -1
  );
}

/**
 * A scripted Riot: it lists and serves the games in `FORM`, and records every
 * call so a test can say exactly what was asked, and at what size.
 */
function scriptedRiot(
  options: {
    fail?: (call: Recorded) => Error | undefined;
  } = {},
) {
  const calls: Recorded[] = [];
  const gamesOf = new Map<string, { seat: number; game: Game }>();
  const record = (name: string, seat: number) => {
    const call = { name, seat };
    calls.push(call);
    const failure = options.fail?.(call);
    if (failure !== undefined) throw failure;
  };
  const riot: LiveFormRiotApi = {
    rankedMatchIds: (puuid, _route, count) => {
      const seat = seatOf(puuid);
      record(`ids:${count.toString()}`, seat);
      const games = FORM[seat] ?? [];
      return Promise.resolve(
        games.slice(0, count).map((game, index) => {
          const id = RiotMatchIdSchema.parse(
            `NA1_${(9000 + seat * 10 + index).toString()}`,
          );
          gamesOf.set(id, { seat, game });
          return id;
        }),
      );
    },
    match: (matchId: RiotMatchId) => {
      const entry = gamesOf.get(matchId);
      if (entry === undefined) throw new Error(`unscripted ${matchId}`);
      record("match", entry.seat);
      return Promise.resolve({
        metadata: { matchId },
        info: {
          gameDuration: 1800,
          participants: [
            {
              puuid: seatPuuid(entry.seat),
              championId: entry.game.champion,
              win: entry.game.win,
              kills: 99,
            },
          ],
        },
      });
    },
    leagueEntries: (puuid) => {
      record("league", seatOf(puuid));
      return Promise.resolve(SOLO_ENTRY);
    },
  };
  return { riot, calls };
}

const deps = (riot: LiveFormRiotApi) => ({
  database: prisma,
  riot,
  now: () => NOW,
});

async function storedForms() {
  const row = await prisma.liveGameRoster.findUniqueOrThrow({
    where: { riotMatchId: LIVE_MATCH_ID },
  });
  return { row, forms: LiveRecentFormMapSchema.parse(row.recentForm) };
}

describe("summarizeRankedGames", () => {
  test("counts wins, the newest streak and games on the current champion", () => {
    expect(
      summarizeRankedGames(
        [
          { championId: 134, win: false },
          { championId: 134, win: false },
          { championId: 9, win: true },
        ],
        134,
        null,
        NOW,
      ),
    ).toMatchObject({
      games: 3,
      wins: 1,
      streak: { result: "loss", length: 2 },
      gamesOnChampion: 2,
      winsOnChampion: 0,
    });
  });

  test("a player with no ranked games has no streak", () => {
    expect(summarizeRankedGames([], 134, null, NOW)).toMatchObject({
      games: 0,
      wins: 0,
      streak: null,
      gamesOnChampion: 0,
    });
  });
});

describe("recordLiveRosterRecentForm", () => {
  test("reads the last five ranked games of the nine strangers and stores a short summary", async () => {
    const { riot, calls } = scriptedRiot();

    const result = await recordLiveRosterRecentForm(LIVE_MATCH_ID, deps(riot));

    expect(result).toEqual({ status: "completed", fetched: 9, unavailable: 0 });
    // Nine strangers: the tracked seat is never read, and each is asked for
    // five games and a rank.
    expect(calls.some((call) => call.seat === 2)).toBe(false);
    expect(
      calls.filter((call) => call.name === "ids:5").map((call) => call.seat),
    ).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9]);
    expect(calls.filter((call) => call.name === "league")).toHaveLength(9);

    const { row, forms } = await storedForms();
    expect(row.recentFormCompletedAt).toEqual(NOW);
    expect(forms[seatPuuid(7)]).toEqual({
      status: "fetched",
      games: 5,
      wins: 3,
      streak: { result: "win", length: 2 },
      gamesOnChampion: 3,
      winsOnChampion: 2,
      rank: { tier: "emerald", division: 2, lp: 61, wins: 120, losses: 100 },
      fetchedAt: NOW.toISOString(),
    });
    expect(forms[seatPuuid(6)]).toMatchObject({
      status: "fetched",
      wins: 5,
      streak: { result: "win", length: 5 },
    });
    expect(forms[seatPuuid(0)]).toMatchObject({ games: 0, streak: null });
    expect(forms[seatPuuid(2)]).toBeUndefined();
  });

  test("keeps only the summary: nothing of any match is stored", async () => {
    const { riot } = scriptedRiot();
    await recordLiveRosterRecentForm(LIVE_MATCH_ID, deps(riot));

    const { row } = await storedForms();
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("gameDuration");
    expect(stored).not.toContain("kills");
    expect(stored).not.toContain("NA1_90");
  });

  test("a finished pass makes no further calls", async () => {
    const first = scriptedRiot();
    await recordLiveRosterRecentForm(LIVE_MATCH_ID, deps(first.riot));
    const second = scriptedRiot();

    expect(
      await recordLiveRosterRecentForm(LIVE_MATCH_ID, deps(second.riot)),
    ).toEqual({ status: "already-complete", fetched: 0, unavailable: 0 });
    expect(second.calls).toEqual([]);
  });

  test("a 429 stops the pass, keeps what was done and resumes with the rest", async () => {
    const limited = scriptedRiot({
      fail: (call) =>
        call.seat === 5 && call.name === "ids:5"
          ? new RiotHttpError({
              status: 429,
              statusText: "Too Many Requests",
              body: {},
              url: "https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/x/ids",
              headers: new Headers({ "retry-after": "3" }),
            })
          : undefined,
    });

    const failure = await recordLiveRosterRecentForm(
      LIVE_MATCH_ID,
      deps(limited.riot),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApplicationFailure);
    if (!(failure instanceof ApplicationFailure)) return;
    expect(failure.type).toBe("LiveRosterRateLimited");
    expect(failure.nonRetryable).toBe(false);
    // Seats 0, 1, 3 and 4 finished before the limit; nothing after it was asked.
    const afterLimit = await storedForms();
    expect(Object.keys(afterLimit.forms)).toHaveLength(4);
    expect(limited.calls.some((call) => call.seat > 5)).toBe(false);

    const resumed = scriptedRiot();
    expect(
      await recordLiveRosterRecentForm(LIVE_MATCH_ID, deps(resumed.riot)),
    ).toEqual({ status: "completed", fetched: 5, unavailable: 0 });
    expect(
      resumed.calls.filter((call) => call.name === "ids:5").map((c) => c.seat),
    ).toEqual([5, 6, 7, 8, 9]);
  });

  test("a refused budget is a deferral, not a failure of the pass", async () => {
    const refused = scriptedRiot({
      fail: (call) =>
        call.seat === 1 && call.name === "ids:5"
          ? new LiveFormBudgetDeferred()
          : undefined,
    });

    const failure = await recordLiveRosterRecentForm(
      LIVE_MATCH_ID,
      deps(refused.riot),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApplicationFailure);
    if (!(failure instanceof ApplicationFailure)) return;
    expect(failure.type).toBe("LiveRosterBudgetDeferred");
    expect(failure.nonRetryable).toBe(false);
    const afterRefusal = await storedForms();
    expect(Object.keys(afterRefusal.forms)).toHaveLength(1);
    expect(afterRefusal.row.recentFormCompletedAt).toBeNull();
  });

  test("a player Riot will not serve is recorded unavailable and never asked again", async () => {
    const hidden = scriptedRiot({
      fail: (call) =>
        call.seat === 3 && call.name === "ids:5"
          ? new RiotHttpError({
              status: 404,
              statusText: "Not Found",
              body: {},
              url: "https://americas.api.riotgames.com/x",
              headers: new Headers(),
            })
          : undefined,
    });

    expect(
      await recordLiveRosterRecentForm(LIVE_MATCH_ID, deps(hidden.riot)),
    ).toEqual({ status: "completed", fetched: 8, unavailable: 1 });
    const { forms } = await storedForms();
    expect(forms[seatPuuid(3)]).toEqual({
      status: "unavailable",
      recordedAt: NOW.toISOString(),
    });
  });

  test("stops before spending any budget once the game has ended", async () => {
    await prisma.matchTrackedAccount.create({
      data: { riotMatchId: LIVE_MATCH_ID, puuid: seatPuuid(2) },
    });
    const { riot, calls } = scriptedRiot();

    expect(await recordLiveRosterRecentForm(LIVE_MATCH_ID, deps(riot))).toEqual(
      { status: "game-ended", fetched: 0, unavailable: 0 },
    );
    expect(calls).toEqual([]);
  });

  test("no roster means nothing to read", async () => {
    await prisma.liveGameRoster.deleteMany();
    const { riot, calls } = scriptedRiot();

    expect(await recordLiveRosterRecentForm(LIVE_MATCH_ID, deps(riot))).toEqual(
      { status: "no-roster", fetched: 0, unavailable: 0 },
    );
    expect(calls).toEqual([]);
  });
});
