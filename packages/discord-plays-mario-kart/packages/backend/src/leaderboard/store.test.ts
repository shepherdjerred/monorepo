// In-memory libSQL exercises the real Prisma client + queries (groupBy,
// aggregation, ordering). Requires `prisma generate` to have run (CI does this
// before backend tests; locally run `bun run generate`).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createPrismaLeaderboardStore, playerKeyOf } from "./store.ts";
import type { LeaderboardStore } from "./store.ts";
import type { RaceCompleted, RaceResultEntry } from "./race-watcher.ts";

const SCHEMA = `
DROP TABLE IF EXISTS "RaceResult";
DROP TABLE IF EXISTS "Race";
CREATE TABLE "Race" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "guildId" TEXT NOT NULL,
  "finishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "courseId" INTEGER NOT NULL,
  "gameMode" TEXT NOT NULL,
  "humanCount" INTEGER NOT NULL
);
CREATE TABLE "RaceResult" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "raceId" INTEGER NOT NULL REFERENCES "Race"("id") ON DELETE CASCADE,
  "seat" INTEGER NOT NULL,
  "playerName" TEXT,
  "playerKey" TEXT,
  "discordId" TEXT,
  "character" INTEGER NOT NULL,
  "placement" INTEGER NOT NULL,
  "raceTimeMs" INTEGER NOT NULL,
  "finished" BOOLEAN NOT NULL DEFAULT true
);
`;

let prisma: PrismaClient;
let store: LeaderboardStore;
let dbCounter = 0;

beforeEach(async () => {
  // A unique file DB per test: libSQL `:memory:` gives each connection its own
  // database, and the adapter pools connections, so the schema and the queries
  // would land in different DBs. Unique names avoid cross-test collisions; the
  // OS reaps the temp files.
  dbCounter += 1;
  const dbPath = `${tmpdir()}/dpmk-leaderboard-test-${String(dbCounter)}-${String(process.pid)}.db`;
  const adapter = new PrismaLibSql({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter });
  for (const stmt of SCHEMA.split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await prisma.$executeRawUnsafe(stmt);
  }
  store = createPrismaLeaderboardStore(prisma).forGuild("100000000000000001");
});

afterEach(async () => {
  await prisma.$disconnect();
});

function result(over: Partial<RaceResultEntry>): RaceResultEntry {
  return {
    seat: 0,
    name: "Player",
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

describe("playerKeyOf", () => {
  test("lowercases and trims; null/blank -> null", () => {
    expect(playerKeyOf("Speedy")).toBe("speedy");
    expect(playerKeyOf("  Mixed Case  ")).toBe("mixed case");
    expect(playerKeyOf(null)).toBeNull();
    expect(playerKeyOf("   ")).toBeNull();
  });
});

describe("LeaderboardStore", () => {
  test("aggregates wins, races, and win rate, ordered by wins desc", async () => {
    await store.recordRace(
      race([
        result({ seat: 0, name: "Alice", placement: 1 }),
        result({ seat: 1, name: "Bob", placement: 2 }),
      ]),
    );
    await store.recordRace(
      race([
        result({ seat: 0, name: "Alice", placement: 2 }),
        result({ seat: 1, name: "Bob", placement: 1 }),
      ]),
    );
    await store.recordRace(
      race([
        result({ seat: 0, name: "Alice", placement: 1 }),
        result({ seat: 1, name: "Bob", placement: 2 }),
      ]),
    );

    const board = await store.leaderboard();
    expect(board).toEqual([
      { name: "Alice", wins: 2, races: 3, winRate: 2 / 3 },
      { name: "Bob", wins: 1, races: 3, winRate: 1 / 3 },
    ]);
  });

  test("merges names case-insensitively, displaying the most recent casing", async () => {
    await store.recordRace(race([result({ name: "speedy", placement: 1 })]));
    await store.recordRace(race([result({ name: "SPEEDY", placement: 2 })]));
    const board = await store.leaderboard();
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ name: "SPEEDY", wins: 1, races: 2 });
  });

  test("excludes unnamed seats from the leaderboard but stores the row", async () => {
    await store.recordRace(
      race([
        result({ seat: 0, name: "Alice", placement: 1 }),
        result({ seat: 1, name: null, placement: 2 }),
      ]),
    );
    const board = await store.leaderboard();
    expect(board.map((e) => e.name)).toEqual(["Alice"]);
    // The unnamed row is still persisted (race history stays complete).
    const rows = await prisma.raceResult.count();
    expect(rows).toBe(2);
  });

  test("excludes time-trial races from leaderboard aggregation", async () => {
    await store.recordRace(
      race([result({ name: "Solo", placement: 1 })], {
        gameMode: "time-trials",
      }),
    );
    await store.recordRace(
      race([result({ name: "Solo", placement: 1 })], { gameMode: "gp" }),
    );
    const board = await store.leaderboard();
    expect(board).toEqual([{ name: "Solo", wins: 1, races: 1, winRate: 1 }]);
  });

  test("respects the limit argument", async () => {
    for (let i = 0; i < 5; i++) {
      await store.recordRace(
        race([result({ name: `P${String(i)}`, placement: 1 })]),
      );
    }
    expect(await store.leaderboard(3)).toHaveLength(3);
  });
});
