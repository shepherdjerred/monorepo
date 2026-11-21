import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import {
  LeaguePuuidSchema,
  type LeaguePuuid,
} from "@scout-for-lol/domain/identity/league-account.ts";
import type { Prisma } from "#generated/prisma/client/index.js";
import fixtures from "@scout-for-lol/data/scout-client/live-game-recording.fixtures.json" with { type: "json" };
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client/scout-client-device.ts";

const { prisma } = createTestDatabase("end-of-game-review-reads");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const { endOfGameReviewReads } = await import("./end-of-game-review-reads.ts");

const ASKER = DiscordAccountIdSchema.parse("160509172704739328");
const OTHER = DiscordAccountIdSchema.parse("160509172704739329");
const GUILD = DiscordGuildIdSchema.parse("200000000000000001");
const ELSEWHERE = DiscordGuildIdSchema.parse("200000000000000002");
const MATCH = RiotMatchIdSchema.parse("NA1_5653248720");
const VERIFIED = LeaguePuuidSchema.parse("v".repeat(78));
const TRACKED = LeaguePuuidSchema.parse("t".repeat(78));
const UNTRACKED_GUILD = LeaguePuuidSchema.parse("u".repeat(78));
const STAMPS = {
  creatorDiscordId: ASKER,
  createdTime: new Date("2026-11-01T00:00:00Z"),
  updatedTime: new Date("2026-11-01T00:00:00Z"),
};

async function storeRecording(input: {
  readonly deviceId: string;
  readonly localPuuid: string;
  readonly disposition?: string;
  readonly capturedAt?: Date;
  readonly payload?: Prisma.InputJsonValue;
}) {
  await prisma.scoutClientObservation.create({
    data: {
      observationId: crypto.randomUUID(),
      deviceId: input.deviceId,
      sequence: BigInt(Math.floor(Math.random() * 1_000_000)),
      capturedAt: input.capturedAt ?? new Date(),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: "live_game_recording",
      platformId: "NA1",
      gameId: "5653248720",
      localPuuid: input.localPuuid,
      payload: input.payload ?? fixtures.recording,
      bodyDigest: crypto.randomUUID(),
      disposition: input.disposition ?? "ACCEPTED",
      quarantineReason:
        input.disposition === "QUARANTINED" ? "identity_unresolved" : null,
    },
  });
}

async function trackPlayer(serverId: DiscordGuildId, puuid: LeaguePuuid) {
  await prisma.player.create({
    data: {
      alias: `player-${puuid.slice(0, 1)}`,
      discordId: ASKER,
      serverId,
      ...STAMPS,
      accounts: {
        create: {
          alias: "main",
          puuid,
          region: "AMERICA_NORTH",
          serverId,
          ...STAMPS,
        },
      },
    },
  });
}

beforeEach(async () => {
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDeviceVersion.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.riotAccountPreference.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the asker's accounts for an end-of-game review", () => {
  test("are their verified accounts and the players their servers track as them", async () => {
    await prisma.user.create({
      data: { discordId: ASKER, discordUsername: "asker" },
    });
    await prisma.riotAccountPreference.create({
      data: {
        puuid: VERIFIED,
        ownerDiscordId: ASKER,
        gameName: "Asker",
        tagLine: "NA1",
        verifiedAt: new Date(),
      },
    });
    await trackPlayer(GUILD, TRACKED);
    // A server the asker is not in this turn does not speak for them.
    await trackPlayer(ELSEWHERE, UNTRACKED_GUILD);

    const puuids = await endOfGameReviewReads.askerPuuids({
      requesterId: ASKER,
      guildIds: [GUILD],
    });
    expect([...puuids].toSorted()).toEqual([TRACKED, VERIFIED].toSorted());
  });

  test("are none for someone Scout has never linked", async () => {
    const puuids = await endOfGameReviewReads.askerPuuids({
      requesterId: OTHER,
      guildIds: [GUILD],
    });
    expect(puuids.size).toBe(0);
  });
});

describe("the asker's own recording of the game", () => {
  test("is the newest accepted recording from their own device and account", async () => {
    const own = await createTestScoutClientDevice(prisma, ASKER);
    await storeRecording({
      deviceId: own,
      localPuuid: VERIFIED,
      capturedAt: new Date("2026-11-20T00:00:00Z"),
    });
    const newer = structuredClone(fixtures.recording);
    newer.data.ended_at = "2026-11-14T12:30:00.000Z";
    await storeRecording({
      deviceId: own,
      localPuuid: VERIFIED,
      capturedAt: new Date("2026-11-21T00:00:00Z"),
      payload: newer,
    });

    const recording = await endOfGameReviewReads.ownRecording({
      requesterId: ASKER,
      matchId: MATCH,
      puuid: VERIFIED,
    });
    expect(recording?.data.ended_at).toBe("2026-11-14T12:30:00.000Z");
  });

  test("is never another user's recording, another account's, or a quarantined one", async () => {
    const own = await createTestScoutClientDevice(prisma, ASKER);
    const theirs = await createTestScoutClientDevice(prisma, OTHER);
    // Another Scout user who recorded the same account in the same game.
    await storeRecording({ deviceId: theirs, localPuuid: VERIFIED });
    // The asker's device signed in to a different account.
    await storeRecording({ deviceId: own, localPuuid: TRACKED });
    await storeRecording({
      deviceId: own,
      localPuuid: VERIFIED,
      disposition: "QUARANTINED",
    });

    expect(
      await endOfGameReviewReads.ownRecording({
        requesterId: ASKER,
        matchId: MATCH,
        puuid: VERIFIED,
      }),
    ).toBeNull();
  });

  test("an accepted recording that no longer passes its check fails loudly", async () => {
    const own = await createTestScoutClientDevice(prisma, ASKER);
    await storeRecording({
      deviceId: own,
      localPuuid: VERIFIED,
      payload: { resource: "live_game_recording", data: { samples: [] } },
    });
    await expect(
      endOfGameReviewReads.ownRecording({
        requesterId: ASKER,
        matchId: MATCH,
        puuid: VERIFIED,
      }),
    ).rejects.toThrow(/no longer passes its check/);
  });
});
