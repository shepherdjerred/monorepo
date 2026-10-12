import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";

const { prisma } = createTestDatabase("teammates-client-rounds");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const { recentClientRounds } = await import("./client-rounds.ts");

const OWNER = DiscordAccountIdSchema.parse("160509172704739328");
const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const [selfParticipant, teammateParticipant] = fixture.info.participants;
if (selfParticipant === undefined || teammateParticipant === undefined) {
  throw new Error("The rift fixture needs two participants");
}
const SELF = LeaguePuuidSchema.parse(selfParticipant.puuid);
const TEAMMATE = LeaguePuuidSchema.parse(teammateParticipant.puuid);

/** A match whose result came from the client of the player named `observer`. */
async function selectFromClientOf(
  deviceId: string,
  observer: string,
  gameId: number,
): Promise<string> {
  const match = RawMatchSchema.parse({
    ...fixture,
    metadata: { ...fixture.metadata, matchId: `NA1_${gameId.toString()}` },
    info: { ...fixture.info, gameId, platformId: "NA1" },
  });
  const observation = await prisma.scoutClientObservation.create({
    data: {
      observationId: crypto.randomUUID(),
      deviceId,
      sequence: BigInt(gameId),
      capturedAt: new Date(),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: "post_game",
      platformId: "NA1",
      localPuuid: observer,
      gameId: gameId.toString(),
      payload: { resource: "post_game", data: match },
      bodyDigest: crypto.randomUUID(),
      disposition: "ACCEPTED",
    },
  });
  await prisma.scoutClientCanonicalMatch.create({
    data: {
      riotMatchId: match.metadata.matchId,
      sourceObservationId: observation.observationId,
      payloadDigest: observation.bodyDigest,
      selectedAt: new Date(),
    },
  });
  return match.metadata.matchId;
}

beforeEach(async () => {
  await prisma.scoutClientCanonicalMatch.deleteMany();
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recentClientRounds", () => {
  test("counts the matches the player's own client supplied", async () => {
    const deviceId = await createTestScoutClientDevice(prisma, OWNER);
    const matchId = await selectFromClientOf(deviceId, SELF, 9_100_000_001);

    const rounds = await recentClientRounds(
      [{ puuid: SELF, region: "AMERICA_NORTH" }],
      20,
    );

    expect(rounds.map((round) => round.matchId)).toEqual([matchId]);
    expect(rounds[0]?.region).toBe("AMERICA_NORTH");
  });

  test("ignores matches someone else's client supplied", async () => {
    // A teammate's client can't put games into this player's suggestions,
    // even when the player appears in them.
    const deviceId = await createTestScoutClientDevice(prisma, OWNER);
    await selectFromClientOf(deviceId, TEAMMATE, 9_100_000_002);

    await expect(
      recentClientRounds([{ puuid: SELF, region: "AMERICA_NORTH" }], 20),
    ).resolves.toEqual([]);
  });
});
