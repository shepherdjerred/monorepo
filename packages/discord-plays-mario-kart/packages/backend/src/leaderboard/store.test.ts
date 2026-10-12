// The real Prisma client and queries on a fresh SQLite file per test.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { DiscordUser } from "@discord-plays-mario-kart/common";
import { openTestDatabase } from "#src/database/test-database.ts";
import {
  createPlayerDirectory,
  type PlayerDirectory,
} from "#src/auth/player-directory.ts";
import {
  compareRecords,
  createPrismaLeaderboardStore,
  recordOf,
} from "./store.ts";
import type { LeaderboardStore } from "./store.ts";
import type { RaceCompleted, RaceResultEntry } from "./race-watcher.ts";

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";

function user(discordId: string, name: string): DiscordUser {
  return { discordId, username: name.toLowerCase(), name, avatarUrl: null };
}
const ALICE = user("2001", "Alice");
const BOB = user("2002", "Bob");

let prisma: PrismaClient;
let players: PlayerDirectory;
let store: LeaderboardStore;

beforeEach(async () => {
  prisma = await openTestDatabase();
  players = createPlayerDirectory(prisma);
  await players.upsert(ALICE);
  await players.upsert(BOB);
  store = createPrismaLeaderboardStore(prisma, players).forGuild(GUILD);
});

afterEach(async () => {
  await prisma.$disconnect();
});

function result(
  player: DiscordUser | null,
  over: Partial<RaceResultEntry> = {},
): RaceResultEntry {
  return {
    seat: 0,
    player:
      player === null
        ? null
        : { discordId: player.discordId, name: player.name },
    characterId: 0,
    placement: 1,
    raceTimeMs: 90_000,
    finished: true,
    ...over,
  };
}

function race(
  results: RaceResultEntry[],
  over: Partial<RaceCompleted> = {},
): RaceCompleted {
  return {
    courseId: 8,
    gameMode: "versus",
    screenMode: "quad",
    humanCount: results.length,
    results,
    ...over,
  };
}

describe("recordOf", () => {
  test("counts wins, podiums, losses, and the average place", () => {
    expect(recordOf(ALICE, [1, 3, 4, 1])).toEqual({
      player: ALICE,
      races: 4,
      wins: 2,
      podiums: 3,
      losses: 2,
      averagePlacement: 2.25,
      winRate: 0.5,
    });
  });

  test("orders by wins, then the better average place", () => {
    const steady = recordOf(ALICE, [1, 2, 2]);
    const streaky = recordOf(BOB, [1, 8, 8]);
    const champ = recordOf(user("2003", "Cy"), [1, 1]);
    expect([steady, streaky, champ].toSorted(compareRecords)).toEqual([
      champ,
      steady,
      streaky,
    ]);
  });
});

describe("leaderboard", () => {
  test("ranks Discord players by wins with podiums and average place", async () => {
    await store.recordRace(
      race([
        result(ALICE, { placement: 1 }),
        result(BOB, { seat: 1, placement: 2 }),
      ]),
    );
    await store.recordRace(
      race([
        result(ALICE, { placement: 3 }),
        result(BOB, { seat: 1, placement: 1 }),
      ]),
    );
    await store.recordRace(
      race([
        result(ALICE, { placement: 1 }),
        result(BOB, { seat: 1, placement: 5 }),
      ]),
    );

    expect(await store.leaderboard()).toEqual([
      {
        player: ALICE,
        races: 3,
        wins: 2,
        podiums: 3,
        losses: 1,
        averagePlacement: 5 / 3,
        winRate: 2 / 3,
      },
      {
        player: BOB,
        races: 3,
        wins: 1,
        podiums: 2,
        losses: 2,
        averagePlacement: 8 / 3,
        winRate: 1 / 3,
      },
    ]);
  });

  test("shows a player's current name, not the one they raced under", async () => {
    await store.recordRace(race([result(ALICE)]));
    await players.upsert({ ...ALICE, name: "Alicia" });
    const [entry] = await store.leaderboard();
    expect(entry?.player.name).toBe("Alicia");
  });

  test("leaves out unclaimed seats and pre-sign-in rows but keeps them stored", async () => {
    await store.recordRace(
      race([result(ALICE), result(null, { seat: 1, placement: 2 })]),
    );
    await prisma.raceResult.create({
      data: {
        race: {
          create: {
            guildId: GUILD,
            courseId: 1,
            gameMode: "gp",
            humanCount: 1,
          },
        },
        seat: 0,
        playerName: "typed",
        playerKey: "typed",
        character: 0,
        placement: 1,
        raceTimeMs: 1,
      },
    });
    const board = await store.leaderboard();
    expect(board.map((entry) => entry.player.discordId)).toEqual([
      ALICE.discordId,
    ]);
    expect(await prisma.raceResult.count()).toBe(3);
  });

  test("excludes time trials", async () => {
    await store.recordRace(race([result(ALICE)], { gameMode: "time-trials" }));
    await store.recordRace(
      race([result(ALICE, { placement: 2 })], { gameMode: "gp" }),
    );
    const [entry] = await store.leaderboard();
    expect(entry).toMatchObject({ races: 1, wins: 0 });
  });

  test("respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.recordRace(
        race([result(user(String(3000 + i), `P${String(i)}`))]),
      );
    }
    expect(await store.leaderboard(3)).toHaveLength(3);
  });

  test("keeps each guild's races out of every other guild's standings", async () => {
    const factory = createPrismaLeaderboardStore(prisma, players);
    await store.recordRace(race([result(ALICE)]));
    await factory
      .forGuild(OTHER_GUILD)
      .recordRace(
        race([result(BOB), result(ALICE, { seat: 1, placement: 2 })]),
      );

    const board = await store.leaderboard();
    expect(board.map((e) => [e.player.name, e.races])).toEqual([["Alice", 1]]);
    expect(await factory.latestGuildId()).toBe(OTHER_GUILD);
  });
});

describe("playerStats", () => {
  test("is null for a player with no ranked races", async () => {
    expect(await store.playerStats(ALICE.discordId)).toBeNull();
  });

  test("builds the histogram, best times, favourite character, and recent races", async () => {
    await store.recordRace(
      race(
        [
          result(ALICE, { placement: 2, raceTimeMs: 95_000, characterId: 3 }),
          result(BOB, { seat: 1, placement: 1, raceTimeMs: 94_000 }),
        ],
        { courseId: 8 },
      ),
    );
    await store.recordRace(
      race(
        [result(ALICE, { placement: 1, raceTimeMs: 91_000, characterId: 3 })],
        {
          courseId: 8,
        },
      ),
    );
    await store.recordRace(
      race(
        [
          result(ALICE, {
            placement: 4,
            raceTimeMs: 0,
            finished: false,
            characterId: 5,
          }),
        ],
        {
          courseId: 13,
        },
      ),
    );

    const stats = await store.playerStats(ALICE.discordId);
    expect(stats?.record).toMatchObject({ races: 3, wins: 1, podiums: 2 });
    expect(stats?.placements).toEqual([1, 1, 0, 1, 0, 0, 0, 0]);
    // Unfinished races set no best time.
    expect(stats?.bestTimes).toEqual([
      { courseId: 8, raceTimeMs: 91_000, characterId: 3 },
    ]);
    expect(stats?.favoriteCharacterId).toBe(3);
    expect(stats?.recent.map((r) => r.courseId)).toEqual([13, 8, 8]);
    // The other racers come along, best placement first.
    expect(stats?.recent[2]?.results.map((r) => r.player?.name)).toEqual([
      "Bob",
      "Alice",
    ]);
  });
});

describe("recentRaces", () => {
  test("lists the guild's latest ranked races, newest first", async () => {
    await store.recordRace(race([result(ALICE)], { courseId: 1 }));
    await store.recordRace(
      race([result(BOB)], { courseId: 2, gameMode: "time-trials" }),
    );
    await store.recordRace(
      race([result(BOB)], { courseId: 3, gameMode: "gp" }),
    );

    const races = await store.recentRaces();
    expect(races.map((r) => [r.courseId, r.gameMode])).toEqual([
      [3, "gp"],
      [1, "versus"],
    ]);
    expect(races[0]?.results[0]).toMatchObject({
      player: BOB,
      name: "Bob",
      placement: 1,
    });
  });
});
