import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema, LeaguePuuidSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import { z } from "zod";

const { prisma } = createTestDatabase("client-clash");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const { loadClashChrome } = await import("#src/league/clash/chrome.ts");
const { readClientClashTeams } =
  await import("#src/league/clash/client-clash.ts");
const { projectClashEntity } =
  await import("#src/scout-client/clash-entities.ts");
const { ScoutClientObservationSchema } = await import("@scout-for-lol/data");

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
  await prisma.scoutClientClashEntity.deleteMany();
  await prisma.clashGameSighting.deleteMany();
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

  test("retains multiple cups and opponent entities without crossing platforms or tournaments", async () => {
    const deviceId = await createTestScoutClientDevice(prisma, OWNER);
    const old = new Date(Date.now() - 14 * 24 * HOUR_MS);
    async function observe(
      resource: string,
      data: unknown,
      platformId = "NA1",
      capturedAt = old,
    ) {
      sequence += 1n;
      const observation = ScoutClientObservationSchema.parse({
        observationId: crypto.randomUUID(),
        sequence: Number(sequence),
        protocolVersion: 1,
        schemaVersion: 1,
        appVersion: "0.1.0",
        kind: "clash",
        localPuuid: PLAYER,
        platformId,
        capturedAt: capturedAt.toISOString(),
        payload: { resource, data },
      });
      await prisma.scoutClientObservation.create({
        data: {
          observationId: observation.observationId,
          deviceId,
          sequence,
          capturedAt,
          protocolVersion: 1,
          schemaVersion: 1,
          appVersion: "0.1.0",
          kind: "clash",
          localPuuid: PLAYER,
          platformId,
          payload: { resource, data: z.json().parse(data) },
          bodyDigest: crypto.randomUUID(),
          disposition: "ACCEPTED",
        },
      });
      await projectClashEntity(observation);
    }
    await observe("clash_roster", {
      id: ROSTER,
      tournamentId: "101",
      bracketId: "201",
      name: "Old cup",
      members: [{ puuid: PLAYER }],
    });
    await observe("clash_roster:r2", {
      id: "r2",
      tournamentId: "101",
      name: "Observed opponent",
    });
    await observe("clash_bracket:201", {
      id: "201",
      tournamentId: "101",
      matches: [
        {
          roundId: 1,
          rosterId1: ROSTER,
          rosterId2: "r2",
          winnerId: ROSTER,
          gameId: "123",
        },
      ],
    });
    await observe(
      "clash_roster",
      {
        id: ROSTER,
        tournamentId: "102",
        bracketId: "202",
        name: "New cup",
        members: [{ puuid: PLAYER }],
      },
      "NA1",
      new Date(),
    );
    await observe(
      "clash_bracket:202",
      {
        id: "202",
        tournamentId: "102",
        matches: [
          {
            roundId: 1,
            rosterId1: ROSTER,
            winnerId: "unrelated",
            gameId: "124",
          },
        ],
      },
      "NA1",
      new Date(),
    );
    await observe(
      "clash_bracket:201",
      {
        id: "201",
        tournamentId: "101",
        matches: [{ rosterId1: ROSTER, rosterId2: "r2", winnerId: "r2" }],
      },
      "EUW1",
      new Date(),
    );
    const history = await readClientClashTeams([PLAYER], new Date(), true);
    expect(history).toHaveLength(2);
    expect(
      history.find((team) => team.tournamentId === "101")?.matches[0],
    ).toMatchObject({
      result: "won",
      opponent: { kind: "team", name: "Observed opponent" },
      gameIds: ["123"],
    });
    expect(
      history.find((team) => team.tournamentId === "102")?.matches[0],
    ).toMatchObject({ result: "pending", opponent: { kind: "unknown" } });
    expect(await readClientClashTeams([OPPONENT], new Date(), true)).toEqual(
      [],
    );
    expect(await readClientClashTeams([PLAYER], new Date())).toHaveLength(1);
    await prisma.clashGameSighting.create({
      data: {
        platform: "NA1",
        gameId: "124",
        puuid: PLAYER,
        source: "match",
        resultSource: "RIOT",
        queue: "clash",
        championId: 1,
        teamId: 100,
        observedAt: new Date(),
        win: false,
      },
    });
    const enriched = await readClientClashTeams([PLAYER], new Date(), true);
    expect(
      enriched.find((team) => team.tournamentId === "102")?.matches[0]?.result,
    ).toBe("lost");
    await observe(
      "clash_roster",
      { id: ROSTER, name: "Unknown older cup", members: [{ puuid: PLAYER }] },
      "NA1",
      new Date(Date.now() - 60 * 24 * HOUR_MS),
    );
    await observe(
      "clash_roster",
      { id: ROSTER, name: "Unknown newer cup", members: [{ puuid: PLAYER }] },
      "NA1",
      new Date(Date.now() - 30 * 24 * HOUR_MS),
    );
    const retained = await readClientClashTeams([PLAYER], new Date(), true);
    expect(retained).toHaveLength(4);
    expect(
      retained
        .filter((team) => team.tournamentId === null)
        .map((team) => team.name),
    ).toEqual(["Unknown newer cup", "Unknown older cup"]);
  });
});
