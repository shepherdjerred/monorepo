import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { Hono } from "hono";
import { expect, test } from "vitest";
import {
  INGEST_CONTRACT,
  IngestBatchAckSchema,
  OnlineActivityResponseSchema,
  PlayerGameplaySnapshotSchema,
  PlayersDirectoryResponseSchema,
  STORM_SKILLS,
  ServerOverviewResponseSchema,
  ViewerInfoSchema,
  WORLD_BUCKETS,
  type IngestBatch,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  GameplayOverviewResponseSchema,
  PvpOverviewResponseSchema,
} from "@shepherdjerred/storm-stats/shared/gameplay-contract.ts";
import { PlayerProfileResponseSchema } from "@shepherdjerred/storm-stats/shared/player-contract.ts";
import {
  StaffBouncesResponseSchema,
  StaffNetworkResponseSchema,
  StaffPlayerOverlayResponseSchema,
  StaffQueryResponseSchema,
} from "@shepherdjerred/storm-stats/shared/staff-contract.ts";
import { seedDemoData } from "@shepherdjerred/storm-stats/seed-demo.ts";
import { createIngestApp, createPublicApp, createStaffApp } from "./app.ts";
import { StormStatsStore } from "./store.ts";

const FIXED_NOW = new Date("2026-11-22T20:00:00Z");
const TEST_TOKEN = "storm-stats-unit-test-bearer-token-0001";

async function requestJson(app: Hono, pathName: string): Promise<unknown> {
  const response = await app.request(pathName);
  expect(response.status).toBe(200);
  return response.json();
}

test("shared Zod contract aligns field-for-field with contracts/ingest-v1.json", () => {
  expect(INGEST_CONTRACT.schemaVersion).toBe(2);
  expect([...WORLD_BUCKETS]).toEqual(INGEST_CONTRACT.worlds);
  expect(Object.keys(PlayerGameplaySnapshotSchema.shape)).toEqual(
    INGEST_CONTRACT.playerSnapshotFields,
  );
  expect(STORM_SKILLS).toHaveLength(11);
});

test("public v1 endpoints validate strictly against contract Zod schemas on seeded data", async () => {
  const store = StormStatsStore.open(":memory:");
  try {
    const seeded = seedDemoData(store, FIXED_NOW);
    expect(seeded.playersSeeded).toBe(28);
    expect(store.playerCount()).toBe(28);

    const publicApp = createPublicApp({
      store,
      publicEnabled: async () => true,
      now: () => FIXED_NOW,
    });

    const pubViewer = ViewerInfoSchema.parse(
      await requestJson(publicApp, "/api/v1/viewer"),
    );
    expect(pubViewer.role).toBe("public");
    expect(pubViewer.publicEnabled).toBe(true);

    const overview = ServerOverviewResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/overview"),
    );
    expect(overview.serverName).toBe("The Storm");
    expect(overview.onlineNow).toBe(6);
    expect(overview.dailyActivity30d).toHaveLength(30);
    expect(overview.playerbaseGroups.total).toBe(28);
    expect(overview.playerbaseGroups.regular).toBeGreaterThan(0);
    expect(overview.playerbaseGroups.inactive).toBeGreaterThan(0);
    expect(overview.kpis.peakOnline30d).toBeGreaterThanOrEqual(6);
    expect(overview.worldBreakdown.some((w) => w.label === "Frontier")).toBe(
      true,
    );
    expect(
      overview.modeBreakdown.some((m) => m.label === "Search and Destroy"),
    ).toBe(true);

    const activity = OnlineActivityResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/activity"),
    );
    expect(activity.timeZone).toBe("America/Los_Angeles");
    expect(activity.dailySeries180d).toHaveLength(180);
    expect(activity.calendar730d).toHaveLength(730);
    expect(activity.punchcard).toHaveLength(168);
    expect(activity.retentionCohorts).toHaveLength(12);
    expect(
      activity.firstSessionEngagement.completedFirstSessions,
    ).toBeGreaterThan(0);

    const pubPlayers = PlayersDirectoryResponseSchema.parse(
      await requestJson(
        publicApp,
        "/api/v1/players?sort=activityIndex&pageSize=28",
      ),
    );
    expect(pubPlayers.total).toBe(28);
    expect(pubPlayers.items).toHaveLength(28);
    expect(pubPlayers.items.some((r) => r.townKind === "camp")).toBe(true);
    for (const row of pubPlayers.items) {
      expect(row.staff).toBeUndefined();
    }

    const targetPlayer = pubPlayers.items[0];
    expect(targetPlayer).toBeDefined();
    const profileByUuid = PlayerProfileResponseSchema.parse(
      await requestJson(
        publicApp,
        `/api/v1/players/${targetPlayer?.uuid ?? ""}`,
      ),
    );
    expect(profileByUuid.calendar365d).toHaveLength(365);
    expect(profileByUuid.gameplay).not.toBeNull();
    expect(Object.keys(profileByUuid.gameplay?.skills ?? {})).toHaveLength(11);

    const profileByName = PlayerProfileResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/players/jerred"),
    );
    expect(profileByName.player.name).toBe("Jerred");
    expect(profileByName.player.online).toBe(true);
    expect(profileByName.gameplay?.townName).toBe("Altaria");
    expect(profileByName.gameplay?.townKind).toBe("town");
    expect(profileByName.gameplay?.townRole).toBe("owner");

    const missingProfile = await publicApp.request(
      "/api/v1/players/nonexistent_player_xyz",
    );
    expect(missingProfile.status).toBe(404);

    const pvp = PvpOverviewResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/pvp"),
    );
    expect(pvp.kpis.totalPvpKills).toBeGreaterThan(0);
    expect(pvp.kpis.totalMobKills).toBeGreaterThan(0);
    expect(pvp.topWarriors.length).toBeGreaterThan(0);

    const gameplay = GameplayOverviewResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/gameplay"),
    );
    expect(gameplay.economyTop.length).toBeGreaterThan(0);
    expect(gameplay.towns).toHaveLength(5);
    expect(gameplay.towns.every((t) => t.kind === "player")).toBe(true);
    expect(gameplay.skillsTop.length).toBeGreaterThan(0);
    expect(gameplay.rwfTop.length).toBeGreaterThan(0);
    expect(gameplay.arenaTop.length).toBeGreaterThan(0);
    expect(gameplay.arenaTop.every((a) => a.arena === "colosseum")).toBe(true);
    expect(gameplay.questsTop.length).toBeGreaterThan(0);
  } finally {
    store.close();
  }
});

test("staff endpoints & publicEnabled gate validate cleanly against contract schemas", async () => {
  const store = StormStatsStore.open(":memory:");
  try {
    seedDemoData(store, FIXED_NOW);
    let publicEnabled = true;
    const publicApp = createPublicApp({
      store,
      publicEnabled: async () => publicEnabled,
      now: () => FIXED_NOW,
    });
    const staffApp = createStaffApp({
      store,
      publicEnabled: async () => publicEnabled,
      now: () => FIXED_NOW,
    });

    const staffViewer = ViewerInfoSchema.parse(
      await requestJson(staffApp, "/api/v1/viewer"),
    );
    expect(staffViewer.role).toBe("staff");

    const staffPlayers = PlayersDirectoryResponseSchema.parse(
      await requestJson(staffApp, "/api/v1/players?sort=crystals&pageSize=10"),
    );
    expect(staffPlayers.items).toHaveLength(10);
    for (const row of staffPlayers.items) {
      expect(row.staff).toBeDefined();
      expect(row.staff?.countryCode).toMatch(/^[A-Z]{2}$/u);
    }

    const staffNetwork = StaffNetworkResponseSchema.parse(
      await requestJson(staffApp, "/api/staff/network"),
    );
    expect(staffNetwork.countries.length).toBeGreaterThan(3);
    expect(
      staffNetwork.joinAddresses
        .map((j) => j.joinAddress)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["mc.ts-mc.net", "ts-mc.net"]);

    const staffBounces = StaffBouncesResponseSchema.parse(
      await requestJson(staffApp, "/api/staff/bounces"),
    );
    expect(staffBounces.byCategory).toHaveLength(6);
    expect(staffBounces.recentBounces.length).toBeGreaterThan(0);

    const staffQuery = StaffQueryResponseSchema.parse(
      await requestJson(
        staffApp,
        "/api/staff/query?activityGroup=regular,active&country=US&minSessions=2",
      ),
    );
    expect(staffQuery.summary.matchedPlayers).toBeGreaterThan(0);
    expect(staffQuery.players.every((p) => p.staff?.countryCode === "US")).toBe(
      true,
    );

    const staffOverlay = StaffPlayerOverlayResponseSchema.parse(
      await requestJson(staffApp, "/api/staff/players/Jerred"),
    );
    expect(staffOverlay.name).toBe("Jerred");
    expect(staffOverlay.joinAddresses.length).toBeGreaterThan(0);
    expect(staffOverlay.geolocations.length).toBeGreaterThan(0);
    expect(staffOverlay.clientBrands.length).toBeGreaterThan(0);

    const staffRawRes = await staffApp.request("/api/staff/players/Jerred/raw");
    expect(staffRawRes.status).toBe(200);
    const staffRaw = await staffRawRes.json();
    expect(staffRaw.profile.player.name).toBe("Jerred");

    publicEnabled = false;
    const disabledViewerRes = await publicApp.request("/api/v1/viewer");
    expect(disabledViewerRes.status).toBe(200);
    const disabledViewerBody = await disabledViewerRes.json();
    expect(disabledViewerBody.publicEnabled).toBe(false);

    const disabledOverviewRes = await publicApp.request("/api/v1/overview");
    expect(disabledOverviewRes.status).toBe(503);
    expect(await disabledOverviewRes.json()).toEqual({
      error: "Public stats temporarily unavailable",
    });

    const staffOverviewWhenDisabled =
      await staffApp.request("/api/v1/overview");
    expect(staffOverviewWhenDisabled.status).toBe(200);
  } finally {
    store.close();
  }
});

test("ingest endpoint enforces auth, ingestEnabled flag, payload size limit, schema validation, and 100% event idempotency", async () => {
  const store = StormStatsStore.open(":memory:");
  try {
    let ingestEnabled = true;
    const ingestApp = createIngestApp({
      store,
      ingestToken: TEST_TOKEN,
      ingestEnabled: async () => ingestEnabled,
      maxBodyBytes: 4096,
    });

    const playerUuid = "11111111-1111-4000-8000-000000000001";
    const sessionId = "22222222-2222-4000-8000-000000000001";
    const validBatch: IngestBatch = {
      schemaVersion: 2,
      batchId: "33333333-3333-4000-8000-000000000001",
      serverName: "The Storm",
      sentAt: "2026-11-22T19:05:00Z",
      events: [
        {
          type: "session_started",
          eventId: "44444444-4444-4000-8000-000000000001",
          occurredAt: "2026-11-22T18:00:00Z",
          sessionId,
          playerUuid,
          playerName: "TestPilot",
          firstSeenAt: "2026-11-22T18:00:00Z",
          platform: "java",
          clientVersion: "26.3",
          clientBrand: "fabric",
          joinAddress: "ts-mc.net",
          countryCode: "US",
          countryName: "United States",
        },
        {
          type: "session_interval",
          eventId: "44444444-4444-4000-8000-000000000002",
          occurredAt: "2026-11-22T18:00:00Z",
          intervalEnd: "2026-11-22T18:30:00Z",
          sessionId,
          playerUuid,
          playerName: "TestPilot",
          world: "frontier",
          mode: "survival",
          connectedMs: 1_800_000,
          activeMs: 1_500_000,
          pingMs: 28,
        },
        {
          type: "session_ended",
          eventId: "44444444-4444-4000-8000-000000000003",
          occurredAt: "2026-11-22T18:30:00Z",
          sessionId,
          playerUuid,
          playerName: "TestPilot",
          startedAt: "2026-11-22T18:00:00Z",
          connectedMs: 1_800_000,
          activeMs: 1_500_000,
          endReason: "disconnect",
          pingMinMs: 24,
          pingAvgMs: 28,
          pingMaxMs: 35,
        },
      ],
      playerSnapshots: [],
      serverSnapshot: null,
    };

    const postBatch = (body: string, token = TEST_TOKEN) =>
      ingestApp.request("/api/v1/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body,
      });

    const unauthRes = await postBatch("{}", "wrong-token");
    expect(unauthRes.status).toBe(401);

    ingestEnabled = false;
    const disabledRes = await postBatch(JSON.stringify(validBatch));
    expect(disabledRes.status).toBe(503);
    ingestEnabled = true;

    const hugeRes = await postBatch(JSON.stringify({ pad: "x".repeat(5000) }));
    expect(hugeRes.status).toBe(413);

    const brokenJsonRes = await postBatch("{broken-json");
    expect(brokenJsonRes.status).toBe(400);
    const badSchemaRes = await postBatch(JSON.stringify({ schemaVersion: 1 }));
    expect(badSchemaRes.status).toBe(400);

    const firstRes = await postBatch(JSON.stringify(validBatch));
    expect(firstRes.status).toBe(200);
    const firstAck = IngestBatchAckSchema.parse(await firstRes.json());
    expect(firstAck).toEqual({
      acceptedEvents: 3,
      duplicateEvents: 0,
      updatedPlayers: 1,
    });

    const replayRes = await postBatch(JSON.stringify(validBatch));
    expect(replayRes.status).toBe(200);
    const replayAck = IngestBatchAckSchema.parse(await replayRes.json());
    expect(replayAck).toEqual({
      acceptedEvents: 0,
      duplicateEvents: 3,
      updatedPlayers: 0,
    });

    const profile = store.getPlayerProfile(playerUuid, FIXED_NOW);
    expect(profile?.player.connectedMs).toBe(1_800_000);
    expect(profile?.player.activeMs).toBe(1_500_000);
    expect(profile?.player.sessionsCount).toBe(1);
    expect(profile?.worldBreakdown[0]?.label).toBe("Frontier");
  } finally {
    store.close();
  }
});

test("normalizes mixed-precision and offset timestamps and expires stale online rosters", () => {
  const store = StormStatsStore.open(":memory:");
  try {
    const playerUuid = "55555555-5555-4000-8000-000000000005";
    const sessionId = "66666666-6666-4000-8000-000000000006";

    store.ingestBatch({
      schemaVersion: 2,
      batchId: "77777777-7777-4000-8000-000000000001",
      serverName: "The Storm",
      sentAt: "2026-11-22T12:00:00Z",
      events: [
        {
          type: "session_started",
          eventId: "88888888-8888-4000-8000-000000000001",
          occurredAt: "2026-11-22T12:00:00Z",
          sessionId,
          playerUuid,
          playerName: "Chrono",
          firstSeenAt: "2026-11-22T12:00:00Z",
          platform: "java",
          clientVersion: "26.3",
          clientBrand: "vanilla",
          joinAddress: "ts-mc.net",
          countryCode: null,
          countryName: null,
        },
        {
          type: "combat_event",
          eventId: "88888888-8888-4000-8000-000000000002",
          occurredAt: "2026-11-22T14:00:00.500+02:00",
          sessionId,
          combatKind: "pve_kill",
          killerUuid: playerUuid,
          killerName: "Chrono",
          victimUuid: null,
          victimName: null,
          mobType: "Zombie",
          weapon: "Diamond Sword",
          world: "frontier",
        },
      ],
      playerSnapshots: [
        {
          playerUuid,
          playerName: "Chrono",
          capturedAt: "2026-11-22T12:00:00Z",
          nickname: null,
          primaryGroup: "default",
          crystals: 500,
          rwfCredits: 120,
          townName: null,
          townKind: null,
          townRole: null,
          townClaims: 0,
          powerLevel: 10,
          topSkill: null,
          topSkillLevel: 0,
          skills: {},
          tracks: { engineer: 4 },
          questsCompleted: 9,
          arenaBestWaves: {},
          rwfMatches: 0,
          rwfWins: 0,
          rwfLosses: 0,
          rwfKills: 0,
          rwfDeaths: 0,
        },
      ],
      serverSnapshot: {
        capturedAt: "2026-11-22T12:00:00Z",
        onlinePlayers: [
          {
            uuid: playerUuid,
            name: "Chrono",
            mode: "survival",
            world: "frontier",
            afk: false,
            pingMs: 32,
            sessionStartedAt: "2026-11-22T12:00:00Z",
          },
        ],
        maxPlayers: 64,
        townsCount: 0,
        towns: [],
      },
    });

    // Sub-second snapshot 50ms after whole-second "12:00:00Z" must supersede 500 -> 950 crystals
    // while null unloaded tracks/questsCompleted preserve existing progression!
    store.ingestBatch({
      schemaVersion: 2,
      batchId: "77777777-7777-4000-8000-000000000002",
      serverName: "The Storm",
      sentAt: "2026-11-22T12:00:00.050Z",
      events: [],
      playerSnapshots: [
        {
          playerUuid,
          playerName: "Chrono",
          capturedAt: "2026-11-22T12:00:00.050Z",
          nickname: "ChronoPrime",
          primaryGroup: "vip",
          crystals: 950,
          rwfCredits: 240,
          townName: "Chrono",
          townKind: "camp",
          townRole: "owner",
          townClaims: 6,
          powerLevel: 12,
          topSkill: null,
          topSkillLevel: 0,
          skills: {},
          tracks: null,
          questsCompleted: null,
          arenaBestWaves: {},
          rwfMatches: 0,
          rwfWins: 0,
          rwfLosses: 0,
          rwfKills: 0,
          rwfDeaths: 0,
        },
      ],
      serverSnapshot: null,
    });

    // Late arrival of an older periodic snapshot must not overwrite nickname, group, or crystals
    store.ingestBatch({
      schemaVersion: 2,
      batchId: "77777777-7777-4000-8000-000000000003",
      serverName: "The Storm",
      sentAt: "2026-11-22T12:00:00.090Z",
      events: [],
      playerSnapshots: [
        {
          playerUuid,
          playerName: "ChronoOld",
          capturedAt: "2026-11-22T12:00:00.010Z",
          nickname: "StaleNick",
          primaryGroup: "default",
          crystals: 10,
          rwfCredits: 0,
          townName: null,
          townKind: null,
          townRole: null,
          townClaims: 0,
          powerLevel: 1,
          topSkill: null,
          topSkillLevel: 0,
          skills: {},
          tracks: {},
          questsCompleted: 0,
          arenaBestWaves: {},
          rwfMatches: 0,
          rwfWins: 0,
          rwfLosses: 0,
          rwfKills: 0,
          rwfDeaths: 0,
        },
      ],
      serverSnapshot: null,
    });

    const freshNow = new Date("2026-11-22T12:03:00Z");
    const freshProfile = store.getPlayerProfile(playerUuid, freshNow);
    expect(freshProfile?.player.firstSeenAt).toBe("2026-11-22T12:00:00.000Z");
    expect(freshProfile?.player.lastSeenAt).toBe("2026-11-22T12:00:00.500Z");
    expect(freshProfile?.player.nickname).toBe("ChronoPrime");
    expect(freshProfile?.player.primaryGroup).toBe("vip");
    expect(freshProfile?.gameplay?.crystals).toBe(950);
    expect(freshProfile?.gameplay?.rwfCredits).toBe(240);
    expect(freshProfile?.gameplay?.townKind).toBe("camp");
    expect(freshProfile?.gameplay?.tracks).toEqual({ engineer: 4 });
    expect(freshProfile?.gameplay?.questsCompleted).toBe(9);
    expect(freshProfile?.player.online).toBe(true);
    expect(store.getGameplayOverview(freshNow).towns).toEqual([]);
    expect(store.getGameplayOverview(freshNow).economyTop).toEqual([
      {
        uuid: playerUuid,
        name: "Chrono",
        crystals: 950,
        townName: "Chrono",
        townKind: "camp",
      },
    ]);
    expect(store.getOverview(freshNow).onlineNow).toBe(1);
    expect(store.onlineCount(freshNow)).toBe(1);

    // Past 5-minute staleness threshold: saved roster expires cleanly
    const staleNow = new Date("2026-11-22T12:06:00Z");
    expect(store.getOverview(staleNow).onlineNow).toBe(0);
    expect(store.getOverview(staleNow).onlinePlayers).toEqual([]);
    expect(store.onlineCount(staleNow)).toBe(0);
    expect(store.getPlayerProfile(playerUuid, staleNow)?.player.online).toBe(
      false,
    );
  } finally {
    store.close();
  }
});

test("accepts Floodgate Bedrock player UUIDs while keeping RFC checks for batch and event IDs", async () => {
  const store = StormStatsStore.open(":memory:");
  try {
    const ingestApp = createIngestApp({
      store,
      ingestToken: TEST_TOKEN,
      ingestEnabled: async () => true,
      maxBodyBytes: 65_536,
    });
    const publicApp = createPublicApp({
      store,
      publicEnabled: async () => true,
      now: () => FIXED_NOW,
    });

    const bedrockUuid = "00000000-0000-0000-0009-01F9E3D21001";
    const normalizedBedrockUuid = "00000000-0000-0000-0009-01f9e3d21001";
    const sessionId = "99999999-9999-4000-8000-000000000001";

    const bedrockBatch = {
      schemaVersion: 2,
      batchId: "99999999-9999-4000-8000-000000000002",
      serverName: "The Storm",
      sentAt: "2026-11-22T18:00:00Z",
      events: [
        {
          type: "session_started",
          eventId: "99999999-9999-4000-8000-000000000003",
          occurredAt: "2026-11-22T18:00:00Z",
          sessionId,
          playerUuid: bedrockUuid,
          playerName: ".BedrockBuilder",
          firstSeenAt: "2026-11-22T18:00:00Z",
          platform: "bedrock",
          clientVersion: "bedrock",
          clientBrand: "Geyser",
          joinAddress: "ts-mc.net",
          countryCode: null,
          countryName: null,
        },
        {
          type: "connection_bounce",
          eventId: "99999999-9999-4000-8000-000000000004",
          occurredAt: "2026-11-22T17:59:00Z",
          playerUuid: bedrockUuid,
          playerName: ".BedrockBuilder",
          category: "full",
          reason: "Server full",
          joinAddress: "ts-mc.net",
        },
      ],
      playerSnapshots: [
        {
          playerUuid: bedrockUuid,
          playerName: ".BedrockBuilder",
          capturedAt: "2026-11-22T18:00:00Z",
          nickname: null,
          primaryGroup: "default",
          crystals: 300,
          rwfCredits: 0,
          townName: null,
          townKind: null,
          townRole: null,
          townClaims: 0,
          powerLevel: 8,
          topSkill: "mining",
          topSkillLevel: 8,
          skills: { mining: 8 },
          tracks: {},
          questsCompleted: 3,
          arenaBestWaves: {},
          rwfMatches: 0,
          rwfWins: 0,
          rwfLosses: 0,
          rwfKills: 0,
          rwfDeaths: 0,
        },
      ],
      serverSnapshot: {
        capturedAt: "2026-11-22T19:59:00Z",
        onlinePlayers: [
          {
            uuid: bedrockUuid,
            name: ".BedrockBuilder",
            mode: "survival",
            world: "frontier",
            afk: false,
            pingMs: 45,
            sessionStartedAt: "2026-11-22T18:00:00Z",
          },
        ],
        maxPlayers: 64,
        townsCount: 0,
        towns: [],
      },
    };

    const okRes = await ingestApp.request("/api/v1/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(bedrockBatch),
    });
    expect(okRes.status).toBe(200);

    // Non-RFC batchId must still fail strict generated-ID validation
    const invalidBatchIdRes = await ingestApp.request("/api/v1/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        ...bedrockBatch,
        batchId: normalizedBedrockUuid,
      }),
    });
    expect(invalidBatchIdRes.status).toBe(400);

    const profileRes = await publicApp.request(
      `/api/v1/players/${normalizedBedrockUuid}`,
    );
    expect(profileRes.status).toBe(200);
    const parsedProfile = PlayerProfileResponseSchema.parse(
      await profileRes.json(),
    );
    expect(parsedProfile.player.uuid).toBe(normalizedBedrockUuid);
    expect(parsedProfile.player.platform).toBe("bedrock");

    const overviewRes = await publicApp.request("/api/v1/overview");
    expect(overviewRes.status).toBe(200);
    const parsedOverview = ServerOverviewResponseSchema.parse(
      await overviewRes.json(),
    );
    expect(parsedOverview.onlinePlayers[0]?.uuid).toBe(normalizedBedrockUuid);
  } finally {
    store.close();
  }
});

test("migrates legacy v1 SQLite database on disk cleanly to v2 schema and scrubs non-player towns", async () => {
  const dbPath = path.join(
    os.tmpdir(),
    `storm-stats-v1-migration-${crypto.randomUUID()}.sqlite`,
  );
  const playerUuid = "aaaaaaaa-aaaa-4000-8000-000000000001";

  const legacyDb = new Database(dbPath, { create: true });
  legacyDb.run(`
    CREATE TABLE players (
      uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL,
      nickname TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'java',
      client_version TEXT NOT NULL DEFAULT 'unknown',
      primary_group TEXT NOT NULL DEFAULT 'default',
      connected_ms INTEGER NOT NULL DEFAULT 0,
      active_ms INTEGER NOT NULL DEFAULT 0,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      longest_session_ms INTEGER NOT NULL DEFAULT 0,
      ping_min_ms INTEGER,
      ping_sum_ms INTEGER NOT NULL DEFAULT 0,
      ping_count INTEGER NOT NULL DEFAULT 0,
      ping_max_ms INTEGER,
      pvp_kills INTEGER NOT NULL DEFAULT 0,
      pvp_deaths INTEGER NOT NULL DEFAULT 0,
      mob_kills INTEGER NOT NULL DEFAULT 0,
      mob_deaths INTEGER NOT NULL DEFAULT 0,
      env_deaths INTEGER NOT NULL DEFAULT 0,
      last_country_code TEXT,
      last_country_name TEXT,
      last_join_address TEXT,
      bounces_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE player_gameplay (
      player_uuid TEXT PRIMARY KEY REFERENCES players(uuid) ON DELETE CASCADE,
      player_name TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      town_name TEXT,
      town_role TEXT,
      town_claims INTEGER NOT NULL DEFAULT 0,
      power_level INTEGER NOT NULL DEFAULT 0,
      top_skill TEXT,
      top_skill_level INTEGER NOT NULL DEFAULT 0,
      skills_json TEXT NOT NULL DEFAULT '{}',
      tracks_json TEXT NOT NULL DEFAULT '{}',
      quests_completed INTEGER NOT NULL DEFAULT 0,
      arena_waves_json TEXT NOT NULL DEFAULT '{}',
      rwf_matches INTEGER NOT NULL DEFAULT 0,
      rwf_wins INTEGER NOT NULL DEFAULT 0,
      rwf_losses INTEGER NOT NULL DEFAULT 0,
      rwf_kills INTEGER NOT NULL DEFAULT 0,
      rwf_deaths INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_gameplay_coins ON player_gameplay(coins DESC);

    CREATE TABLE server_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      server_name TEXT NOT NULL DEFAULT 'The Storm',
      last_ingest_at TEXT,
      snapshot_captured_at TEXT,
      max_players INTEGER NOT NULL DEFAULT 64,
      online_players_json TEXT NOT NULL DEFAULT '[]',
      peak_online_all_time INTEGER NOT NULL DEFAULT 0,
      peak_online_at TEXT,
      towns_json TEXT NOT NULL DEFAULT '[]'
    );
  `);

  legacyDb
    .query(
      `INSERT INTO players (uuid, name, name_lower, first_seen_at, last_seen_at)
       VALUES (?, 'LegacyPlayer', 'legacyplayer', '2026-10-01T00:00:00Z', '2026-11-20T00:00:00Z')`,
    )
    .run(playerUuid);

  legacyDb
    .query(
      `INSERT INTO player_gameplay (
         player_uuid, player_name, captured_at, coins, town_name, town_role, town_claims, power_level
       ) VALUES (?, 'LegacyPlayer', '2026-11-20T00:00:00Z', 500, 'Altaria', 'officer', 32, 140)`,
    )
    .run(playerUuid);

  legacyDb
    .query(
      `INSERT INTO server_state (id, server_name, max_players, online_players_json, peak_online_all_time, towns_json)
       VALUES (1, 'The Storm', 64, '[]', 12, ?)`,
    )
    .run(
      JSON.stringify([
        { name: "Altaria", members: 7, claims: 64, kind: "player" },
        { name: "OldHeritage", members: 2, claims: 15, kind: "heritage" },
        { name: "SpawnProtected", members: 0, claims: 25, kind: "server" },
      ]),
    );
  legacyDb.close(false);

  const store = StormStatsStore.open(dbPath);
  try {
    const publicApp = createPublicApp({
      store,
      publicEnabled: async () => true,
      now: () => FIXED_NOW,
    });

    const profile = PlayerProfileResponseSchema.parse(
      await requestJson(publicApp, `/api/v1/players/${playerUuid}`),
    );
    expect(profile.gameplay?.crystals).toBe(500);
    expect(profile.gameplay?.rwfCredits).toBe(0);
    expect(profile.gameplay?.townRole).toBe("assistant");
    expect(profile.gameplay?.townKind).toBeNull();

    const gameplay = GameplayOverviewResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/gameplay"),
    );
    expect(gameplay.economyTop[0]?.crystals).toBe(500);
    expect(gameplay.economyTop[0]?.townKind).toBeNull();
    expect(gameplay.towns).toEqual([
      { name: "Altaria", members: 7, claims: 64, kind: "player" },
    ]);
  } finally {
    store.close();
    for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      const file = Bun.file(candidate);
      if (await file.exists()) {
        await file.delete();
      }
    }
  }
});

function makePveKillEvent(opts: {
  readonly seq: number;
  readonly killerUuid: string;
  readonly killerName: string;
  readonly mobType: string;
  readonly weapon: string;
}): IngestBatch["events"][number] {
  return {
    type: "combat_event",
    eventId: `dddddddd-dddd-4000-8000-${String(opts.seq).padStart(12, "0")}`,
    occurredAt: `2026-11-22T17:${String(49 + opts.seq).padStart(2, "0")}:00Z`,
    sessionId: null,
    combatKind: "pve_kill",
    killerUuid: opts.killerUuid,
    killerName: opts.killerName,
    victimUuid: null,
    victimName: null,
    mobType: opts.mobType,
    weapon: opts.weapon,
    world: "frontier",
  };
}

function makePlayerSnapshot(opts: {
  readonly playerUuid: string;
  readonly playerName: string;
  readonly crystals: number;
  readonly townName: string | null;
  readonly townKind: "camp" | "town" | null;
}): IngestBatch["playerSnapshots"][number] {
  return {
    playerUuid: opts.playerUuid,
    playerName: opts.playerName,
    capturedAt: "2026-11-22T18:00:00Z",
    nickname: null,
    primaryGroup: "default",
    crystals: opts.crystals,
    rwfCredits: 0,
    townName: opts.townName,
    townKind: opts.townKind,
    townRole: opts.townName === null ? null : "owner",
    townClaims: opts.townName === null ? 0 : 4,
    powerLevel: 15,
    topSkill: "swords",
    topSkillLevel: 9,
    skills: { swords: 9, mining: 6 },
    tracks: {},
    questsCompleted: 2,
    arenaBestWaves: {},
    rwfMatches: 0,
    rwfWins: 0,
    rwfLosses: 0,
    rwfKills: 0,
    rwfDeaths: 0,
  };
}

test("populates economyTop townKind and falls back PvP weapons to PvE kills until PvP kills exist", async () => {
  const store = StormStatsStore.open(":memory:");
  try {
    const campPlayerUuid = "bbbbbbbb-bbbb-4000-8000-000000000001";
    const townPlayerUuid = "bbbbbbbb-bbbb-4000-8000-000000000002";

    store.ingestBatch({
      schemaVersion: 2,
      batchId: "cccccccc-cccc-4000-8000-000000000001",
      serverName: "The Storm",
      sentAt: "2026-11-22T18:00:00Z",
      events: [
        makePveKillEvent({
          seq: 1,
          killerUuid: campPlayerUuid,
          killerName: "goodgamergg556",
          mobType: "ZOMBIE",
          weapon: "IRON_SWORD",
        }),
        makePveKillEvent({
          seq: 2,
          killerUuid: campPlayerUuid,
          killerName: "goodgamergg556",
          mobType: "CREEPER",
          weapon: "IRON_SWORD",
        }),
        makePveKillEvent({
          seq: 3,
          killerUuid: townPlayerUuid,
          killerName: "DuelistTwo",
          mobType: "SKELETON",
          weapon: "DIAMOND_SWORD",
        }),
        makePveKillEvent({
          seq: 4,
          killerUuid: townPlayerUuid,
          killerName: "DuelistTwo",
          mobType: "WITHER_SKELETON",
          weapon: "DIAMOND_SWORD",
        }),
        makePveKillEvent({
          seq: 5,
          killerUuid: townPlayerUuid,
          killerName: "DuelistTwo",
          mobType: "BLAZE",
          weapon: "DIAMOND_SWORD",
        }),
      ],
      playerSnapshots: [
        makePlayerSnapshot({
          playerUuid: campPlayerUuid,
          playerName: "goodgamergg556",
          crystals: 1200,
          townName: "goodgamergg556",
          townKind: "camp",
        }),
        makePlayerSnapshot({
          playerUuid: townPlayerUuid,
          playerName: "DuelistTwo",
          crystals: 800,
          townName: "Altaria",
          townKind: "town",
        }),
      ],
      serverSnapshot: null,
    });

    const publicApp = createPublicApp({
      store,
      publicEnabled: async () => true,
      now: () => FIXED_NOW,
    });

    const gameplay = GameplayOverviewResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/gameplay"),
    );
    expect(gameplay.economyTop).toEqual([
      {
        uuid: campPlayerUuid,
        name: "goodgamergg556",
        crystals: 1200,
        townName: "goodgamergg556",
        townKind: "camp",
      },
      {
        uuid: townPlayerUuid,
        name: "DuelistTwo",
        crystals: 800,
        townName: "Altaria",
        townKind: "town",
      },
    ]);

    const pveOnlyPvp = PvpOverviewResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/pvp"),
    );
    expect(pveOnlyPvp.kpis.totalPvpKills).toBe(0);
    expect(pveOnlyPvp.kpis.totalMobKills).toBe(5);
    expect(pveOnlyPvp.kpis.deadliestWeapon).toBe("DIAMOND_SWORD");
    expect(pveOnlyPvp.topWeapons).toEqual([
      { weapon: "DIAMOND_SWORD", kills: 3, sharePercent: 60 },
      { weapon: "IRON_SWORD", kills: 2, sharePercent: 40 },
    ]);
    expect(
      pveOnlyPvp.topWarriors.map((w) => ({
        name: w.name,
        kills: w.kills,
        mobKills: w.mobKills,
        topWeapon: w.topWeapon,
      })),
    ).toEqual([
      {
        name: "DuelistTwo",
        kills: 0,
        mobKills: 3,
        topWeapon: "DIAMOND_SWORD",
      },
      {
        name: "goodgamergg556",
        kills: 0,
        mobKills: 2,
        topWeapon: "IRON_SWORD",
      },
    ]);

    // Once a PvP kill occurs, topWeapons and killer's topWeapon prefer PvP while PvE-only combatants retain their PvE weapon
    store.ingestBatch({
      schemaVersion: 2,
      batchId: "cccccccc-cccc-4000-8000-000000000002",
      serverName: "The Storm",
      sentAt: "2026-11-22T18:05:00Z",
      events: [
        {
          type: "combat_event",
          eventId: "dddddddd-dddd-4000-8000-000000000006",
          occurredAt: "2026-11-22T18:04:00Z",
          sessionId: null,
          combatKind: "pvp",
          killerUuid: townPlayerUuid,
          killerName: "DuelistTwo",
          victimUuid: campPlayerUuid,
          victimName: "goodgamergg556",
          mobType: null,
          weapon: "IRON_AXE",
          world: "frontier",
        },
      ],
      playerSnapshots: [],
      serverSnapshot: null,
    });

    const afterPvp = PvpOverviewResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/pvp"),
    );
    expect(afterPvp.kpis.totalPvpKills).toBe(1);
    expect(afterPvp.kpis.deadliestWeapon).toBe("IRON_AXE");
    expect(afterPvp.topWeapons).toEqual([
      { weapon: "IRON_AXE", kills: 1, sharePercent: 100 },
    ]);
    expect(
      afterPvp.topWarriors.map((w) => ({
        name: w.name,
        kills: w.kills,
        deaths: w.deaths,
        mobKills: w.mobKills,
        topWeapon: w.topWeapon,
      })),
    ).toEqual([
      {
        name: "DuelistTwo",
        kills: 1,
        deaths: 0,
        mobKills: 3,
        topWeapon: "IRON_AXE",
      },
      {
        name: "goodgamergg556",
        kills: 0,
        deaths: 1,
        mobKills: 2,
        topWeapon: "IRON_SWORD",
      },
    ]);
  } finally {
    store.close();
  }
});
