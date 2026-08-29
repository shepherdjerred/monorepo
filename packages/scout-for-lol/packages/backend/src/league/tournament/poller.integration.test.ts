import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { RawLobbyEvent } from "@scout-for-lol/data/index.ts";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";

const { prisma: testPrisma } = createTestDatabase("tournament-poller");

let lobbyEvents: RawLobbyEvent[] | undefined = [];
let lobbyEventCalls = 0;
let prematchSends = 0;
let activeGameUpserts: string[] = [];

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma: testPrisma,
}));

vi.doMock("#src/league/api/tournament/client.ts", () => ({
  getLobbyEvents: () => {
    lobbyEventCalls += 1;
    return Promise.resolve(lobbyEvents);
  },
  getGamesByCode: () =>
    Promise.resolve([
      {
        startTime: 1,
        winningTeam: [],
        losingTeam: [],
        shortCode: "TEST-CODE",
        gameId: 5_421_167_767,
        gameName: "game",
        gameType: "Practice",
        gameMap: 11,
        gameMode: "CLASSIC",
        region: "NA",
      },
    ]),
}));

vi.doMock("#src/league/tournament/prematch-delivery.ts", () => ({
  deliverLobbyPrematch: () => {
    prematchSends += 1;
    return Promise.resolve({ "channel-1": "message-1" });
  },
}));

vi.doMock("#src/league/tasks/prematch/active-game-queries.ts", () => ({
  upsertActiveGame: (matchId: string) => {
    activeGameUpserts.push(matchId);
    return Promise.resolve();
  },
  recordPrematchMessageIds: () => Promise.resolve(),
}));

vi.doMock("#src/config/dynamic.ts", () => ({
  tournamentApiMode: () => "live",
  tournamentMaxOpenLobbies: () => 10,
}));

const { checkTournamentLobbies } =
  await import("#src/league/tournament/poller.ts");
const { createLobby, findLobbyByCode } =
  await import("#src/league/tournament/lobby-store.ts");

function event(eventType: string, puuid = "player-one"): RawLobbyEvent {
  return { timestamp: "1", eventType, puuid };
}

async function seedLobby() {
  return createLobby(testPrisma, {
    code: "TEST-CODE",
    apiMode: "live",
    providerId: 1,
    tournamentId: 2,
    region: "AMERICA_NORTH",
    platformId: "NA1",
    serverId: DiscordGuildIdSchema.parse("1337623164146155593"),
    channelId: DiscordChannelIdSchema.parse("1337623164146155594"),
    creatorDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
    bluePuuids: ["blue-one"],
    redPuuids: ["red-one"],
    blueAliases: ["Blue One"],
    redAliases: ["Red One"],
    teamSize: 1,
    pickType: "TOURNAMENT_DRAFT",
    mapType: "SUMMONERS_RIFT",
    spectatorType: "ALL",
    lobbyName: "lobby",
    password: "hunter2",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

beforeEach(async () => {
  await deleteIfExists(() => testPrisma.tournamentLobby.deleteMany());
  lobbyEvents = [];
  lobbyEventCalls = 0;
  prematchSends = 0;
  activeGameUpserts = [];
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("checkTournamentLobbies", () => {
  test("a quiet lobby stays put and announces nothing", async () => {
    await seedLobby();

    await checkTournamentLobbies();

    expect(prematchSends).toBe(0);
    const lobby = await findLobbyByCode(testPrisma, "TEST-CODE");
    expect(lobby?.state).toBe("created");
  });

  test("champ select announces exactly once, no matter how often we poll", async () => {
    // The property the whole feature rests on, exercised through the real
    // store: lobby-events replays its entire list every call, so a second tick
    // sees the same champ-select event and must not send a second card.
    await seedLobby();
    lobbyEvents = [
      event("PracticeGameCreatedEvent"),
      event("ChampSelectStartedEvent"),
    ];

    await checkTournamentLobbies();
    await checkTournamentLobbies();
    await checkTournamentLobbies();

    expect(prematchSends).toBe(1);
  });

  test("a started game is linked to its match id", async () => {
    await seedLobby();
    lobbyEvents = [
      event("PracticeGameCreatedEvent"),
      event("ChampSelectStartedEvent"),
      event("GameAllocatedToLsmEvent"),
    ];

    await checkTournamentLobbies();

    const lobby = await findLobbyByCode(testPrisma, "TEST-CODE");
    expect(lobby?.state).toBe("resolved");
    expect(lobby?.matchId).toBe("NA1_5421167767");
    // Linkage only — the poller writes the ActiveGame row so the post-match
    // report can reply, and never ingests the match itself.
    expect(activeGameUpserts).toEqual(["NA1_5421167767"]);
  });

  test("a failed poll leaves the lobby untouched", async () => {
    await seedLobby();
    lobbyEvents = undefined;

    await checkTournamentLobbies();

    const lobby = await findLobbyByCode(testPrisma, "TEST-CODE");
    expect(lobby?.state).toBe("created");
    expect(prematchSends).toBe(0);
  });

  test("membership is replayed onto the row", async () => {
    await seedLobby();
    lobbyEvents = [
      event("PlayerJoinedGameEvent", "blue-one"),
      event("PlayerJoinedGameEvent", "red-one"),
      event("PlayerQuitGameEvent", "red-one"),
    ];

    await checkTournamentLobbies();

    const polled = await findLobbyByCode(testPrisma, "TEST-CODE");
    expect(polled?.joinedPuuids).toEqual(["blue-one"]);
  });

  test("an expired lobby nobody played is abandoned", async () => {
    const lobby = await seedLobby();
    await testPrisma.tournamentLobby.update({
      where: { id: lobby.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await checkTournamentLobbies();

    const swept = await findLobbyByCode(testPrisma, "TEST-CODE");
    expect(swept?.state).toBe("abandoned");
  });

  test("a terminal lobby is never polled again", async () => {
    const lobby = await seedLobby();
    await testPrisma.tournamentLobby.update({
      where: { id: lobby.id },
      data: { state: "cancelled" },
    });
    lobbyEvents = [event("ChampSelectStartedEvent")];

    await checkTournamentLobbies();

    expect(prematchSends).toBe(0);
    const untouched = await findLobbyByCode(testPrisma, "TEST-CODE");
    expect(untouched?.state).toBe("cancelled");
  });

  test("a resolved lobby waits for Match-V5 without another Tournament call", async () => {
    const lobby = await seedLobby();
    await testPrisma.tournamentLobby.update({
      where: { id: lobby.id },
      data: { state: "resolved", matchId: "NA1_5421167767" },
    });

    await checkTournamentLobbies();

    expect(lobbyEventCalls).toBe(0);
    const waiting = await findLobbyByCode(testPrisma, "TEST-CODE");
    expect(waiting?.state).toBe("resolved");
  });

  test("an expired resolved lobby is swept without a Tournament call", async () => {
    const lobby = await seedLobby();
    await testPrisma.tournamentLobby.update({
      where: { id: lobby.id },
      data: {
        state: "resolved",
        matchId: "NA1_5421167767",
        expiresAt: new Date(Date.now() - 1),
      },
    });

    await checkTournamentLobbies();

    expect(lobbyEventCalls).toBe(0);
    const expired = await findLobbyByCode(testPrisma, "TEST-CODE");
    expect(expired?.state).toBe("expired");
  });
});
