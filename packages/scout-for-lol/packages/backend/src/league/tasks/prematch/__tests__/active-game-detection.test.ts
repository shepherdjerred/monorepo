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

function mkParticipant(puuid: string, teamId: number, championId: number) {
  return {
    puuid,
    teamId,
    spell1Id: 4,
    spell2Id: 7,
    championId,
    lastSelectedSkinIndex: 0,
    profileIconId: 0,
    riotId: `test-${puuid.slice(0, 6)}#NA1`,
    bot: false,
    gameCustomizationObjects: [],
    perks: { perkIds: [], perkStyle: 0, perkSubStyle: 0 },
  };
}

function mkGameInfo(gameId: number, puuid: LeaguePuuid): RawCurrentGameInfo {
  // A started game reports a full 10-player roster. Build the tracked player
  // plus 9 fillers so the pre-start/partial-roster defer guard
  // (participants < 10) does NOT fire for these "already in progress" fixtures.
  const fillers = Array.from({ length: 9 }, (_, i) =>
    mkParticipant(
      `filler-${i.toString()}`.padEnd(78, "z"),
      i < 4 ? 100 : 200,
      10 + i,
    ),
  );
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
    participants: [mkParticipant(puuid, 100, 9), ...fillers],
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
const reportStoreCalls: { gameId: number }[] = [];

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
  prisma: {},
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

// `active-game-detection.ts` imports getActiveServerIds, which pulls in the
// Discord client singleton (and its whole command tree). Mock it so the client
// module is never loaded under the partial database mock above. The return value
// is irrelevant here since getAccountsWithState is mocked to ignore its filter.
await mock.module("#src/discord/utils/guild-membership.ts", () => ({
  getActiveServerIds: () => new Set<string>(),
}));

await mock.module("#src/report-store/live-ingest.ts", () => ({
  recordPrematchForReportStore: ({
    gameInfo,
  }: {
    gameInfo: RawCurrentGameInfo;
  }) => {
    reportStoreCalls.push({ gameId: gameInfo.gameId });
    return Promise.resolve();
  },
}));

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
    reportStoreCalls.length = 0;
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
    expect(reportStoreCalls).toEqual([{ gameId: G2 }]);
    expect(notificationCalls).toHaveLength(1);
    expect(notificationCalls[0]?.gameId).toBe(G2);
  });

  test("defers a custom pre-start lobby (gameType=CUSTOM, <10 participants) — no upsert, no notification", async () => {
    mockAccounts = [mkAccount(P1)];
    // Synthesise the exact shape we pulled from S3 for Bugsink event
    // 46053b15 — a custom 5v5 SR lobby with only the creator present.
    const incomplete = RawCurrentGameInfoSchema.parse({
      gameId: 5_580_574_972,
      gameType: "CUSTOM",
      gameStartTime: Date.now(),
      mapId: 11,
      gameLength: -104,
      platformId: "NA1",
      gameMode: "CLASSIC",
      bannedChampions: [],
      gameQueueConfigId: 3100,
      observers: { encryptionKey: "" },
      participants: [
        {
          puuid: P1,
          teamId: 100,
          spell1Id: 4,
          spell2Id: 12,
          championId: 63,
          lastSelectedSkinIndex: 0,
          profileIconId: 505,
          riotId: "Phaerix#NA1",
          bot: false,
          gameCustomizationObjects: [],
          perks: { perkIds: [], perkStyle: 0, perkSubStyle: 0 },
        },
      ],
    });
    mockSpectatorResponses.set(P1, {
      game: incomplete,
      upstreamError: false,
    });

    // Pass retryDelayMs=0 to skip the real 2×2s sleep in the retry loop.
    await checkActiveGames(0);

    // Pre-start custom lobby must NOT be committed: the next 30s cron
    // tick gets a clean shot once the other players load in.
    expect(upsertCalls).toHaveLength(0);
    expect(notificationCalls).toHaveLength(0);
    expect(reportStoreCalls).toHaveLength(0);
  });

  test("defers a matched pre-start ARAM event lobby (gameType=MATCHED, queue 3220, <10 participants) — no upsert, no notification", async () => {
    mockAccounts = [mkAccount(P1)];
    // Synthesised from the archived spectator-data.json for Bugsink ZodError
    // event (game 7896774982): an ARAM: Mayhem (queue 3220) Howling Abyss
    // lobby still in its pre-game countdown (gameLength -58) with only 2 of 10
    // participants loaded. gameType is MATCHED, not CUSTOM — the old
    // custom-only guard let this through and the builder threw on .length(10).
    const incomplete = RawCurrentGameInfoSchema.parse({
      gameId: 7_896_774_982,
      gameType: "MATCHED",
      gameStartTime: Date.now(),
      mapId: 12,
      gameLength: -58,
      platformId: "NA1",
      gameMode: "ARAM",
      bannedChampions: [],
      gameQueueConfigId: 3220,
      observers: { encryptionKey: "" },
      participants: [P1, "puuid-player-two".padEnd(78, "y")].map(
        (puuid, idx) => ({
          puuid,
          teamId: idx === 0 ? 100 : 200,
          spell1Id: 4,
          spell2Id: 12,
          championId: 63 + idx,
          lastSelectedSkinIndex: 0,
          profileIconId: 505,
          riotId: `Player${idx.toString()}#NA1`,
          bot: false,
          gameCustomizationObjects: [],
          perks: { perkIds: [], perkStyle: 0, perkSubStyle: 0 },
        }),
      ),
    });
    mockSpectatorResponses.set(P1, {
      game: incomplete,
      upstreamError: false,
    });

    // retryDelayMs=0 to skip the real 2×2s sleep in the retry loop.
    await checkActiveGames(0);

    // Matched event lobby caught mid-countdown must NOT be committed; the next
    // 30s cron tick re-evaluates once the full roster has loaded in.
    expect(upsertCalls).toHaveLength(0);
    expect(notificationCalls).toHaveLength(0);
    expect(reportStoreCalls).toHaveLength(0);
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
    expect(reportStoreCalls).toHaveLength(0);
    expect(notificationCalls).toHaveLength(0);
  });
});
