import { afterAll, beforeEach, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  ScoutClientObservationSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import { z } from "zod";
import { resetConfigurationForTests } from "#src/configuration.ts";

const { prisma } = createTestDatabase("client-data-recovery");
vi.doMock("#src/database/index.ts", async (original) => ({
  ...(await original()),
  prisma,
}));
vi.doMock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isPolicyEnabled: () => Promise.resolve(true),
}));
const dispatch = vi.fn(() => Promise.resolve());
const spectator = vi.fn(() => Promise.resolve({ kind: "not-in-game" }));
vi.doMock("#src/league/api/spectator.ts", () => ({ getActiveGame: spectator }));
vi.doMock("#src/scout-client/ingress.ts", async (original) => ({
  ...(await original()),
  startAcceptedClientMatches: dispatch,
}));
const { reconcileAcceptedClientEvidence } = await import("./reconciliation.ts");
const { readClientGameResults, projectClientGameResult } =
  await import("./game-results.ts");
const { admitMatchEvidence, matchEffectsAllowed } =
  await import("#src/evidence/admission.ts");
const { upsertClashGameSighting } =
  await import("#src/league/clash/sighting.ts");
const { readClashHistoryForGuild } =
  await import("#src/league/clash/history.ts");
const { readClientPrematch } = await import("./prematch-evidence.ts");
const { resolvePrematch: getActiveGameWithClientEvidence } =
  await import("#src/evidence/prematch.ts");

const OWNER = DiscordAccountIdSchema.parse("160509172704739328");
const OTHER = DiscordAccountIdSchema.parse("160509172704739329");
const GUILD = DiscordGuildIdSchema.parse("1337623164146155593");
const PLAYER = LeaguePuuidSchema.parse("p".repeat(78));
let deviceId: string;
let sequence = 0;

beforeEach(async () => {
  await prisma.matchEvidenceAdmission.deleteMany();
  await prisma.scoutClientClashEntity.deleteMany();
  await prisma.scoutClientGameResult.deleteMany();
  await prisma.leagueIdentityAlias.deleteMany();
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.user.deleteMany();
  await prisma.clashGameSighting.deleteMany();
  const now = new Date();
  await prisma.player.create({
    data: {
      alias: "owner",
      discordId: OWNER,
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: {
          alias: "owner",
          puuid: PLAYER,
          region: "AMERICA_NORTH",
          serverId: GUILD,
          creatorDiscordId: OWNER,
          createdTime: now,
          updatedTime: now,
        },
      },
    },
  });
  deviceId = await createTestScoutClientDevice(prisma, OWNER, {
    appVersion: "0.1.0",
  });
  dispatch.mockClear();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function observe(
  kind: "post_game" | "gameflow",
  payload: unknown,
  options: { platformId?: string; capturedAt?: Date } = {},
) {
  sequence += 1;
  const observation = ScoutClientObservationSchema.parse({
    observationId: crypto.randomUUID(),
    sequence,
    capturedAt: (options.capturedAt ?? new Date()).toISOString(),
    protocolVersion: 1,
    schemaVersion: 1,
    appVersion: "0.1.0",
    kind,
    localPuuid: PLAYER,
    gameId: "7101",
    ...(options.platformId === undefined
      ? {}
      : { platformId: options.platformId }),
    payload,
  });
  await prisma.scoutClientObservation.create({
    data: {
      observationId: observation.observationId,
      deviceId,
      sequence: BigInt(sequence),
      capturedAt: new Date(observation.capturedAt),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind,
      localPuuid: PLAYER,
      gameId: "7101",
      platformId: options.platformId ?? null,
      payload: z
        .object({ resource: z.string(), data: z.json() })
        .parse(payload),
      bodyDigest: "immutable-digest",
      disposition: "ACCEPTED",
    },
  });
  return observation;
}

function historyGame(gameCreation = Date.now() - 1_800_000) {
  return {
    gameId: 7101,
    platformId: "NA1",
    gameCreation,
    gameDuration: 1800,
    queueId: 700,
    gameMode: "CLASSIC",
    gameType: "MATCHED_GAME",
    participants: [
      {
        participantId: 1,
        teamId: 100,
        championId: 1,
        stats: { win: true, kills: 0 },
      },
      { participantId: 2, teamId: 200, championId: 2, stats: { win: false } },
    ],
    participantIdentities: [
      { participantId: 1, player: { puuid: PLAYER } },
      {
        participantId: 2,
        player: { puuid: "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e" },
      },
    ],
  };
}

test.each(["post_game", "match_history_game:7101", "post_game_timeline"])(
  "future completion in %s cannot seed permanent live admission",
  async (resource) => {
    const observation = await observe(
      "post_game",
      { resource, data: { matchHistory: historyGame(Date.now() + 3_600_000) } },
      { platformId: "NA1" },
    );
    await projectClientGameResult(observation);
    expect(await prisma.matchEvidenceAdmission.count()).toBe(0);
    expect(await prisma.scoutClientGameResult.count()).toBe(0);
    expect(await prisma.matchResultEvidence.count()).toBe(0);
    expect(await prisma.scoutClientObservation.count()).toBe(1);
    const matchId = RiotMatchIdSchema.parse("NA1_7101");
    expect(
      await admitMatchEvidence({
        matchId,
        completedAt: Date.now() - 1_800_000,
        historical: true,
        riotHistoryListed: true,
      }),
    ).toBe("HISTORY_ONLY");
    expect(await matchEffectsAllowed(matchId)).toBe(false);
  },
);

test.each([
  { resource: "post_game_timeline", capturedAgo: 0, policy: "HISTORY_ONLY" },
  { resource: "post_game", capturedAgo: 901_000, policy: "HISTORY_ONLY" },
  { resource: "post_game", capturedAgo: 0, policy: "FULL" },
])(
  "$resource captured $capturedAgo ms ago follows dispatch eligibility",
  async ({ resource, capturedAgo, policy }) => {
    const now = Date.now();
    const observation = await observe(
      "post_game",
      { resource, data: { matchHistory: historyGame(now - 1_800_000) } },
      { platformId: "NA1", capturedAt: new Date(now - capturedAgo) },
    );
    await projectClientGameResult(observation);
    const matchId = RiotMatchIdSchema.parse("NA1_7101");
    expect(
      await prisma.matchEvidenceAdmission.findUnique({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject({ policy });
    expect(await prisma.scoutClientGameResult.count()).toBe(1);
    expect(await matchEffectsAllowed(matchId)).toBe(policy === "FULL");
  },
);

test("reprojects an accepted full history without EOG, timing, timeline or opponent aliases", async () => {
  const history = historyGame();
  const observation = await observe("post_game", {
    resource: "match_history_game:7101",
    data: { matchHistory: history },
  });
  expect(await reconcileAcceptedClientEvidence()).toBe(1);
  const { results } = await readClientGameResults(OWNER, 20);
  expect(results[0]?.participants[0]).toMatchObject({
    kills: 0,
    deaths: null,
    identity: { kind: "riot", puuid: PLAYER },
  });
  expect(results[0]?.participants[1]?.identity.kind).toBe("local");
  expect(await readClientGameResults(OTHER, 20)).toEqual({
    results: [],
    conflicts: [],
  });
  expect(await prisma.clashGameSighting.findMany()).toMatchObject([
    { source: "match", resultSource: "SCOUT_CLIENT", win: true },
  ]);
  expect(
    await prisma.scoutClientObservation.findUnique({
      where: { observationId: observation.observationId },
    }),
  ).toMatchObject({
    bodyDigest: "immutable-digest",
    platformId: "NA1",
    recoveryComplete: true,
  });
  expect(await reconcileAcceptedClientEvidence()).toBe(0);
  const discovery = await observe("post_game", {
    resource: "match_history_game:7101",
    data: { gameId: 7101, platformId: "NA1", participants: [] },
  });
  await reconcileAcceptedClientEvidence();
  expect(
    await prisma.scoutClientObservation.findUnique({
      where: { observationId: discovery.observationId },
    }),
  ).toMatchObject({ recoveryComplete: true });
  expect(
    await prisma.scoutClientGameResult.findUnique({
      where: { observationId: discovery.observationId },
    }),
  ).toBeNull();
  const conflicting = {
    ...history,
    participants: history.participants.map((player) => ({
      ...player,
      stats: { ...player.stats, win: !player.stats.win },
    })),
  };
  await observe("post_game", {
    resource: "match_history_game:7101",
    data: { matchHistory: conflicting },
  });
  await reconcileAcceptedClientEvidence();
  expect(await readClientGameResults(OWNER, 1)).toMatchObject({
    results: [],
    conflicts: [{ matchId: "NA1_7101" }],
  });
});

test("Riot result precedence holds under concurrent writes and late prematch", async () => {
  const base = {
    platform: "NA1",
    gameId: "7101",
    puuid: PLAYER,
    source: "match",
    queue: "clash",
    championId: 1,
    teamId: 100,
    observedAt: new Date(),
    win: true,
  } as const;
  await Promise.all([
    upsertClashGameSighting({ ...base, resultSource: "RIOT" }),
    upsertClashGameSighting({
      ...base,
      resultSource: "SCOUT_CLIENT",
      win: false,
    }),
  ]);
  await upsertClashGameSighting({ ...base, source: "prematch", win: null });
  expect(await prisma.clashGameSighting.findFirst()).toMatchObject({
    source: "match",
    resultSource: "RIOT",
    win: true,
  });
});

async function clashHistoryGameIds() {
  const cups = await readClashHistoryForGuild(GUILD);
  return cups
    .flatMap((cup) =>
      cup.players.flatMap((player) =>
        player.sightings.map((sighting) => sighting.gameId),
      ),
    )
    .sort();
}

test("production Clash history excludes stored client results while retaining Riot results", async () => {
  const base = {
    platform: "NA1",
    puuid: PLAYER,
    source: "match",
    queue: "clash",
    championId: 1,
    teamId: 100,
    observedAt: new Date(),
    win: true,
  } as const;
  await upsertClashGameSighting({
    ...base,
    gameId: "7101",
    resultSource: "SCOUT_CLIENT",
  });
  await upsertClashGameSighting({
    ...base,
    gameId: "7102",
    resultSource: "RIOT",
  });
  expect(await clashHistoryGameIds()).toEqual(["7101", "7102"]);
  const previousEnvironment = Bun.env["ENVIRONMENT"];
  Bun.env["ENVIRONMENT"] = "prod";
  resetConfigurationForTests();
  try {
    expect(await clashHistoryGameIds()).toEqual(["7102"]);
  } finally {
    if (previousEnvironment === undefined) delete Bun.env["ENVIRONMENT"];
    else Bun.env["ENVIRONMENT"] = previousEnvironment;
    resetConfigurationForTests();
  }
});

test("conflicting client results do not invent a Clash winner", async () => {
  const base = {
    platform: "NA1",
    gameId: "7101",
    puuid: PLAYER,
    source: "match",
    queue: "clash",
    championId: 1,
    teamId: 100,
    observedAt: new Date(),
    win: true,
    resultSource: "SCOUT_CLIENT",
  } as const;
  await Promise.all([
    upsertClashGameSighting(base),
    upsertClashGameSighting({ ...base, win: false }),
  ]);
  expect(await prisma.clashGameSighting.findFirst()).toMatchObject({
    resultSource: "SCOUT_CLIENT",
    resultConflict: true,
    win: null,
  });
  await upsertClashGameSighting({ ...base, resultSource: "RIOT" });
  expect(await prisma.clashGameSighting.findFirst()).toMatchObject({
    resultSource: "RIOT",
    resultConflict: false,
    win: true,
  });
  const second = { ...base, gameId: "7102" };
  await upsertClashGameSighting(second);
  await upsertClashGameSighting({ ...second, teamId: 200 });
  expect(
    await prisma.clashGameSighting.findFirst({ where: { gameId: "7102" } }),
  ).toMatchObject({ resultConflict: true, win: null });
});

test("quarantined observations require the original gates before audited acceptance", async () => {
  const uuid = "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e";
  const observationId = crypto.randomUUID();
  sequence += 1;
  await prisma.scoutClientObservation.create({
    data: {
      observationId,
      deviceId,
      sequence: BigInt(sequence),
      capturedAt: new Date(),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: "clash",
      localPuuid: uuid,
      payload: {
        resource: "clash_roster",
        data: {
          id: "owned-roster",
          tournamentId: "101",
          name: "Recovered",
          members: [{ puuid: uuid }],
        },
      },
      bodyDigest: "original-quarantined-digest",
      disposition: "QUARANTINED",
      quarantineReason: "unverified_local_puuid",
    },
  });
  const at = new Date();
  await reconcileAcceptedClientEvidence(at);
  expect(await prisma.scoutClientObservationRevalidation.count()).toBe(0);
  expect(
    await prisma.scoutClientObservation.findUnique({
      where: { observationId },
    }),
  ).toMatchObject({ disposition: "QUARANTINED" });
  await prisma.leagueIdentityAlias.create({
    data: {
      lcuUuid: uuid,
      puuid: PLAYER,
      gameName: "Owner",
      tagLine: "NA1",
      source: "riot_id",
      ownerVerified: true,
    },
  });
  await reconcileAcceptedClientEvidence(new Date(at.getTime() + 301_000));
  expect(
    await prisma.scoutClientObservation.findUnique({
      where: { observationId },
    }),
  ).toMatchObject({
    disposition: "ACCEPTED",
    localPuuid: PLAYER,
    localLcuUuid: uuid,
    bodyDigest: "original-quarantined-digest",
    payload: { data: { members: [{ puuid: uuid }] } },
  });
  expect(
    await prisma.scoutClientObservationRevalidation.findMany(),
  ).toMatchObject([
    { observationId, previousReason: "unverified_local_puuid" },
  ]);
  expect(await prisma.scoutClientClashEntity.findFirst()).toMatchObject({
    entityId: "owned-roster",
    platformId: "NA1",
  });
});

test("revalidation keeps an unrecorded client version quarantined", async () => {
  const observationId = crypto.randomUUID();
  sequence += 1;
  await prisma.scoutClientObservation.create({
    data: {
      observationId,
      deviceId,
      sequence: BigInt(sequence),
      capturedAt: new Date(),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "99.0.0",
      kind: "clash",
      localPuuid: PLAYER,
      payload: {
        resource: "clash_roster",
        data: {
          id: "owned-roster",
          name: "Blocked",
          members: [{ puuid: PLAYER }],
        },
      },
      bodyDigest: "original-digest",
      disposition: "QUARANTINED",
      quarantineReason: "unverified_local_puuid",
    },
  });
  await reconcileAcceptedClientEvidence();
  expect(
    await prisma.scoutClientObservation.findUnique({
      where: { observationId },
    }),
  ).toMatchObject({
    disposition: "QUARANTINED",
    bodyDigest: "original-digest",
  });
  expect(await prisma.scoutClientObservationRevalidation.count()).toBe(0);
  expect(await prisma.scoutClientClashEntity.count()).toBe(0);
});

test("client prematch expires and a terminal session invalidates a started roster", async () => {
  const player = {
    puuid: PLAYER,
    championId: 1,
    spell1Id: 4,
    spell2Id: 14,
    selectedSkinIndex: 0,
    profileIconId: 1,
  };
  const data = {
    phase: "InProgress",
    gameData: {
      gameId: 7101,
      isCustomGame: true,
      queue: { id: 0, mapId: 11, gameMode: "CLASSIC" },
      bannedChampions: [],
      teamOne: [player],
      teamTwo: [{ ...player, puuid: "other" }],
    },
  };
  const at = new Date();
  await observe(
    "gameflow",
    { resource: "gameflow_session", data },
    { platformId: "NA1", capturedAt: at },
  );
  expect(await readClientPrematch(PLAYER, "AMERICA_NORTH", at)).not.toBeNull();
  expect(
    await getActiveGameWithClientEvidence(PLAYER, "AMERICA_NORTH"),
  ).toMatchObject({
    kind: "in-game",
    game: {
      gameId: 7101,
      scoutClientEvidence: { capturedAt: at.toISOString() },
    },
  });
  expect(
    await readClientPrematch(
      PLAYER,
      "AMERICA_NORTH",
      new Date(at.getTime() + 91_000),
    ),
  ).toBeNull();
  await observe(
    "gameflow",
    { resource: "gameflow_session", data: { ...data, phase: "EndOfGame" } },
    { platformId: "NA1", capturedAt: new Date(at.getTime() + 1000) },
  );
  expect(
    await readClientPrematch(
      PLAYER,
      "AMERICA_NORTH",
      new Date(at.getTime() + 2000),
    ),
  ).toBeNull();
});
