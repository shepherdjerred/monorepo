import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  COMPETITIVE_PROGRESSION_CATALOG_VERSION,
  HallSettingsSchema,
  RawMatchSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import { loadRawMatchFixture } from "#src/testing/report-lake/raw-capture-fixtures.ts";
import {
  createTestDatabase,
  dropTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const { prisma, dbPath } = createTestDatabase("scout-hall-evaluate-match");
const io = vi.hoisted(() => ({ lakeDir: "" }));
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isPolicyEnabled: async (name: string) => name === "hall_of_fame_enabled",
}));
vi.mock("#src/evidence/recovery-gate.ts", () => ({
  evidenceRecoveryEnabled: () => true,
}));
vi.mock("#src/report-lake/paths.ts", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveLakeDir: () => io.lakeDir,
}));

const { evaluateHallMatch } =
  await import("#src/progression/hall/evaluate-match.ts");
const { runHallBaseline } = await import("#src/progression/hall/baseline.ts");
const { requestFullHallBaseline, updateHallSettings } =
  await import("#src/progression/hall/settings.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");
const { listIntentsForMatch } =
  await import("#src/database/durable/intent-repository.ts");
const { listStagingFiles, writeMatchStagingFile } =
  await import("#src/report-lake/staging.ts");
const { planMatchFanOut } = await import("#src/temporal/match/match-reads.ts");
const { hallRecordBreakAnnouncementCodec } =
  await import("#src/temporal/notification/announcement-codecs.ts");

const GUILD = testGuildId("4800");
const CHANNEL = testChannelId("4801");
const ACTOR = testAccountId("4800");
const ALICE = testPuuid("hall-evaluate-alice");
const BOB = testPuuid("hall-evaluate-bob");
const TRACKING_STARTED = new Date("2026-09-01T00:00:00.000Z");
const GAME_END = Date.parse("2026-09-19T09:30:00.000Z");
const FIXTURE = await loadRawMatchFixture();

type Score = readonly [puuid: LeaguePuuid, kills: number, assists: number];

let seq = 0;

function rankedMatch(scores: readonly Score[], gameEndAt?: number): RawMatch {
  seq += 1;
  const gameId = 4_800_000_000 + seq;
  const matchId = RiotMatchIdSchema.parse(`NA1_${String(gameId)}`);
  const gameEndTimestamp = gameEndAt ?? GAME_END + seq * 60_000;
  const gameStartTimestamp = gameEndTimestamp - 1_800_000;
  const participants = FIXTURE.info.participants.map((participant, index) => {
    const score = scores[index];
    if (score === undefined) return participant;
    const [puuid, kills, assists] = score;
    return {
      ...participant,
      puuid,
      kills,
      assists,
      gameEndedInEarlySurrender: false,
      teamEarlySurrendered: false,
    };
  });
  return RawMatchSchema.parse({
    metadata: {
      ...FIXTURE.metadata,
      matchId,
      participants: participants.map((participant) => participant.puuid),
    },
    info: {
      ...FIXTURE.info,
      gameId,
      gameCreation: gameStartTimestamp,
      gameStartTimestamp,
      gameEndTimestamp,
      gameDuration: 1800,
      queueId: 420,
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      endOfGameResult: "GameComplete",
      participants,
    },
  });
}

async function recordObservation(
  match: RawMatch,
  deliveryMode: "live" | "silent-backfill" = "live",
): Promise<void> {
  await observeMatch(prisma, {
    matchId: match.metadata.matchId,
    platformRoute: PlatformRouteSchema.parse("NA1"),
    policy: "FULL",
    deliveryMode,
    matchDataSource: "RIOT",
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse(
      new Date(match.info.gameCreation).toISOString(),
    ),
    observedAt: IsoInstantSchema.parse(
      new Date(match.info.gameEndTimestamp).toISOString(),
    ),
    artifacts: { match: null, timeline: null },
  });
}

async function evaluateObserved(
  match: RawMatch,
  deliveryMode?: "live" | "silent-backfill",
): Promise<void> {
  await recordObservation(match, deliveryMode);
  await evaluateHallMatch(match);
}

async function stageHistory(match: RawMatch): Promise<void> {
  await recordObservation(match);
  expect(await writeMatchStagingFile(io.lakeDir, match)).toBe(true);
}

async function createTrackedPlayer(alias: string, puuid: LeaguePuuid) {
  const shared = {
    alias,
    serverId: GUILD,
    creatorDiscordId: ACTOR,
    createdTime: TRACKING_STARTED,
    updatedTime: TRACKING_STARTED,
  };
  await prisma.player.create({
    data: {
      ...shared,
      accounts: {
        create: { ...shared, puuid, region: "AMERICA_NORTH" },
      },
    },
  });
}

async function rebuildHall(): Promise<void> {
  const request = await requestFullHallBaseline(prisma, {
    guildId: GUILD,
    actorDiscordId: ACTOR,
    stage: "beta",
  });
  if (request === null) throw new Error("The test Hall has enabled records");
  await runHallBaseline({
    stage: "beta",
    guildId: GUILD,
    revision: request.revision,
  });
}

async function hallRecordsFor(match: RawMatch) {
  const [intent] = await listIntentsForMatch(prisma, {
    matchId: match.metadata.matchId,
  });
  const announcement = intent?.intent.announcement;
  if (announcement === undefined) throw new Error("Expected a Hall intent");
  expect(announcement.version).toBe(2);
  return hallRecordBreakAnnouncementCodec.parse(announcement).records;
}

function rank(value: number, ...players: string[]) {
  return {
    value,
    holders: players.map((playerAlias) =>
      expect.objectContaining({ playerAlias }),
    ),
  };
}

beforeEach(async () => {
  io.lakeDir = await mkdtemp(path.join(tmpdir(), "scout-hall-lake-"));
  await prisma.$transaction([
    prisma.matchNotificationIntent.deleteMany(),
    prisma.matchObservation.deleteMany(),
    prisma.hallSettings.deleteMany(),
    prisma.account.deleteMany(),
    prisma.player.deleteMany(),
  ]);
  await createTrackedPlayer("Alice", ALICE);
  await createTrackedPlayer("Bob", BOB);
  await updateHallSettings(prisma, {
    settings: HallSettingsSchema.parse({
      guildId: GUILD,
      catalogVersion: COMPETITIVE_PROGRESSION_CATALOG_VERSION,
      channelId: CHANNEL,
      enabledQueueFamilies: ["ranked_sr"],
      enabledRecords: ["kills", "assists"],
    }),
    actorDiscordId: ACTOR,
    stage: "beta",
  });
  await rebuildHall();
});

afterEach(async () => {
  await rm(io.lakeDir, { recursive: true, force: true });
});
afterAll(async () => {
  await dropTestDatabase(prisma, dbPath);
});

describe("Hall evaluation and announcement fan-out", () => {
  test("uses canonical stats before lake staging and groups every broken record", async () => {
    await evaluateObserved(rankedMatch([[ALICE, 20, 20]]));
    const live = rankedMatch([
      [ALICE, 30, 24],
      [BOB, 25, 36],
    ]);
    await evaluateObserved(live);
    const matchId = live.metadata.matchId;

    expect(await listStagingFiles(io.lakeDir, "matches")).toEqual([]);
    expect(await planMatchFanOut({ riotMatchId: matchId })).toMatchObject({
      notificationIntentKeys: [`hall-record-break:${matchId}:${GUILD}`],
    });
    expect(
      await prisma.matchNotificationIntent.findMany({
        where: { riotMatchId: matchId },
      }),
    ).toMatchObject([
      { kind: "hall-record-break", targetId: CHANNEL, state: "pending" },
    ]);

    const records = await hallRecordsFor(live);
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordId: "kills",
          previous: rank(20, "Alice"),
          standings: [rank(30, "Alice"), rank(25, "Bob"), rank(20, "Alice")],
        }),
        expect.objectContaining({
          recordId: "assists",
          previous: rank(20, "Alice"),
          standings: [rank(36, "Bob"), rank(24, "Alice"), rank(20, "Alice")],
        }),
      ]),
    );
  });

  test("updates first scores, ties, lower ranks and silent backfill without alerts", async () => {
    await evaluateObserved(rankedMatch([[ALICE, 20, 20]]));
    await evaluateObserved(rankedMatch([[BOB, 20, 20]]));
    await evaluateObserved(rankedMatch([[ALICE, 18, 18]]));
    expect(await prisma.matchNotificationIntent.count()).toBe(0);

    const kills = await prisma.hallRecordCell.findFirstOrThrow({
      where: { recordId: "kills" },
    });
    expect(kills.currentValue).toBe(20);
    expect(JSON.parse(kills.holdersJson)).toEqual(
      rank(20, "Alice", "Bob").holders,
    );

    await evaluateObserved(rankedMatch([[ALICE, 40, 40]]), "silent-backfill");
    expect(
      await prisma.hallRecordCell.findUniqueOrThrow({
        where: { id: kills.id },
      }),
    ).toMatchObject({ currentValue: 40 });
    expect(await prisma.matchNotificationIntent.count()).toBe(0);
  });

  test("serializes simultaneous matches and never mints a second intent on retry", async () => {
    await evaluateObserved(rankedMatch([[ALICE, 20, 20]]));
    const first = rankedMatch([[ALICE, 30, 30]]);
    const second = rankedMatch([[BOB, 30, 30]]);
    await Promise.all([recordObservation(first), recordObservation(second)]);
    await Promise.all([evaluateHallMatch(first), evaluateHallMatch(second)]);
    await evaluateHallMatch(first);
    await evaluateHallMatch(second);

    const intents = await prisma.matchNotificationIntent.findMany();
    expect(intents).toHaveLength(1);
    expect([first.metadata.matchId, second.metadata.matchId]).toContain(
      intents[0]?.riotMatchId,
    );
    const kills = await prisma.hallRecordCell.findFirstOrThrow({
      where: { recordId: "kills" },
    });
    expect(kills.currentValue).toBe(30);
    expect(JSON.parse(kills.holdersJson)).toEqual(
      expect.arrayContaining(rank(30, "Alice", "Bob").holders),
    );
  });

  test("seeds a legacy Hall from earlier history and agrees with a baseline rebuild", async () => {
    // A value from the old Hall is still authoritative even if its match rows
    // have not reached this lake. The historical best and runner-up are staged.
    const prior = rankedMatch([[ALICE, 20, 20]], GAME_END - 180_000);
    await evaluateObserved(prior);
    await prisma.hallRecordCell.updateMany({ data: { rankingsJson: null } });
    await stageHistory(rankedMatch([[ALICE, 23, 23]], GAME_END - 120_000));
    await stageHistory(rankedMatch([[BOB, 18, 18]], GAME_END - 60_000));

    const live = rankedMatch([[BOB, 30, 30]], GAME_END);
    // Even when the incoming match is in the lake, initialization must not
    // consume it. The future score must not become the previous record either.
    await stageHistory(live);
    await stageHistory(rankedMatch([[ALICE, 40, 40]], GAME_END + 60_000));
    await evaluateHallMatch(live);

    const records = await hallRecordsFor(live);
    expect(records.find((record) => record.recordId === "kills")).toMatchObject(
      {
        previous: rank(23, "Alice"),
        standings: [rank(30, "Bob"), rank(23, "Alice"), rank(20, "Alice")],
      },
    );

    await rebuildHall();
    const next = rankedMatch([[BOB, 45, 45]], GAME_END + 120_000);
    await evaluateObserved(next);
    const nextRecords = await hallRecordsFor(next);
    expect(
      nextRecords.find((record) => record.recordId === "kills"),
    ).toMatchObject({
      previous: rank(40, "Alice"),
      standings: [rank(45, "Bob"), rank(40, "Alice"), rank(30, "Bob")],
    });
  });
});
