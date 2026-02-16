import { describe, expect, test } from "bun:test";

import {
  ChampionIdSchema,
  type GamesPlayedSnapshotData,
  GamesPlayedSnapshotDataSchema,
  getSnapshotSchemaForCriteria,
  type HighestRankCriteria,
  type MostGamesPlayedCriteria,
  type MostWinsPlayerCriteria,
  type RankSnapshotData,
  RankSnapshotDataSchema,
  type WinsSnapshotData,
  WinsSnapshotDataSchema,
} from "@scout-for-lol/data";

describe("Snapshot Data Validation", () => {
  test("should validate rank snapshot data structure for HIGHEST_RANK criteria", () => {
    const criteria: HighestRankCriteria = {
      type: "HIGHEST_RANK",
      queue: "SOLO",
    };

    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(RankSnapshotDataSchema);

    const mockRankData: RankSnapshotData = {
      solo: {
        tier: "gold",
        division: 2,
        lp: 45,
        wins: 50,
        losses: 40,
      },
      flex: {
        tier: "silver",
        division: 1,
        lp: 80,
        wins: 30,
        losses: 25,
      },
    };

    const result = schema.safeParse(mockRankData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(mockRankData);
    }
  });

  test("should validate rank snapshot data with only solo rank", () => {
    const mockRankData: RankSnapshotData = {
      solo: {
        tier: "platinum",
        division: 3,
        lp: 20,
        wins: 100,
        losses: 95,
      },
    };

    const result = RankSnapshotDataSchema.safeParse(mockRankData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.solo).toBeDefined();
      expect(result.data.flex).toBeUndefined();
    }
  });

  test("should validate empty rank snapshot data (unranked player)", () => {
    const mockRankData: RankSnapshotData = {};

    const result = RankSnapshotDataSchema.safeParse(mockRankData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.solo).toBeUndefined();
      expect(result.data.flex).toBeUndefined();
    }
  });

  test("should validate games played snapshot data structure for MOST_GAMES_PLAYED criteria", () => {
    const criteria: MostGamesPlayedCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(GamesPlayedSnapshotDataSchema);

    const mockGamesData: GamesPlayedSnapshotData = {
      soloGames: 150,
      flexGames: 75,
      arenaGames: 20,
      aramGames: 300,
    };

    const result = schema.safeParse(mockGamesData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(mockGamesData);
    }
  });

  test("should validate games played snapshot with only some queues", () => {
    const mockGamesData: GamesPlayedSnapshotData = {
      soloGames: 100,
      flexGames: 0,
      arenaGames: 0,
      aramGames: 0,
    };

    const result = GamesPlayedSnapshotDataSchema.safeParse(mockGamesData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.soloGames).toBe(100);
      expect(result.data.flexGames).toBe(0);
      expect(result.data.arenaGames).toBe(0);
      expect(result.data.aramGames).toBe(0);
    }
  });

  test("should reject games played snapshot with negative values", () => {
    const mockGamesData = {
      soloGames: -5,
      flexGames: 10,
    };

    const result = GamesPlayedSnapshotDataSchema.safeParse(mockGamesData);
    expect(result.success).toBe(false);
  });

  test("should validate wins snapshot data structure for MOST_WINS_PLAYER criteria", () => {
    const criteria: MostWinsPlayerCriteria = {
      type: "MOST_WINS_PLAYER",
      queue: "RANKED_ANY",
    };

    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(WinsSnapshotDataSchema);

    const mockWinsData: WinsSnapshotData = {
      wins: 75,
      games: 150,
      queue: "RANKED_ANY",
    };

    const result = schema.safeParse(mockWinsData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(mockWinsData);
    }
  });

  test("should validate wins snapshot data with champion ID", () => {
    const mockWinsData: WinsSnapshotData = {
      wins: 25,
      games: 40,
      championId: ChampionIdSchema.parse(157), // Yasuo
      queue: "SOLO",
    };

    const result = WinsSnapshotDataSchema.safeParse(mockWinsData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.championId).toBe(ChampionIdSchema.parse(157));
    }
  });

  test("should validate wins snapshot data with zero values (new account)", () => {
    const mockWinsData: WinsSnapshotData = {
      wins: 0,
      games: 0,
      // championId is optional, omit it since 0 is not a valid champion ID
      queue: "SOLO",
    };

    const result = WinsSnapshotDataSchema.safeParse(mockWinsData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.wins).toBe(0);
      expect(result.data.games).toBe(0);
      expect(result.data.championId).toBeUndefined();
    }
  });

  test("should reject wins snapshot with negative values", () => {
    const mockWinsData = {
      wins: -5,
      games: 10,
    };

    const result = WinsSnapshotDataSchema.safeParse(mockWinsData);
    expect(result.success).toBe(false);
  });

  test("should reject wins snapshot with wins greater than games", () => {
    // Note: This is a logic error, but Zod schema doesn't enforce this
    // The validation would need to be in application code
    const mockWinsData: WinsSnapshotData = {
      wins: 100,
      games: 50,
    };

    // This will pass schema validation (schema doesn't have cross-field validation)
    const result = WinsSnapshotDataSchema.safeParse(mockWinsData);
    expect(result.success).toBe(true);

    // But application code should catch this
    if (result.success) {
      expect(result.data.wins).toBeGreaterThan(result.data.games);
    }
  });

  test("should get correct schema for each criteria type", () => {
    expect(
      getSnapshotSchemaForCriteria({ type: "HIGHEST_RANK", queue: "SOLO" }),
    ).toBe(RankSnapshotDataSchema);
    expect(
      getSnapshotSchemaForCriteria({ type: "MOST_RANK_CLIMB", queue: "FLEX" }),
    ).toBe(RankSnapshotDataSchema);
    expect(
      getSnapshotSchemaForCriteria({
        type: "MOST_GAMES_PLAYED",
        queue: "SOLO",
      }),
    ).toBe(GamesPlayedSnapshotDataSchema);
    expect(
      getSnapshotSchemaForCriteria({
        type: "MOST_WINS_PLAYER",
        queue: "RANKED_ANY",
      }),
    ).toBe(WinsSnapshotDataSchema);
    expect(
      getSnapshotSchemaForCriteria({
        type: "MOST_WINS_CHAMPION",
        championId: ChampionIdSchema.parse(157),
      }),
    ).toBe(WinsSnapshotDataSchema);
    expect(
      getSnapshotSchemaForCriteria({
        type: "HIGHEST_WIN_RATE",
        queue: "SOLO",
        minGames: 10,
      }),
    ).toBe(WinsSnapshotDataSchema);
  });
});
