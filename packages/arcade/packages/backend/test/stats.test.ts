import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { games, type Player } from "@arcade/common/catalog.ts";
import { type FightState, type RaceState } from "@arcade/common/telemetry.ts";
import { openTestDatabase } from "@discord-plays-mario-kart/backend/database/test-database.ts";
import { createPlayerDirectory } from "@discord-plays-mario-kart/backend/auth/player-directory.ts";
import { createPrismaLeaderboardStore } from "@discord-plays-mario-kart/backend/leaderboard/store.ts";
import { StatsStore } from "#src/stats/store.ts";
import { ResultTracker } from "#src/stats/tracker.ts";
import { BrawlTelemetry } from "#src/games/brawl/telemetry.ts";
import { brawlPlaying, brawlResults } from "./support/brawl-observations.ts";

let db: Awaited<ReturnType<typeof openTestDatabase>>;
let store: StatsStore;
const alice: Player = { discordId: "10", name: "Alice", avatarUrl: null };
const bob: Player = { discordId: "11", name: "Bob", avatarUrl: null };
beforeEach(async () => {
  db = await openTestDatabase();
  store = new StatsStore(db);
});
afterEach(async () => {
  await db.$disconnect();
});

function race(timeMs = 90_000): RaceState {
  return {
    family: "racing",
    phase: "racing",
    round: 1,
    mode: "versus",
    courseId: 0,
    engineClass: "150cc",
    mirror: false,
    lapCount: 3,
    racers: [
      {
        slot: 0,
        seat: 0,
        human: true,
        characterId: 0,
        vehicleId: 0,
        lap: 3,
        placement: 1,
        timeMs,
        finished: false,
      },
    ],
  };
}
function fight(): FightState {
  return {
    family: "fighting",
    phase: "playing",
    round: 1,
    mode: "stock",
    teams: false,
    stageId: 32,
    remainingMs: 90_000,
    fighters: [
      {
        seat: 0,
        human: true,
        characterId: 2,
        damage: 0,
        stocks: 4,
        score: null,
        kos: 0,
        falls: 0,
        selfDestructs: 0,
        placement: null,
        winner: null,
      },
    ],
  };
}

describe("Brawl result scene persistence", () => {
  it("persists a real Brawl result once across result-scene loading, with frozen human attribution", async () => {
    let players: readonly (Player | null)[] = [alice];
    const errors: Error[] = [];
    let recorded = 0;
    const tracker = new ResultTracker({
      gameId: "brawl",
      guildId: "1",
      sessionId: "brawl-scene-transition",
      players: () => players,
      store,
      recorded: () => {
        recorded++;
      },
      failed: (error) => {
        errors.push(error);
      },
    });
    const decoder = new BrawlTelemetry();
    tracker.update(decoder.update(brawlPlaying));
    players = [bob];
    tracker.update(
      decoder.update({ ...brawlResults, scene: "scMemoryChange" }),
    );
    tracker.update(decoder.update({ ...brawlResults, scene: "", modeRule: 0 }));
    tracker.update(decoder.update(brawlResults));
    tracker.update(decoder.update(brawlResults));
    await tracker.flush();
    expect(errors).toEqual([]);
    expect(recorded).toBe(1);
    expect(await db.smashMatch.count()).toBe(1);
    const stats = await new StatsStore(db).read("1", "brawl");
    expect(stats.leaderboard).toHaveLength(1);
    expect(stats.leaderboard[0]).toMatchObject({
      player: { discordId: alice.discordId },
      played: 1,
      wins: 0,
      kos: 0,
      falls: 7,
      selfDestructs: 5,
    });
    expect(stats.recent).toHaveLength(1);
  });
});

describe("persistent game statistics", () => {
  it("deduplicates results and isolates Wii, MK64, and other servers", async () => {
    const result = race();
    result.phase = "finished";
    result.racers.forEach((racer) => {
      racer.finished = true;
    });
    await store.recordRace(
      { guildId: "1", gameId: "mkwii", roundId: "wii-1" },
      result,
      [alice],
    );
    await store.recordRace(
      { guildId: "1", gameId: "mkwii", roundId: "wii-1" },
      result,
      [alice],
    );
    await store.recordRace(
      { guildId: "2", gameId: "mkwii", roundId: "wii-2" },
      result,
      [bob],
    );
    await store.recordRace(
      { guildId: "1", gameId: "mk64", roundId: "mk-1" },
      result,
      [bob],
    );
    expect(await db.race.count()).toBe(3);
    const wiiStats = await store.read("1", "mkwii");
    expect(wiiStats.leaderboard.map((entry) => entry.player.discordId)).toEqual(
      ["10"],
    );
    const legacy = createPrismaLeaderboardStore(
      db,
      createPlayerDirectory(db),
    ).forGuild("1");
    const legacyLeaderboard = await legacy.leaderboard();
    expect(legacyLeaderboard.map((entry) => entry.player.discordId)).toEqual([
      "11",
    ]);
    expect(await legacy.recentRaces()).toHaveLength(1);
  });

  it("keeps time trials out of win totals and separates record rules", async () => {
    const result = race();
    result.phase = "finished";
    result.racers.forEach((racer) => {
      racer.finished = true;
    });
    await store.recordRace(
      { guildId: "1", gameId: "mkwii", roundId: "race" },
      result,
      [alice],
    );
    result.mode = "time-trials";
    result.racers[0]!.timeMs = 80_000;
    await store.recordRace(
      { guildId: "1", gameId: "mkwii", roundId: "tt" },
      result,
      [alice],
    );
    result.mirror = true;
    await store.recordRace(
      { guildId: "1", gameId: "mkwii", roundId: "mirror-tt" },
      result,
      [alice],
    );
    const stats = await store.read("1", "mkwii");
    expect(stats.leaderboard[0]?.played).toBe(1);
    expect(stats.records).toHaveLength(3);
    expect(stats.recent).toHaveLength(3);
  });

  it("freezes attribution and finish times even if the seat changes and rank drifts", async () => {
    let players: readonly (Player | null)[] = [alice];
    const tracker = new ResultTracker({
      gameId: "mkwii",
      guildId: "1",
      sessionId: "session",
      players: () => players,
      store,
      recorded: () => {
        /* Persistence is asserted directly below. */
      },
      failed: (error) => {
        throw error;
      },
    });
    const state = race();
    state.racers.push({
      slot: 1,
      seat: 1,
      human: true,
      characterId: 1,
      vehicleId: 0,
      lap: 3,
      placement: 2,
      timeMs: 95_000,
      finished: false,
    });
    tracker.update(state);
    players = [bob];
    state.racers[0]!.finished = true;
    tracker.update(state);
    state.racers[0]!.placement = 12;
    state.racers[0]!.timeMs = 100_000;
    state.phase = "finished";
    tracker.update(state);
    tracker.update(state);
    await tracker.flush();
    const result = await db.raceResult.findFirst({ where: { seat: 0 } });
    expect(result).toMatchObject({
      discordId: "10",
      placement: 1,
      raceTimeMs: 90_000,
    });
    expect(await db.race.count()).toBe(1);
  });

  it("does not record an aborted match, and accepts the authoritative result after sudden death", async () => {
    const errors: Error[] = [];
    const tracker = new ResultTracker({
      gameId: "brawl",
      guildId: "1",
      sessionId: "session",
      players: () => [alice],
      store,
      recorded: () => {
        /* Persistence is asserted directly below. */
      },
      failed: (error) => {
        errors.push(error);
      },
    });
    const state = fight();
    tracker.update(state);
    state.phase = "menu";
    tracker.update(state);
    await tracker.flush();
    expect(await db.smashMatch.count()).toBe(0);
    state.round = 2;
    state.phase = "playing";
    tracker.update(state);
    state.phase = "sudden-death";
    tracker.update(state);
    state.phase = "results";
    state.fighters[0] = {
      ...state.fighters[0]!,
      winner: true,
      placement: 1,
      kos: 3,
      falls: 1,
      selfDestructs: 1,
    };
    tracker.update(state);
    tracker.update(state);
    await tracker.flush();
    expect(errors).toEqual([]);
    const stats = await store.read("1", games.brawl.id);
    expect(stats.leaderboard[0]).toMatchObject({
      played: 1,
      wins: 1,
      kos: 3,
      falls: 1,
      selfDestructs: 1,
    });
    const meleeStats = await store.read("1", "melee");
    expect(meleeStats.leaderboard).toEqual([]);
  });
});
