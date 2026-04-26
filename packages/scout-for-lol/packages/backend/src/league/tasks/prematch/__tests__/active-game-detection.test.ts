import { describe, expect, test, mock, beforeEach } from "bun:test";
import type {
  PlayerConfigEntry,
  RawCurrentGameInfo,
  LeaguePuuid,
} from "@scout-for-lol/data/index.ts";
import {
  PlayerConfigEntrySchema,
  RawCurrentGameInfoSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data/index.ts";
import type { ActiveGameRecord } from "#src/league/tasks/prematch/active-game-queries.ts";
import type { PlayerAccountWithState } from "#src/database/index.ts";
import type { SpectatorResult } from "#src/league/api/spectator.ts";

// LeaguePuuid is a 78-char branded string. Pad two short labels to that length
// so Schema.parse() succeeds (the value is opaque to checkActiveGames).
const P1: LeaguePuuid = LeaguePuuidSchema.parse(
  "puuid-player-one".padEnd(78, "x"),
);
const G1 = 1_000_000_001;
const G2 = 1_000_000_002;

function mkAccount(puuid: LeaguePuuid): PlayerAccountWithState {
  const config = PlayerConfigEntrySchema.parse({
    alias: `alias-${puuid.slice(0, 8)}`,
    league: {
      leagueAccount: {
        puuid,
        region: "AMERICA_NORTH",
      },
    },
  });
  return { config, lastMatchTime: new Date(), lastCheckedAt: undefined };
}

function mkGameInfo(gameId: number, puuid: LeaguePuuid): RawCurrentGameInfo {
  return RawCurrentGameInfoSchema.parse({
    gameId,
    gameType: "MATCHED",
    gameStartTime: Date.now(),
    mapId: 11,
    gameLength: 0,
    platformId: "NA1",
    gameMode: "CLASSIC",
    bannedChampions: [],
    gameQueueConfigId: 420,
    observers: { encryptionKey: "" },
    participants: [
      {
        puuid,
        teamId: 100,
        spell1Id: 4,
        spell2Id: 7,
        championId: 9,
        lastSelectedSkinIndex: 0,
        profileIconId: 0,
        riotId: "test#NA1",
        bot: false,
        gameCustomizationObjects: [],
        perks: { perkIds: [], perkStyle: 0, perkSubStyle: 0 },
      },
    ],
  });
}

// Module-level mutable state captured by the mocks
let mockActiveGames: ActiveGameRecord[] = [];
let mockAccounts: PlayerAccountWithState[] = [];
let mockSpectatorResponses = new Map<LeaguePuuid, SpectatorResult>();
const upsertCalls: { gameId: number; puuids: LeaguePuuid[] }[] = [];
const notificationCalls: {
  gameId: number;
  trackedPlayers: PlayerConfigEntry[];
}[] = [];

// Mocks target leaf functions only — checkActiveGames imports each of
// these names directly. We deliberately do NOT spread the real module:
// some of these modules (notably prematch-notification, which transitively
// initialises the Discord client) have heavy import-time side effects, and
// pulling them in just to spread into the mock would defeat the test
// isolation we need.
//
// Sibling files in this directory (e.g. prematch-notification.integration.test.ts)
// also call `mock.module("#src/database/index.ts", ...)`. Bun mocks are
// process-global, so we have to provide every database export any sibling
// test file mocks — otherwise sibling tests that ran first leave a partial
// mock in place that hides exports our SUT needs.
await mock.module("#src/database/index.ts", () => ({
  getAccountsWithState: () => Promise.resolve(mockAccounts),
  getChannelsSubscribedToPlayers: () => Promise.resolve([]),
}));

await mock.module("#src/league/tasks/prematch/active-game-queries.ts", () => ({
  getActiveGames: () => Promise.resolve(mockActiveGames),
  upsertActiveGame: (gameId: number, puuids: LeaguePuuid[]) => {
    upsertCalls.push({ gameId, puuids });
    return Promise.resolve();
  },
  deleteExpiredActiveGames: () => Promise.resolve(0),
  getActiveGameCount: () => Promise.resolve(mockActiveGames.length),
}));

await mock.module("#src/league/api/spectator.ts", () => ({
  getActiveGame: (puuid: LeaguePuuid) => {
    const response = mockSpectatorResponses.get(puuid);
    if (response === undefined) {
      return Promise.resolve({ game: undefined, upstreamError: false });
    }
    return Promise.resolve(response);
  },
}));

await mock.module(
  "#src/league/tasks/prematch/prematch-notification.ts",
  () => ({
    sendPrematchNotification: (
      gameInfo: RawCurrentGameInfo,
      trackedPlayers: PlayerConfigEntry[],
    ) => {
      notificationCalls.push({ gameId: gameInfo.gameId, trackedPlayers });
      return Promise.resolve();
    },
  }),
);

// Import AFTER mocks so the function under test wires up to the mocked deps
const { checkActiveGames } =
  await import("#src/league/tasks/prematch/active-game-detection.ts");

describe("checkActiveGames — subsequent-match polling", () => {
  beforeEach(() => {
    mockActiveGames = [];
    mockAccounts = [];
    mockSpectatorResponses = new Map();
    upsertCalls.length = 0;
    notificationCalls.length = 0;
  });

  test("polls a player who has a non-expired ActiveGame row and detects a NEW gameId", async () => {
    // Setup: player P1 already has ActiveGame row for game G1 (the bug:
    // pre-fix this would skip P1 entirely until the 2-hour TTL expired)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // +1h
    mockActiveGames = [
      {
        gameId: G1,
        trackedPuuids: [P1],
        detectedAt: new Date(),
        expiresAt,
      },
    ];
    mockAccounts = [mkAccount(P1)];
    // Spectator now reports P1 in a DIFFERENT game (G2)
    mockSpectatorResponses.set(P1, {
      game: mkGameInfo(G2, P1),
      upstreamError: false,
    });

    await checkActiveGames();

    // Pre-fix: P1 was filtered out by the per-PUUID skip-list → no upsert,
    // no notification. Post-fix: P1 is polled, G2 is detected, both fire.
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toEqual({ gameId: G2, puuids: [P1] });
    expect(notificationCalls).toHaveLength(1);
    expect(notificationCalls[0]?.gameId).toBe(G2);
  });

  test("dedupes when Spectator returns the SAME gameId already in ActiveGame", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    mockActiveGames = [
      {
        gameId: G1,
        trackedPuuids: [P1],
        detectedAt: new Date(),
        expiresAt,
      },
    ];
    mockAccounts = [mkAccount(P1)];
    // Spectator reports P1 still in game G1 (still mid-match)
    mockSpectatorResponses.set(P1, {
      game: mkGameInfo(G1, P1),
      upstreamError: false,
    });

    await checkActiveGames();

    // gameId-based dedup at line 181 must prevent a duplicate notification
    expect(upsertCalls).toHaveLength(0);
    expect(notificationCalls).toHaveLength(0);
  });
});
