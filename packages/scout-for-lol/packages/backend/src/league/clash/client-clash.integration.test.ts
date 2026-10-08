import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema, LeaguePuuidSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";

const { prisma } = createTestDatabase("client-clash");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const { loadClashChrome } = await import("#src/league/clash/chrome.ts");
const { readClientClashTeams } =
  await import("#src/league/clash/client-clash.ts");

const OWNER = DiscordAccountIdSchema.parse("160509172704739328");
const PLAYER = LeaguePuuidSchema.parse("p".repeat(78));
const OPPONENT = LeaguePuuidSchema.parse("o".repeat(78));
const ROSTER = "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e";
const HOUR_MS = 60 * 60 * 1000;

let sequence = 0n;

/** One Clash payload as the client stores it, kept as the player's snapshot. */
async function seedSnapshot(
  resource: "clash_roster" | "clash_bracket",
  data: unknown,
  capturedAt: Date,
): Promise<void> {
  const deviceId = await createTestScoutClientDevice(prisma, OWNER);
  sequence += 1n;
  const observation = await prisma.scoutClientObservation.create({
    data: {
      observationId: crypto.randomUUID(),
      deviceId,
      sequence,
      capturedAt,
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: "clash",
      localPuuid: PLAYER,
      payload: { resource, data },
      bodyDigest: crypto.randomUUID(),
      disposition: "ACCEPTED",
    },
  });
  await prisma.scoutClientPlayerSnapshot.create({
    data: {
      localPuuid: PLAYER,
      resource,
      kind: "clash",
      observationId: observation.observationId,
      capturedAt,
    },
  });
}

async function seedWeekend(capturedAt: Date): Promise<void> {
  await seedSnapshot(
    "clash_roster",
    {
      id: ROSTER,
      name: "Baron Hunters",
      shortName: "BH",
      members: [{ puuid: PLAYER, position: "MID" }],
    },
    capturedAt,
  );
  await seedSnapshot(
    "clash_bracket",
    {
      rosters: [{ rosterId: "r2", name: "Dragon Pit", shortName: "DP" }],
      matches: [{ roundId: 1, rosterId1: ROSTER, rosterId2: "r2" }],
    },
    capturedAt,
  );
}

beforeEach(async () => {
  await prisma.scoutClientPlayerSnapshot.deleteMany();
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.clashRegistration.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Clash from the Scout Client", () => {
  test("names both sides of a lobby Riot has no registration for", async () => {
    await seedWeekend(new Date(Date.now() - HOUR_MS));

    await expect(
      loadClashChrome({
        queueType: "clash",
        participants: [
          { puuid: PLAYER, team: "red" },
          { puuid: OPPONENT, team: "blue" },
        ],
      }),
    ).resolves.toEqual({
      redTeam: { name: "Baron Hunters", abbreviation: "BH" },
      blueTeam: { name: "Dragon Pit", abbreviation: "DP" },
    });
  });

  test("forgets a roster from a past weekend", async () => {
    await seedWeekend(new Date(Date.now() - 4 * 24 * HOUR_MS));

    await expect(readClientClashTeams([PLAYER], new Date())).resolves.toEqual(
      [],
    );
  });
});
