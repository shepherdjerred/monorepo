import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  ScoutClientObservationSchema,
} from "@scout-for-lol/data";

const mocks = vi.hoisted(() => ({
  byRiotId: vi.fn(),
  aliasFindMany: vi.fn(),
  aliasFindUnique: vi.fn(),
  aliasCreateMany: vi.fn(),
  attemptFindMany: vi.fn(),
  attemptCreateMany: vi.fn(),
  attemptUpdate: vi.fn(),
  observationUpdateMany: vi.fn(),
  observationFindFirst: vi.fn(),
  deviceFindUnique: vi.fn(),
  accountFindMany: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    leagueIdentityAlias: {
      findMany: mocks.aliasFindMany,
      findUnique: mocks.aliasFindUnique,
      createMany: mocks.aliasCreateMany,
    },
    leagueIdentityAliasAttempt: {
      findMany: mocks.attemptFindMany,
      createMany: mocks.attemptCreateMany,
      update: mocks.attemptUpdate,
    },
    scoutClientObservation: {
      updateMany: mocks.observationUpdateMany,
      findFirst: mocks.observationFindFirst,
    },
    scoutClientDevice: { findUnique: mocks.deviceFindUnique },
    account: { findMany: mocks.accountFindMany },
  },
}));
vi.mock("#src/league/api/api.ts", () => ({
  riotClient: { account: { getByRiotId: mocks.byRiotId } },
}));

const {
  aliasBackoffMs,
  drainAliasAttempts,
  enqueueAliasAttempts,
  nextAttemptState,
} = await import("./identity-alias-attempts.ts");
const { learnBatchIdentities } =
  await import("#src/scout-client/observation-identity.ts");
const { RiotHttpError } = await import("#src/league/api/client/errors.ts");

const OWNER_ID = DiscordAccountIdSchema.parse("160509172704739328");
const SELF_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const FRIEND_UUID = "6a7b8c9d-0e1f-4203-9405-a6b7c8d9e0f1";
const FRIEND_PUUID = "f".repeat(78);
const OBSERVATION_ID = "5a1c0f2e-7d3b-4e8a-9c6f-1b2d3e4f5a6b";
const NOW = new Date("2026-11-11T12:00:00.000Z");

function httpError(status: number) {
  return new RiotHttpError({
    status,
    statusText: "x",
    body: null,
    url: "https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id",
    headers: new Headers(),
  });
}

function pendingAttempt(overrides: Record<string, unknown> = {}) {
  return {
    lcuUuid: FRIEND_UUID,
    state: "pending",
    gameName: "Virmel",
    tagLine: "NA1",
    platformId: "NA1",
    learnedFromDeviceId: "device-1",
    attempts: 0,
    nextAttemptAt: NOW,
    lastErrorClass: null,
    observationIds: ["obs-1", "obs-2"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.aliasFindMany.mockResolvedValue([]);
  mocks.aliasFindUnique.mockResolvedValue(null);
  mocks.aliasCreateMany.mockResolvedValue({ count: 1 });
  mocks.attemptFindMany.mockResolvedValue([]);
  mocks.attemptCreateMany.mockResolvedValue({ count: 1 });
  mocks.observationUpdateMany.mockResolvedValue({ count: 2 });
  mocks.deviceFindUnique.mockResolvedValue({ ownerId: OWNER_ID });
  mocks.accountFindMany.mockResolvedValue([]);
});

describe("attempt state", () => {
  test("backs off exponentially and stops at the cap", () => {
    expect(aliasBackoffMs(0)).toBe(60_000);
    expect(aliasBackoffMs(1)).toBe(120_000);
    expect(aliasBackoffMs(3)).toBe(480_000);
    expect(aliasBackoffMs(30)).toBe(6 * 60 * 60_000);
  });

  test("an error keeps the attempt pending with a later time and its class", () => {
    expect(
      nextAttemptState(
        { attempts: 2 },
        { kind: "error", errorClass: "rate_limited" },
        NOW,
      ),
    ).toEqual({
      state: "pending",
      attempts: 3,
      nextAttemptAt: new Date(NOW.getTime() + 240_000),
      lastErrorClass: "rate_limited",
    });
  });

  test("found resolves and not_found settles", () => {
    expect(
      nextAttemptState({ attempts: 0 }, { kind: "found" }, NOW),
    ).toMatchObject({ state: "resolved", attempts: 1, lastErrorClass: null });
    expect(
      nextAttemptState({ attempts: 4 }, { kind: "not_found" }, NOW),
    ).toMatchObject({ state: "not_found", attempts: 5 });
  });
});

describe("draining due attempts", () => {
  test("resolves, stores a riot_id mapping and re-queues the naming observations", async () => {
    mocks.attemptFindMany.mockResolvedValue([pendingAttempt()]);
    mocks.byRiotId.mockResolvedValue({ puuid: FRIEND_PUUID });

    expect(await drainAliasAttempts(NOW)).toBe(1);

    expect(mocks.aliasCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            lcuUuid: FRIEND_UUID,
            puuid: FRIEND_PUUID,
            source: "riot_id",
          }),
        ],
      }),
    );
    expect(mocks.attemptUpdate).toHaveBeenCalledWith({
      where: { lcuUuid: FRIEND_UUID },
      data: expect.objectContaining({ state: "resolved", attempts: 1 }),
    });
    expect(mocks.observationUpdateMany).toHaveBeenCalledWith({
      where: {
        observationId: { in: ["obs-1", "obs-2"] },
        kind: { in: ["post_game", "clash"] },
      },
      data: { recoveryComplete: false, recoveryAttemptAt: new Date(0) },
    });
  });

  test("a failure between the requeue and the terminal write leaves the attempt pending and repeatable", async () => {
    mocks.attemptFindMany.mockResolvedValue([pendingAttempt()]);
    mocks.byRiotId.mockResolvedValue({ puuid: FRIEND_PUUID });
    mocks.observationUpdateMany.mockRejectedValueOnce(new Error("db down"));

    await expect(drainAliasAttempts(NOW)).rejects.toThrow("db down");
    expect(mocks.attemptUpdate).not.toHaveBeenCalled();

    expect(await drainAliasAttempts(NOW)).toBe(1);
    expect(mocks.observationUpdateMany).toHaveBeenCalledTimes(2);
    expect(mocks.attemptUpdate).toHaveBeenCalledWith({
      where: { lcuUuid: FRIEND_UUID },
      data: expect.objectContaining({ state: "resolved" }),
    });
  });

  test("schedules a retry after a 5xx and re-queues nothing", async () => {
    mocks.attemptFindMany.mockResolvedValue([pendingAttempt({ attempts: 1 })]);
    mocks.byRiotId.mockRejectedValue(httpError(503));

    await drainAliasAttempts(NOW);

    expect(mocks.attemptUpdate).toHaveBeenCalledWith({
      where: { lcuUuid: FRIEND_UUID },
      data: {
        state: "pending",
        attempts: 2,
        nextAttemptAt: new Date(NOW.getTime() + 120_000),
        lastErrorClass: "server_error",
      },
    });
    expect(mocks.observationUpdateMany).not.toHaveBeenCalled();
  });

  test("settles a 404 as not_found", async () => {
    mocks.attemptFindMany.mockResolvedValue([pendingAttempt()]);
    mocks.byRiotId.mockRejectedValue(httpError(404));

    await drainAliasAttempts(NOW);

    expect(mocks.attemptUpdate).toHaveBeenCalledWith({
      where: { lcuUuid: FRIEND_UUID },
      data: expect.objectContaining({ state: "not_found", attempts: 1 }),
    });
    expect(mocks.observationUpdateMany).not.toHaveBeenCalled();
  });

  test("stops the batch at the first rate limit", async () => {
    mocks.attemptFindMany.mockResolvedValue([
      pendingAttempt({ lcuUuid: "a" }),
      pendingAttempt({ lcuUuid: "b" }),
    ]);
    mocks.byRiotId.mockRejectedValue(httpError(429));

    expect(await drainAliasAttempts(NOW)).toBe(1);
    expect(mocks.byRiotId).toHaveBeenCalledTimes(1);
  });

  test("asks only for a bounded, due, pending batch", async () => {
    await drainAliasAttempts(NOW, 7);

    expect(mocks.attemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { state: "pending", nextAttemptAt: { lte: NOW } },
        take: 7,
      }),
    );
  });
});

describe("amending an existing attempt", () => {
  test("a pending attempt restarts with the new Riot ID", async () => {
    mocks.attemptFindMany.mockResolvedValue([
      pendingAttempt({ attempts: 3, lastErrorClass: "server_error" }),
    ]);

    await enqueueAliasAttempts(
      [
        {
          lcuUuid: FRIEND_UUID,
          gameName: "Renamed",
          tagLine: "EUW",
          platformId: "EUW1",
          observationId: "obs-3",
        },
      ],
      "device-1",
      NOW,
    );

    expect(mocks.attemptUpdate).toHaveBeenCalledWith({
      where: { lcuUuid: FRIEND_UUID },
      data: expect.objectContaining({
        state: "pending",
        gameName: "Renamed",
        tagLine: "EUW",
        platformId: "EUW1",
        attempts: 0,
        nextAttemptAt: NOW,
        lastErrorClass: null,
        observationIds: ["obs-1", "obs-2", "obs-3"],
      }),
    });
  });
});

describe("ingress identity learning", () => {
  test("looks up the observer inline and only queues everyone else", async () => {
    mocks.byRiotId.mockResolvedValue({ puuid: "s".repeat(78) });
    const observation = ScoutClientObservationSchema.parse({
      protocolVersion: 1,
      schemaVersion: 1,
      observationId: OBSERVATION_ID,
      sequence: 1,
      capturedAt: NOW.toISOString(),
      appVersion: "0.1.0",
      kind: "post_game",
      localPuuid: SELF_UUID,
      platformId: "NA1",
      payload: {
        participantIdentities: [
          {
            participantId: 1,
            player: { puuid: SELF_UUID, gameName: "sjerred", tagLine: "sjerr" },
          },
          {
            participantId: 2,
            player: { puuid: FRIEND_UUID, gameName: "Virmel", tagLine: "NA1" },
          },
        ],
      },
    });

    await learnBatchIdentities(
      { deviceId: "device-1", ownerId: OWNER_ID, appVersion: "0.1.0" },
      [observation],
    );

    expect(mocks.byRiotId).toHaveBeenCalledTimes(1);
    expect(mocks.byRiotId).toHaveBeenCalledWith("sjerred", "sjerr", "AMERICAS");
    expect(mocks.attemptCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          lcuUuid: FRIEND_UUID,
          state: "pending",
          observationIds: [OBSERVATION_ID],
          learnedFromDeviceId: "device-1",
        }),
      ],
      skipDuplicates: true,
    });
  });
});
