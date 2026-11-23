import type { Hono } from "hono";
import { expect, test } from "vitest";
import {
  IngestBatchAckSchema,
  OnlineActivityResponseSchema,
  PlayersDirectoryResponseSchema,
  ServerOverviewResponseSchema,
  ViewerInfoSchema,
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

async function requestJson(app: Hono, path: string): Promise<unknown> {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  return response.json();
}

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
        "/api/v1/players?sort=activityIndex&pageSize=10",
      ),
    );
    expect(pubPlayers.total).toBe(28);
    expect(pubPlayers.items).toHaveLength(10);
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

    const profileByName = PlayerProfileResponseSchema.parse(
      await requestJson(publicApp, "/api/v1/players/jerred"),
    );
    expect(profileByName.player.name).toBe("Jerred");
    expect(profileByName.player.online).toBe(true);

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
    expect(gameplay.skillsTop.length).toBeGreaterThan(0);
    expect(gameplay.rwfTop.length).toBeGreaterThan(0);
    expect(gameplay.arenaTop.length).toBeGreaterThan(0);
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
      await requestJson(staffApp, "/api/v1/players?sort=coins&pageSize=10"),
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
    expect(staffNetwork.joinAddresses.length).toBeGreaterThanOrEqual(3);

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
      schemaVersion: 1,
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
          clientVersion: "1.21.4",
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
          world: "skylands",
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
    const badSchemaRes = await postBatch(JSON.stringify({ schemaVersion: 99 }));
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
      schemaVersion: 1,
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
          world: "world",
        },
      ],
      playerSnapshots: [
        {
          playerUuid,
          playerName: "Chrono",
          capturedAt: "2026-11-22T12:00:00Z",
          nickname: null,
          primaryGroup: "default",
          coins: 500,
          townName: null,
          townRole: null,
          townClaims: 0,
          powerLevel: 10,
          topSkill: null,
          topSkillLevel: 0,
          skills: {},
          tracks: {},
          questsCompleted: 1,
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
            world: "world",
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

    // Sub-second snapshot 50ms after whole-second "12:00:00Z" must supersede 500 -> 950 coins
    store.ingestBatch({
      schemaVersion: 1,
      batchId: "77777777-7777-4000-8000-000000000002",
      serverName: "The Storm",
      sentAt: "2026-11-22T12:00:00.050Z",
      events: [],
      playerSnapshots: [
        {
          playerUuid,
          playerName: "Chrono",
          capturedAt: "2026-11-22T12:00:00.050Z",
          nickname: null,
          primaryGroup: "default",
          coins: 950,
          townName: null,
          townRole: null,
          townClaims: 0,
          powerLevel: 12,
          topSkill: null,
          topSkillLevel: 0,
          skills: {},
          tracks: {},
          questsCompleted: 2,
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
    expect(freshProfile?.gameplay?.coins).toBe(950);
    expect(freshProfile?.player.online).toBe(true);
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
      schemaVersion: 1,
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
          clientVersion: "1.21.50",
          clientBrand: "Geyser",
          joinAddress: "bedrock.ts-mc.net",
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
          joinAddress: "bedrock.ts-mc.net",
        },
      ],
      playerSnapshots: [
        {
          playerUuid: bedrockUuid,
          playerName: ".BedrockBuilder",
          capturedAt: "2026-11-22T18:00:00Z",
          nickname: null,
          primaryGroup: "default",
          coins: 300,
          townName: null,
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
            world: "world",
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
