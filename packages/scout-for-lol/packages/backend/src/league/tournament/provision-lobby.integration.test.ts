import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RegionSchema,
} from "@scout-for-lol/data/index.ts";
import type { createTournamentCodes } from "#src/league/api/tournament/client.ts";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  completeTournamentLobbyForMatch,
  updateLobby,
} from "#src/league/tournament/lobby-store.ts";
import {
  PROVISION_PENDING_TTL_MS,
  provisionTournamentLobby,
  type ProvisionTournamentLobbyInput,
} from "#src/league/tournament/provision-lobby.ts";

const { prisma: testPrisma } = createTestDatabase("tournament-provisioning");
const NOW = new Date("2026-08-29T12:00:00.000Z");
let codeRequests = 0;

const createTestCode: typeof createTournamentCodes = () => {
  codeRequests += 1;
  return Promise.resolve(["TEST-CODE"]);
};

const failAfterSend: typeof createTournamentCodes = () => {
  codeRequests += 1;
  return Promise.reject(new Error("connection reset after send"));
};

const stopFirstProcess: typeof createTournamentCodes = () =>
  Promise.reject(new Error("first process stopped"));

const createSecondCode: typeof createTournamentCodes = () => {
  codeRequests += 1;
  return Promise.resolve(["SECOND-CODE"]);
};

const BASE_INPUT: ProvisionTournamentLobbyInput = {
  requestId: "discord:interaction-1",
  mode: "live",
  serverId: DiscordGuildIdSchema.parse("1337623164146155593"),
  channelId: DiscordChannelIdSchema.parse("1337623164146155594"),
  creatorDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
  blue: {
    aliases: ["Blue One"],
    puuids: ["blue-puuid"],
    region: RegionSchema.parse("AMERICA_NORTH"),
  },
  red: {
    aliases: ["Red One"],
    puuids: ["red-puuid"],
    region: RegionSchema.parse("AMERICA_NORTH"),
  },
  pickType: "TOURNAMENT_DRAFT",
  mapType: "SUMMONERS_RIFT",
  spectatorType: "ALL",
};

async function seedRegistration(): Promise<void> {
  await testPrisma.tournamentRegistration.create({
    data: {
      apiMode: "live",
      tournamentRegion: "NA",
      providerId: 10,
      tournamentId: 20,
      callbackUrl: "https://example.com/callback",
      name: "test",
    },
  });
}

beforeEach(async () => {
  codeRequests = 0;
  await deleteIfExists(() => testPrisma.tournamentLobbyProvision.deleteMany());
  await deleteIfExists(() => testPrisma.tournamentLobby.deleteMany());
  await deleteIfExists(() => testPrisma.tournamentRegistration.deleteMany());
  await seedRegistration();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("provisionTournamentLobby", () => {
  test("returns the durable lobby on an idempotent completed retry", async () => {
    const dependencies = { createCodes: createTestCode, now: () => NOW };

    const first = await provisionTournamentLobby(
      testPrisma,
      BASE_INPUT,
      dependencies,
    );
    const retried = await provisionTournamentLobby(
      testPrisma,
      BASE_INPUT,
      dependencies,
    );

    expect(retried.id).toBe(first.id);
    expect(retried.code).toBe("TEST-CODE");
    expect(codeRequests).toBe(1);
  });

  test("refuses to reuse an idempotency key for different inputs", async () => {
    const dependencies = { createCodes: createTestCode, now: () => NOW };
    await provisionTournamentLobby(testPrisma, BASE_INPUT, dependencies);

    await expect(
      provisionTournamentLobby(
        testPrisma,
        { ...BASE_INPUT, mapType: "HOWLING_ABYSS" },
        dependencies,
      ),
    ).rejects.toThrow("reused with different lobby inputs");
  });

  test("never retries an ambiguous Riot response", async () => {
    const dependencies = { createCodes: failAfterSend, now: () => NOW };

    await expect(
      provisionTournamentLobby(testPrisma, BASE_INPUT, dependencies),
    ).rejects.toThrow("connection reset after send");
    await expect(
      provisionTournamentLobby(testPrisma, BASE_INPUT, dependencies),
    ).rejects.toThrow("ambiguous Riot outcome");

    expect(codeRequests).toBe(1);
    await expect(
      testPrisma.tournamentLobbyProvision.findUniqueOrThrow({
        where: { id: BASE_INPUT.requestId },
      }),
    ).resolves.toMatchObject({ state: "AMBIGUOUS" });
  });

  test("blocks an equivalent slash-command retry with a new interaction ID", async () => {
    const dependencies = { createCodes: failAfterSend, now: () => NOW };

    await expect(
      provisionTournamentLobby(testPrisma, BASE_INPUT, dependencies),
    ).rejects.toThrow("connection reset after send");
    await expect(
      provisionTournamentLobby(
        testPrisma,
        { ...BASE_INPUT, requestId: "discord:interaction-2" },
        dependencies,
      ),
    ).rejects.toThrow("ambiguous Riot outcome");

    expect(codeRequests).toBe(1);
  });

  test("turns a stale pending claim into an ambiguous recovery case", async () => {
    await expect(
      provisionTournamentLobby(testPrisma, BASE_INPUT, {
        createCodes: stopFirstProcess,
        now: () => new Date(NOW.getTime() - PROVISION_PENDING_TTL_MS - 2),
      }),
    ).rejects.toThrow("first process stopped");
    await testPrisma.tournamentLobbyProvision.update({
      where: { id: BASE_INPUT.requestId },
      data: {
        state: "PENDING",
        claimedAt: new Date(NOW.getTime() - PROVISION_PENDING_TTL_MS - 1),
      },
    });

    await expect(
      provisionTournamentLobby(testPrisma, BASE_INPUT, {
        createCodes: createSecondCode,
        now: () => NOW,
      }),
    ).rejects.toThrow("expired with an ambiguous Riot outcome");
    expect(codeRequests).toBe(0);
  });

  test("marks a resolved lobby reported idempotently", async () => {
    const lobby = await provisionTournamentLobby(testPrisma, BASE_INPUT, {
      createCodes: createTestCode,
      now: () => NOW,
    });
    await updateLobby(testPrisma, lobby.id, {
      state: "resolved",
      matchId: "NA1_123",
    });

    await expect(
      completeTournamentLobbyForMatch(testPrisma, "NA1_123", "TEST-CODE"),
    ).resolves.toBe(1);
    await expect(
      completeTournamentLobbyForMatch(testPrisma, "NA1_123", "TEST-CODE"),
    ).resolves.toBe(0);
  });

  test("reports a lobby when Match-V5 wins the linkage race", async () => {
    const lobby = await provisionTournamentLobby(testPrisma, BASE_INPUT, {
      createCodes: createTestCode,
      now: () => NOW,
    });

    await expect(
      completeTournamentLobbyForMatch(testPrisma, "NA1_456", lobby.code),
    ).resolves.toBe(1);
    await expect(
      testPrisma.tournamentLobby.findUniqueOrThrow({ where: { id: lobby.id } }),
    ).resolves.toMatchObject({ matchId: "NA1_456", state: "reported" });
  });

  test("recovers an expired resolved lobby when Match-V5 arrives", async () => {
    const lobby = await provisionTournamentLobby(testPrisma, BASE_INPUT, {
      createCodes: createTestCode,
      now: () => NOW,
    });
    await updateLobby(testPrisma, lobby.id, { state: "expired" });

    await expect(
      completeTournamentLobbyForMatch(testPrisma, "NA1_789", lobby.code),
    ).resolves.toBe(1);
    await expect(
      testPrisma.tournamentLobby.findUniqueOrThrow({ where: { id: lobby.id } }),
    ).resolves.toMatchObject({ matchId: "NA1_789", state: "reported" });
  });
});
