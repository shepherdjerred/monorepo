import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  ScoutClientObservationBatchSchema,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import type { AuthenticatedScoutClient } from "./authentication.ts";

const { prisma } = createTestDatabase("scout-client-identity-alias");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const mocks = vi.hoisted(() => ({ byRiotId: vi.fn() }));
vi.doMock("#src/league/api/api.ts", () => ({
  riotClient: { account: { getByRiotId: mocks.byRiotId } },
}));

const { ingestObservationBatch } = await import("./ingress.ts");
const { readTimelineSelection } = await import("./canonical-match.ts");

const OWNER_ID = DiscordAccountIdSchema.parse("160509172704739328");
const GUILD_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const SELF_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const FRIEND_UUID = "6a7b8c9d-0e1f-4203-9405-a6b7c8d9e0f1";
const SELF_PUUID = LeaguePuuidSchema.parse("s".repeat(78));
const FRIEND_PUUID = LeaguePuuidSchema.parse("f".repeat(78));

/** What account-v1 answers for each Riot ID the client reports. */
const RIOT_ACCOUNTS = new Map([
  ["sjerred#sjerr", SELF_PUUID],
  ["Virmel#NA1", FRIEND_PUUID],
]);

let device: AuthenticatedScoutClient;
let sequence = 0;

function observation(
  kind: string,
  payload: unknown,
  extra: Record<string, unknown> = {},
) {
  sequence += 1;
  return {
    protocolVersion: 1,
    schemaVersion: 1,
    observationId: crypto.randomUUID(),
    sequence,
    capturedAt: new Date().toISOString(),
    appVersion: "0.1.0",
    kind,
    localPuuid: SELF_UUID,
    payload,
    ...extra,
  };
}

/** `/lol-summoner/v1/current-summoner`, as the client wraps it. */
function accountProfile() {
  return observation("account_profile", {
    resource: "account_profile",
    data: { puuid: SELF_UUID, gameName: "sjerred", tagLine: "sjerr" },
  });
}

/** A post-game bundle whose match history names both players by UUID. */
function postGame() {
  return observation(
    "post_game",
    {
      resource: "post_game",
      data: {
        matchHistory: {
          gameId: 5_653_248_720,
          participantIdentities: [
            {
              participantId: 1,
              player: {
                puuid: SELF_UUID,
                gameName: "sjerred",
                tagLine: "sjerr",
              },
            },
            {
              participantId: 2,
              player: {
                puuid: FRIEND_UUID,
                gameName: "Virmel",
                tagLine: "NA1",
              },
            },
          ],
        },
      },
    },
    { gameId: "5653248720", platformId: "NA1" },
  );
}

/** One League-client timeline frame for participants 1 and 2. */
function timelineFrame(minute: number, events: unknown[]) {
  return {
    timestamp: minute * 60_000,
    participantFrames: Object.fromEntries(
      [1, 2].map((participantId) => [
        participantId.toString(),
        {
          participantId,
          currentGold: 500,
          totalGold: 500 + minute * 300,
          xp: minute * 400,
          level: 1 + minute,
          minionsKilled: minute * 7,
          jungleMinionsKilled: 0,
          position: { x: 1000, y: 1000 },
        },
      ]),
    ),
    events,
  };
}

/** A post-game bundle carrying the League client's timeline for the game. */
function postGameWithTimeline() {
  return observation(
    "post_game",
    {
      resource: "post_game",
      data: {
        matchHistory: {
          gameId: 5_653_248_720,
          participantIdentities: [
            {
              participantId: 1,
              player: {
                puuid: SELF_UUID,
                gameName: "sjerred",
                tagLine: "sjerr",
              },
            },
            {
              participantId: 2,
              player: {
                puuid: FRIEND_UUID,
                gameName: "Virmel",
                tagLine: "NA1",
              },
            },
          ],
          participants: [
            { participantId: 1, teamId: 100 },
            { participantId: 2, teamId: 200 },
          ],
        },
        timeline: {
          frames: [
            timelineFrame(0, []),
            timelineFrame(1, [
              {
                type: "CHAMPION_KILL",
                timestamp: 75_000,
                killerId: 1,
                victimId: 2,
                assistingParticipantIds: [],
                position: { x: 1, y: 1 },
                buildingType: "",
                itemId: 0,
              },
            ]),
          ],
        },
      },
    },
    { gameId: "5653248720", platformId: "NA1" },
  );
}

function batch(...observations: unknown[]) {
  return ScoutClientObservationBatchSchema.parse({ observations });
}

beforeEach(async () => {
  sequence = 0;
  mocks.byRiotId.mockReset();
  mocks.byRiotId.mockImplementation(
    async (gameName: string, tagLine: string) => {
      const puuid = RIOT_ACCOUNTS.get(`${gameName}#${tagLine}`);
      if (puuid === undefined) {
        throw new RiotHttpError({
          status: 404,
          statusText: "Not Found",
          body: null,
          url: "https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id",
          headers: new Headers(),
        });
      }
      return { puuid, gameName, tagLine };
    },
  );
  await prisma.leagueIdentityAlias.deleteMany();
  // An accepted profile projects a snapshot row that pins its observation,
  // as does a canonical selection.
  await prisma.scoutClientCanonicalMatch.deleteMany();
  await prisma.scoutClientPlayerSnapshot.deleteMany();
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDeviceVersion.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.user.deleteMany();

  const now = new Date();
  await prisma.player.create({
    data: {
      alias: "sjerred",
      discordId: OWNER_ID,
      serverId: GUILD_ID,
      creatorDiscordId: OWNER_ID,
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: {
          alias: "sjerred",
          puuid: SELF_PUUID,
          region: "AMERICA_NORTH",
          serverId: GUILD_ID,
          creatorDiscordId: OWNER_ID,
          createdTime: now,
          updatedTime: now,
        },
      },
    },
  });
  const created = await prisma.scoutClientDevice.create({
    data: {
      owner: { create: { discordId: OWNER_ID, discordUsername: "owner" } },
      pairing: {
        create: {
          secretDigest: crypto.randomUUID(),
          deviceName: "desktop",
          platform: "windows",
          architecture: "x86_64",
          appVersion: "0.1.0",
          protocolVersion: 1,
          expiresAt: new Date(now.getTime() + 60_000),
        },
      },
      tokenDigest: crypto.randomUUID(),
      deviceName: "desktop",
      platform: "windows",
      architecture: "x86_64",
      appVersion: "0.1.0",
      protocolVersion: 1,
      versions: { create: { appVersion: "0.1.0" } },
    },
  });
  device = { deviceId: created.id, ownerId: OWNER_ID, appVersion: "0.1.0" };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ingesting observations named by League-client UUID", () => {
  test("accepts them once the observer's Riot ID resolves to an owned account", async () => {
    const receipts = await ingestObservationBatch(
      device,
      batch(accountProfile(), postGame()),
    );

    expect(receipts.map((receipt) => receipt.outcome)).toEqual([
      "accepted",
      "accepted",
    ]);
    const stored = await prisma.scoutClientObservation.findMany({
      orderBy: { sequence: "asc" },
      select: { localPuuid: true, localLcuUuid: true, payload: true },
    });
    for (const row of stored) {
      expect(row.localPuuid).toBe(SELF_PUUID);
      expect(row.localLcuUuid).toBe(SELF_UUID);
    }
    // The stored payload is the evidence, kept exactly as the client sent it.
    expect(JSON.stringify(stored[1]?.payload)).toContain(FRIEND_UUID);
  });

  test("learns an alias for every player a post-game identifies in full", async () => {
    await ingestObservationBatch(device, batch(accountProfile(), postGame()));

    const aliases = await prisma.leagueIdentityAlias.findMany({
      orderBy: { lcuUuid: "asc" },
      select: { lcuUuid: true, puuid: true, source: true },
    });
    expect(aliases).toEqual(
      [
        { lcuUuid: SELF_UUID, puuid: SELF_PUUID, source: "riot_id" },
        { lcuUuid: FRIEND_UUID, puuid: FRIEND_PUUID, source: "riot_id" },
      ].sort((left, right) => left.lcuUuid.localeCompare(right.lcuUuid)),
    );
  });

  test("looks a player up once, then answers from the alias", async () => {
    await ingestObservationBatch(device, batch(accountProfile()));
    await ingestObservationBatch(device, batch(accountProfile()));

    expect(mocks.byRiotId).toHaveBeenCalledTimes(1);
  });

  test("resolves the observer from a profile stored before aliases existed", async () => {
    // The beta backlog: every profile so far was quarantined, but it is still
    // stored, and the client sends its profile only when it changes.
    await prisma.scoutClientObservation.create({
      data: {
        observationId: crypto.randomUUID(),
        deviceId: device.deviceId,
        sequence: 1000n,
        capturedAt: new Date(),
        protocolVersion: 1,
        schemaVersion: 1,
        appVersion: "0.1.0",
        kind: "account_profile",
        localPuuid: SELF_UUID,
        payload: {
          resource: "account_profile",
          data: { puuid: SELF_UUID, gameName: "sjerred", tagLine: "sjerr" },
        },
        bodyDigest: "legacy",
        disposition: "QUARANTINED",
        quarantineReason: "unverified_local_puuid",
      },
    });

    const receipts = await ingestObservationBatch(
      device,
      batch(
        observation("gameflow", {
          resource: "gameflow_phase",
          data: "InProgress",
        }),
      ),
    );

    expect(receipts[0]?.outcome).toBe("accepted");
  });

  test("still quarantines an observer whose Riot ID Riot doesn't know", async () => {
    const unknown = observation("account_profile", {
      resource: "account_profile",
      data: { puuid: SELF_UUID, gameName: "nobody", tagLine: "0000" },
    });

    const receipts = await ingestObservationBatch(device, batch(unknown));

    expect(receipts[0]).toMatchObject({
      outcome: "quarantined",
      quarantineReason: "unverified_local_puuid",
    });
    expect(await prisma.leagueIdentityAlias.count()).toBe(0);
  });

  test("never accepts a Riot ID that resolves to someone else's account", async () => {
    // A client can claim any Riot ID for its UUID, but ownership is still
    // checked against the device owner's registered accounts.
    const claimed = observation("account_profile", {
      resource: "account_profile",
      data: { puuid: SELF_UUID, gameName: "Virmel", tagLine: "NA1" },
    });

    const receipts = await ingestObservationBatch(device, batch(claimed));

    expect(receipts[0]).toMatchObject({
      outcome: "quarantined",
      quarantineReason: "unverified_local_puuid",
    });
  });

  test("lets a player's own client correct an alias a forged claim taught", async () => {
    // Someone's payload claimed this UUID belongs to another Riot ID. When
    // the player's own client reports their real one, it resolves to an
    // account the device owner registered, and that verified alias wins.
    const forged = observation("account_profile", {
      resource: "account_profile",
      data: { puuid: SELF_UUID, gameName: "Virmel", tagLine: "NA1" },
    });
    await ingestObservationBatch(device, batch(forged));

    const receipts = await ingestObservationBatch(
      device,
      batch(accountProfile()),
    );

    expect(receipts[0]?.outcome).toBe("accepted");
    expect(
      await prisma.leagueIdentityAlias.findUnique({
        where: { lcuUuid: SELF_UUID },
        select: { puuid: true, ownerVerified: true },
      }),
    ).toEqual({ puuid: SELF_PUUID, ownerVerified: true });
  });

  test("does not let an unverified claim replace a verified alias", async () => {
    await ingestObservationBatch(device, batch(accountProfile()));
    const forged = observation("account_profile", {
      resource: "account_profile",
      data: { puuid: SELF_UUID, gameName: "Virmel", tagLine: "NA1" },
    });

    await ingestObservationBatch(device, batch(forged));

    expect(
      await prisma.leagueIdentityAlias.findUnique({
        where: { lcuUuid: SELF_UUID },
        select: { puuid: true },
      }),
    ).toEqual({ puuid: SELF_PUUID });
  });

  test("survives a failed lookup and retries on the next observation", async () => {
    mocks.byRiotId.mockRejectedValueOnce(new Error("connection reset"));

    const first = await ingestObservationBatch(device, batch(accountProfile()));
    const second = await ingestObservationBatch(
      device,
      batch(accountProfile()),
    );

    expect(first[0]?.outcome).toBe("quarantined");
    expect(second[0]?.outcome).toBe("accepted");
  });
});

describe("client-sourced match timelines", () => {
  test("serves a client-sourced match's timeline in Riot identities", async () => {
    await ingestObservationBatch(
      device,
      batch(accountProfile(), postGameWithTimeline()),
    );
    const source = await prisma.scoutClientObservation.findFirstOrThrow({
      where: { kind: "post_game" },
    });
    const riotMatchId = RiotMatchIdSchema.parse("NA1_5653248720");
    await prisma.scoutClientCanonicalMatch.create({
      data: {
        riotMatchId,
        sourceObservationId: source.observationId,
        payloadDigest: source.bodyDigest,
        selectedAt: new Date(),
      },
    });

    const selection = await readTimelineSelection(riotMatchId);

    expect(selection.source).toBe("SCOUT_CLIENT");
    const timeline =
      selection.source === "SCOUT_CLIENT" ? selection.timeline : null;
    expect(timeline?.metadata.participants).toEqual([SELF_PUUID, FRIEND_PUUID]);
    const kill = timeline?.info.frames[1]?.events[0];
    expect(kill).toMatchObject({ killerId: 1, victimId: 2 });
    expect(kill?.itemId).toBeUndefined();
  });

  test("leaves a match nobody selected from a client to Riot", async () => {
    expect(
      await readTimelineSelection(RiotMatchIdSchema.parse("NA1_5653248720")),
    ).toEqual({ source: "RIOT" });
  });
});
