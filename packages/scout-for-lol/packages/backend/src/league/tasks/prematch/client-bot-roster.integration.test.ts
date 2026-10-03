import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  RawCurrentGameInfoSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("client-bot-roster");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const { clientRosterCompletion, readClientObservedBots } =
  await import("#src/league/tasks/prematch/client-bot-roster.ts");

const GAME_ID = "5653248720";
const PARTY_ID = "e5028813-c00d-4a6d-add9-38c86304fca2";
const TRACKED = "tracked-puuid";
const STRANGER = "stranger-puuid";
const OWNER_ID = DiscordAccountIdSchema.parse("160509172704739328");

let deviceId = "";
let sequence = 0n;

function bot(championId: number, position: string) {
  return {
    isBot: true,
    botChampionId: championId,
    botPosition: position,
    puuid: "",
    teamId: 0,
  };
}

/** A lobby as the client stores it: `{ resource, data }` around the LCU body. */
function lobbyPayload(
  customTeam100: readonly ReturnType<typeof bot>[],
  customTeam200: readonly ReturnType<typeof bot>[],
) {
  return {
    resource: "lobby",
    data: { partyId: PARTY_ID, gameConfig: { customTeam100, customTeam200 } },
  };
}

const inProgressSession = {
  resource: "gameflow_session",
  data: { phase: "InProgress" },
};

/** Riot's view of a 1-human bot custom: the human, and none of the bots. */
function spectatorGame(gameLength: number) {
  return RawCurrentGameInfoSchema.parse({
    gameId: Number(GAME_ID),
    gameStartTime: Date.now(),
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "CUSTOM_GAME",
    gameQueueConfigId: 3100,
    gameLength,
    platformId: "NA1",
    bannedChampions: [],
    participants: [
      {
        championId: 893,
        puuid: TRACKED,
        teamId: 100,
        riotId: "sjerred#sjerr",
        spell1Id: 4,
        spell2Id: 14,
        lastSelectedSkinIndex: 0,
        bot: false,
        profileIconId: 29,
      },
    ],
  });
}

async function observe(input: {
  kind: string;
  payload: ReturnType<typeof lobbyPayload> | typeof inProgressSession;
  gameId?: string;
  lobbyId?: string;
  localPuuid?: string;
  disposition?: string;
  capturedAt?: Date;
}): Promise<void> {
  sequence += 1n;
  await prisma.scoutClientObservation.create({
    data: {
      observationId: crypto.randomUUID(),
      deviceId,
      sequence,
      capturedAt: input.capturedAt ?? new Date(),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: input.kind,
      localPuuid: input.localPuuid ?? TRACKED,
      lobbyId: input.lobbyId ?? null,
      gameId: input.gameId ?? null,
      payload: input.payload,
      bodyDigest: crypto.randomUUID(),
      disposition: input.disposition ?? "ACCEPTED",
      // The database requires a quarantined row to say why.
      quarantineReason:
        input.disposition === "QUARANTINED" ? "unverified_local_puuid" : null,
    },
  });
}

/**
 * The in-game observation the client stamps with the lobby it came from.
 *
 * A minute in the future, because the client only ever sends it after the
 * lobby it names: the join is recorded when the game starts.
 */
async function observeJoinedGame(
  overrides: { localPuuid?: string; disposition?: string } = {},
): Promise<void> {
  await observe({
    kind: "gameflow",
    payload: inProgressSession,
    gameId: GAME_ID,
    lobbyId: PARTY_ID,
    capturedAt: new Date(Date.now() + 60_000),
    ...overrides,
  });
}

beforeEach(async () => {
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.user.deleteMany();
  const device = await prisma.scoutClientDevice.create({
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
          expiresAt: new Date(Date.now() + 60_000),
        },
      },
      tokenDigest: crypto.randomUUID(),
      deviceName: "desktop",
      platform: "windows",
      architecture: "x86_64",
      appVersion: "0.1.0",
      protocolVersion: 1,
    },
  });
  deviceId = device.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("readClientObservedBots", () => {
  test("follows the game's lobby identity to the roster the lobby held", async () => {
    await observeJoinedGame();
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([bot(875, "TOP")], [bot(42, "MIDDLE")]),
    });

    expect(await readClientObservedBots(GAME_ID, new Set([TRACKED]))).toEqual([
      { side: "blue", championId: 875, lane: "top" },
      { side: "red", championId: 42, lane: "middle" },
    ]);
  });

  test("reads the lobby as it last stood, after every bot was added", async () => {
    await observeJoinedGame();
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([], []),
      capturedAt: new Date(Date.now() - 60_000),
    });
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([], [bot(42, "MIDDLE")]),
    });

    expect(await readClientObservedBots(GAME_ID, new Set([TRACKED]))).toEqual([
      { side: "red", championId: 42, lane: "middle" },
    ]);
  });

  test("does not read the party's next lobby back into this game", async () => {
    // A party that stays together keeps its partyId, so the lobby for its
    // next game arrives under the same identity after this one started.
    const start = Date.now();
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([bot(875, "TOP")], [bot(42, "MIDDLE")]),
      capturedAt: new Date(start - 60_000),
    });
    await observe({
      kind: "gameflow",
      payload: inProgressSession,
      gameId: GAME_ID,
      lobbyId: PARTY_ID,
      capturedAt: new Date(start),
    });
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([], [bot(22, "UTILITY")]),
      capturedAt: new Date(start + 30 * 60_000),
    });

    expect(await readClientObservedBots(GAME_ID, new Set([TRACKED]))).toEqual([
      { side: "blue", championId: 875, lane: "top" },
      { side: "red", championId: 42, lane: "middle" },
    ]);
  });

  test("ignores a roster no tracked player's client reported", async () => {
    await observeJoinedGame({ localPuuid: STRANGER });
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      localPuuid: STRANGER,
      payload: lobbyPayload([], [bot(42, "MIDDLE")]),
    });

    expect(await readClientObservedBots(GAME_ID, new Set([TRACKED]))).toEqual(
      [],
    );
  });

  test("ignores observations ingress did not accept", async () => {
    await observeJoinedGame({ disposition: "QUARANTINED" });
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([], [bot(42, "MIDDLE")]),
    });

    expect(await readClientObservedBots(GAME_ID, new Set([TRACKED]))).toEqual(
      [],
    );
  });

  test("finds nothing when the client never tied the game to a lobby", async () => {
    // A client started mid-game records no join, and LCU's in-game session
    // names no lobby of its own.
    await observe({
      kind: "gameflow",
      payload: inProgressSession,
      gameId: GAME_ID,
    });
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([], [bot(42, "MIDDLE")]),
    });

    expect(await readClientObservedBots(GAME_ID, new Set([TRACKED]))).toEqual(
      [],
    );
  });
});

describe("clientRosterCompletion", () => {
  test("finishes a started game's roster with the client's bots", async () => {
    await observeJoinedGame();
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([bot(875, "TOP")], [bot(42, "MIDDLE")]),
    });

    expect(
      await clientRosterCompletion(spectatorGame(30), new Set([TRACKED])),
    ).toHaveLength(2);
  });

  test("keeps deferring while the lobby may still be loading in", async () => {
    // A negative gameLength is the loading screen: a short roster then is the
    // ordinary case of players still connecting, not a bot game.
    await observeJoinedGame();
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([], [bot(42, "MIDDLE")]),
    });

    expect(
      await clientRosterCompletion(spectatorGame(-20), new Set([TRACKED])),
    ).toBeNull();
  });

  test("keeps deferring when the bots still leave a side empty", async () => {
    await observeJoinedGame();
    await observe({
      kind: "lobby",
      lobbyId: PARTY_ID,
      payload: lobbyPayload([bot(875, "TOP")], []),
    });

    expect(
      await clientRosterCompletion(spectatorGame(30), new Set([TRACKED])),
    ).toBeNull();
  });
});
